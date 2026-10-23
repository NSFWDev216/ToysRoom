// Room logic with no DOM: membership, max-people enforcement, host election,
// rotating timed controller, control levels, chat and the public lobby.
//
// There is no server. The longest-present member is the "host": it runs the turn
// timer and announces public rooms to the lobby. If the host leaves, the next
// oldest member takes over automatically with the same state.

import {openRoom} from './net.js'
import {CONFIG} from './config.js'
import {packOutputs, unpackOutputs, zeroOutputs, CHANNEL_KEYS} from './features.js'
import {cleanPublicProfile, genderBucket, GENDER_BUCKETS} from './profile.js'

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export function makeCode(n = 8) {
  const a = crypto.getRandomValues(new Uint8Array(n))
  return [...a].map(x => ALPHABET[x % ALPHABET.length]).join('')
}
export const normalizeCode = s => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16)

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const cleanText = (s, n) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n)

export function cleanSettings(s = {}) {
  const L = CONFIG.limits
  return {
    name: cleanText(s.name, 40) || 'Untitled room',
    maxPeople: clamp(Math.round(+s.maxPeople || CONFIG.defaults.maxPeople), 2, L.maxPeople),
    turnSeconds: clamp(Math.round(+s.turnSeconds || CONFIG.defaults.turnSeconds), L.minTurn, L.maxTurn),
    controllers: clamp(Math.round(+s.controllers || 1), 1, L.maxControllers),
    rotate: s.rotate !== false,
    isPrivate: !!s.isPrivate,
    topic: cleanText(s.topic, 80),
    slots: cleanSlots(s.slots, clamp(Math.round(+s.maxPeople || CONFIG.defaults.maxPeople), 2, L.maxPeople))
  }
}

// Per-gender limits: {women: 4, men: 4}. A group that isn't listed has no limit of its own.
export function cleanSlots(slots, max) {
  const out = {}
  if (slots && typeof slots === 'object') {
    for (const b of Object.keys(GENDER_BUCKETS)) {
      const v = slots[b]
      if (v === '' || v === null || v === undefined || !Number.isFinite(+v)) continue
      out[b] = clamp(Math.round(+v), 0, max)
    }
  }
  return out
}
// Room listing: how many of each gender group are in it.
export function cleanCounts(c) {
  const out = {}
  for (const b of Object.keys(GENDER_BUCKETS)) out[b] = clamp((c && c[b]) | 0, 0, 999)
  return out
}
// Is there a free place in this room (a lobby listing) for someone of this gender group?
export function hasSpaceFor(room, bucket) {
  if (room.count >= room.maxPeople) return false
  const lim = room.slots?.[bucket]
  return lim === undefined || (room.gcount?.[bucket] || 0) < lim
}

const FEATS = new Set([...CHANNEL_KEYS, 'range'])
const cleanFeats = a => (Array.isArray(a) ? a.filter(x => FEATS.has(x)).slice(0, 8) : [])

class Emitter {
  constructor() { this.h = {} }
  on(e, f) { (this.h[e] ||= []).push(f); return this }
  emit(e, ...a) { (this.h[e] || []).forEach(f => f(...a)) }
}

export class RoomSession extends Emitter {
  constructor({code, me, settings}) {
    super()
    this.code = code
    this.settings = settings ? cleanSettings(settings) : null
    this.me = {
      name: cleanText(me.name, 24) || 'Guest', wants: me.wants !== false,
      toys: me.toys || [], feats: me.feats || [], profile: me.profile || {}
    }
    this.joinedAt = Date.now()
    this.members = new Map() // peerId -> {id, name, joinedAt, wants, toys}
    this.controllers = []
    this.groups = {}
    this.allowed = [] // host's hand-picked list of who may control (empty = everyone)
    this.endsAt = 0
    this.turn = 0
    this.outputs = zeroOutputs()
    this.levelSrc = ''
    this.left = false
    // people joining an existing room wait a moment to learn who is already there
    this.graceUntil = settings ? 0 : Date.now() + 2500
  }

  get selfId() { return this.net?.selfId }

  async join() {
    this.net = await openRoom('room-' + this.code, {password: this.code})
    const n = this.net
    this.members.set(n.selfId, {id: n.selfId, ...this.me, joinedAt: this.joinedAt, self: true})

    n.onJoin(id => {
      n.send('hello', this.helloMsg(), id)
      this.emit('peerjoin', id)
      if (this.isHost) setTimeout(() => this.sendState(id), 300)
    })
    n.onLeave(id => {
      const m = this.members.get(id)
      if (!m) return
      this.members.delete(id)
      this.emit('sys', `${m.name} left`)
      this.emit('members')
      if (id === this.myController) this.resetOutputs()
      this.tick()
    })
    n.on('hello', (d, id) => this.onHello(d, id))
    n.on('state', (d, id) => this.onState(d, id))
    n.on('ctl', (d, id) => {
      if (id !== this.myController || !d || typeof d.o !== 'object') return
      this.outputs = unpackOutputs(d.o)
      this.levelSrc = cleanText(d.s, 30)
      this.emit('outputs', this.outputs, this.levelSrc)
    })
    n.on('chat', (d, id) => {
      const m = this.members.get(id)
      const text = cleanText(d?.text, 500)
      if (m && text) this.emit('chat', {from: m.name, id, text})
    })
    n.on('pass', (d, id) => { if (this.isHost) this.replace(id) })
    n.on('media', (d, id) => { if (d && typeof d === 'object') this.emit('media', d, id) })
    n.on('upd', (d, id) => {
      const m = this.members.get(id)
      if (!m) return
      if (typeof d.wants === 'boolean') m.wants = d.wants
      if (Array.isArray(d.toys)) m.toys = d.toys.slice(0, 4).map(t => cleanText(t, 40))
      if (Array.isArray(d.feats)) m.feats = cleanFeats(d.feats)
      if (d.profile) m.profile = cleanPublicProfile(d.profile)
      if (typeof d.voice === 'boolean') m.voice = d.voice
      if (typeof d.micOn === 'boolean') m.micOn = d.micOn
      if (d.name) m.name = cleanText(d.name, 24) || m.name
      this.emit('members')
      this.tick()
    })
    n.on('full', (d, id) => { if (this.isOlder(id, this.selfId)) this.kick(d?.r === 'gender' ? 'gender' : 'full') })
    n.onStream((stream, id, meta) => this.emit('stream', stream, id, meta))

    this.timer = setInterval(() => this.tick(), 500)
    this.emit('members')
    this.tick()
  }

  helloMsg() {
    return {voice: !!this.me.voice, micOn: !!this.me.micOn, name: this.me.name, wants: this.me.wants, toys: this.me.toys, feats: this.me.feats, profile: this.me.profile, age: Date.now() - this.joinedAt, settings: this.settings}
  }

  onHello(d, id) {
    if (!d || typeof d !== 'object') return
    const isNew = !this.members.has(id)
    this.members.set(id, {
      id,
      name: cleanText(d.name, 24) || 'Guest',
      wants: d.wants !== false,
      toys: Array.isArray(d.toys) ? d.toys.slice(0, 4).map(t => cleanText(t, 40)) : [],
      feats: cleanFeats(d.feats),
      voice: d.voice === true,
      micOn: d.micOn === true,
      profile: cleanPublicProfile(d.profile),
      // "age" is how long they have been here, so clock differences between devices don't matter
      joinedAt: Date.now() - clamp(+d.age || 0, 0, 864e5)
    })
    if (!this.settings && d.settings) { this.settings = cleanSettings(d.settings); this.emit('settings') }
    if (isNew) this.emit('sys', `${this.members.get(id).name} joined`)
    this.emit('members')
    this.enforceMax(id)
    this.tick()
  }

  isOlder(a, b) {
    const A = this.members.get(a), B = this.members.get(b)
    if (!A || !B) return false
    return A.joinedAt !== B.joinedAt ? A.joinedAt < B.joinedAt : a < b
  }

  // Ordered by time in room, oldest first.
  get order() {
    return [...this.members.values()].sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : 1))
  }
  get hostId() { return this.order[0]?.id }
  get isHost() { return this.hostId === this.selfId }
  get isController() { return this.controllers.includes(this.selfId) }
  isControllerId(id) { return this.controllers.includes(id) }
  get remaining() { return Math.max(0, this.endsAt - Date.now()) }

  bucketOf(id) {
    const m = this.members.get(id)
    return genderBucket(m?.self ? this.me.profile?.gender : m?.profile?.gender)
  }
  // how many of each gender group are here
  genderCounts() {
    const c = {}
    for (const id of this.members.keys()) { const b = this.bucketOf(id); c[b] = (c[b] || 0) + 1 }
    return c
  }
  // Is this member beyond the room's limit for their gender group? (latest arrivals go first)
  overGenderLimit(id) {
    const b = this.bucketOf(id), lim = this.settings?.slots?.[b]
    if (lim === undefined) return false
    const same = this.order.filter(m => this.bucketOf(m.id) === b)
    return same.findIndex(m => m.id === id) >= lim
  }

  enforceMax(newId) {
    if (!this.settings) return
    const order = this.order
    const myIndex = order.findIndex(m => m.id === this.selfId)
    if (myIndex >= this.settings.maxPeople) return this.kick('full')
    if (this.overGenderLimit(this.selfId) && !this.isHost) return this.kick('gender')
    // the host tells newcomers beyond the limits to go
    if (!this.isHost || !newId) return
    const idx = order.findIndex(m => m.id === newId)
    if (idx >= this.settings.maxPeople) this.net.send('full', {}, newId)
    else if (this.overGenderLimit(newId)) this.net.send('full', {r: 'gender'}, newId)
  }

  kick(reason) {
    if (this.left) return
    this.emit('kicked', reason)
    this.leave()
  }

  onState(d, id) {
    if (!d || typeof d !== 'object') return
    // only trust the member we believe is host (oldest), or someone older than us while we learn the room
    if (id !== this.hostId && !this.isOlder(id, this.selfId)) return
    if (d.settings) {
      const had = JSON.stringify(this.settings)
      this.settings = cleanSettings(d.settings)
      if (had !== JSON.stringify(this.settings)) { this.emit('settings'); this.enforceMax() }
    }
    const ctrls = Array.isArray(d.controllers) ? d.controllers.filter(x => typeof x === 'string').slice(0, CONFIG.limits.maxControllers) : []
    const groups = {}
    if (d.groups && typeof d.groups === 'object') {
      for (const c of ctrls) groups[c] = Array.isArray(d.groups[c]) ? d.groups[c].filter(x => typeof x === 'string').slice(0, 100) : []
    }
    const allowed = Array.isArray(d.allowed) ? d.allowed.filter(x => typeof x === 'string').slice(0, 200) : []
    if (allowed.join() !== this.allowed.join()) { this.allowed = allowed; this.emit('members') }
    this.setControllers(ctrls, groups, clamp(+d.remaining || 0, 0, 36e5), d.turn | 0)
  }

  // Can this member be given the controls? (wants turns, and is on the host's list if there is one)
  canControl(id) {
    const m = this.members.get(id)
    return !!m?.wants && (!this.allowed.length || this.allowed.includes(id))
  }

  setControllers(list, groups, remainingMs, turn) {
    const oldMine = this.myController
    const oldList = this.controllers.join()
    this.controllers = list
    this.groups = groups
    this.endsAt = Date.now() + remainingMs
    this.turn = turn
    if (this.myController !== oldMine) this.resetOutputs()
    if (oldList !== list.join()) {
      const names = list.map(c => this.members.get(c)).filter(Boolean).map(m => (m.self ? 'you' : m.name))
      if (names.length) this.emit('sys', `Controls: ${names.join(', ')}`)
    }
    this.emit('turn')
  }

  // The controller whose group I am in (controllers are in their own group).
  get myController() { return this.controllerOf(this.selfId) }
  controllerOf(id) {
    if (!this.controllers.length) return null
    if (this.controllers.includes(id)) return id
    for (const c of this.controllers) if (this.groups[c]?.includes(id)) return c
    return this.controllers[0] // just joined: until the host regroups, follow the first controller
  }
  groupOf(cid) { return [cid, ...(this.groups[cid] || [])].filter(id => this.members.has(id)) }

  // Host-only bookkeeping, run every 500 ms.
  tick() {
    if (this.left || !this.isHost || !this.settings || Date.now() < this.graceUntil) return
    this.allowed = this.allowed.filter(id => this.members.has(id))
    const eligible = this.order.filter(m => this.canControl(m.id))
    const want = Math.min(this.settings.controllers, eligible.length)
    const valid = this.controllers.filter(id => this.canControl(id))
    const rotateDue = this.settings.rotate && this.controllers.length && this.remaining <= 0
    if (!want) {
      if (this.controllers.length) { this.setControllers([], {}, 0, this.turn + 1); this.sendState() }
      return
    }
    if (rotateDue) return this.advance()
    if (valid.length !== this.controllers.length || valid.length !== want) {
      // someone left, sat out, or the host changed the number: top up or trim, keep the rest
      const keep = valid.slice(0, want)
      const fill = this.nextEligible(keep, want - keep.length)
      const remaining = this.controllers.length ? this.remaining : this.settings.turnSeconds * 1000
      return this.publish([...keep, ...fill], remaining || this.settings.turnSeconds * 1000)
    }
    const groups = this.makeGroups(this.controllers)
    if (JSON.stringify(groups) !== JSON.stringify(this.groups)) return this.publish(this.controllers, this.remaining)
    if (Date.now() - (this.lastStateAt || 0) > 3000) this.sendState()
  }

  // Next `n` people who want turns, continuing round the room after the current controllers.
  nextEligible(exclude, n) {
    const order = this.order
    const lastIdx = Math.max(-1, ...this.controllers.map(id => order.findIndex(m => m.id === id)))
    const out = []
    for (let i = 1; i <= order.length && out.length < n; i++) {
      const m = order[(lastIdx + i + order.length) % order.length]
      if (this.canControl(m.id) && !exclude.includes(m.id) && !out.includes(m.id)) out.push(m.id)
    }
    return out
  }

  // Everyone who isn't controlling is dealt out evenly to the controllers, in join order.
  makeGroups(ctrls) {
    const groups = Object.fromEntries(ctrls.map(c => [c, []]))
    const rest = this.order.filter(m => !ctrls.includes(m.id))
    rest.forEach((m, i) => groups[ctrls[i % ctrls.length]].push(m.id))
    return groups
  }

  publish(ctrls, remainingMs, newTurn) {
    this.setControllers(ctrls, ctrls.length ? this.makeGroups(ctrls) : {}, remainingMs, this.turn + (newTurn ? 1 : 0))
    this.sendState()
  }

  advance() {
    const want = Math.min(this.settings.controllers, this.order.filter(m => this.canControl(m.id)).length)
    if (!want) return
    // rotate: the next people in line take over (everyone, if there are enough of them)
    this.publish(this.nextEligible([], want), this.settings.turnSeconds * 1000, true)
  }

  // Host: give every seat to new people, picked at random, preferring people who
  // aren't controlling right now. Restarts the turn timer.
  shuffle() {
    if (!this.isHost || !this.settings) return
    const eligible = this.order.filter(m => this.canControl(m.id)).map(m => m.id)
    const want = Math.min(this.settings.controllers, eligible.length)
    if (!want) return
    const rand = a => a.map(v => [crypto.getRandomValues(new Uint32Array(1))[0], v]).sort((x, y) => x[0] - y[0]).map(x => x[1])
    const fresh = rand(eligible.filter(id => !this.controllers.includes(id)))
    const old = rand(eligible.filter(id => this.controllers.includes(id)))
    this.publish([...fresh, ...old].slice(0, want), this.settings.turnSeconds * 1000, true)
  }

  // Host: put someone at the controls right now. Uses a free seat, otherwise takes over
  // the seat given (or the newest one). Raise "Controllers" to have more seats.
  makeController(id, seatOf) {
    if (!this.isHost || !this.settings || this.controllers.includes(id) || !this.members.get(id)?.wants) return false
    if (this.allowed.length && !this.allowed.includes(id)) this.allowed = [...this.allowed, id]
    let list = [...this.controllers]
    if (list.length < this.settings.controllers) list.push(id)
    else {
      const out = list.includes(seatOf) ? seatOf : list[list.length - 1]
      list = list.map(c => (c === out ? id : c))
    }
    this.publish(list, this.remaining || this.settings.turnSeconds * 1000, true)
    return true
  }
  // Host: take someone off the controls; the next person in line gets the seat.
  removeController(id) {
    if (!this.isHost || !this.controllers.includes(id)) return
    const [next] = this.nextEligible([...this.controllers, id], 1)
    const list = this.controllers.map(c => (c === id ? next : c)).filter(Boolean)
    this.publish(list, this.remaining || this.settings.turnSeconds * 1000, true)
  }
  // Host: who may control. An empty list means everyone who ticks "Take turns".
  setAllowed(id, on) {
    if (!this.isHost) return
    const set = new Set(this.allowed)
    if (on) set.add(id); else set.delete(id)
    this.allowed = [...set].filter(x => this.members.has(x))
    this.emit('members')
    this.sendState()
    this.tick()
  }
  clearAllowed() { if (this.isHost) { this.allowed = []; this.emit('members'); this.sendState(); this.tick() } }

  // A controller hands over just their own seat.
  replace(id) {
    if (!this.controllers.includes(id)) return
    const others = this.controllers.filter(c => c !== id)
    const [next] = this.nextEligible([...this.controllers], 1)
    const list = this.controllers.map(c => (c === id ? next : c)).filter(Boolean)
    if (!next && !others.length) return this.advance()
    this.publish(list, this.settings.rotate ? this.remaining : this.settings.turnSeconds * 1000, true)
  }

  sendState(target) {
    if (!this.net || this.left) return
    this.lastStateAt = Date.now()
    this.net.send('state', {settings: this.settings, controllers: this.controllers, groups: this.groups, allowed: this.allowed, remaining: this.remaining, turn: this.turn}, target)
  }

  // ---- actions for the UI ----
  resetOutputs() {
    this.outputs = zeroOutputs()
    this.levelSrc = ''
    this.emit('outputs', this.outputs, '')
  }
  sendOutputs(o, src) {
    if (!this.isController) return
    const packed = packOutputs(o)
    this.outputs = unpackOutputs(packed)
    this.levelSrc = src
    const targets = this.groupOf(this.selfId).filter(id => id !== this.selfId)
    if (targets.length) this.net.send('ctl', {o: packed, s: src}, targets)
    this.emit('outputs', this.outputs, src)
  }
  // features available to a controller's group (default: the group I'm in)
  roomFeatures(cid = this.myController) {
    const f = new Set()
    const ids = cid ? this.groupOf(cid) : [...this.members.keys()]
    for (const id of ids) { const m = this.members.get(id); (m?.self ? this.me.feats : m?.feats || []).forEach(x => f.add(x)) }
    return f
  }
  chat(text) {
    text = cleanText(text, 500)
    if (!text) return
    this.net.send('chat', {text})
    this.emit('chat', {from: this.me.name, id: this.selfId, text, self: true})
  }
  pass() {
    if (!this.isController) return
    if (this.isHost) this.replace(this.selfId); else this.net.send('pass', {}, this.hostId)
  }
  skip() { if (this.isHost) this.advance() }
  update(patch) {
    Object.assign(this.me, patch)
    Object.assign(this.members.get(this.selfId), patch)
    this.net.send('upd', patch)
    this.emit('members')
    this.tick()
  }
  updateSettings(patch) {
    if (!this.isHost) return
    const wasRotate = this.settings.rotate
    this.settings = cleanSettings({...this.settings, ...patch})
    // turning rotation on starts a fresh timer
    if (this.settings.rotate && !wasRotate) this.endsAt = Date.now() + this.settings.turnSeconds * 1000
    this.emit('settings')
    this.emit('turn')
    this.sendState()
    this.tick()
  }
  // media state (music / live feed) for the people I control, or for one person
  sendMedia(d, target) {
    if (!this.net || this.left) return
    const to = target || (d.scope === 'room' ? null : this.groupOf(this.selfId).filter(id => id !== this.selfId))
    if (Array.isArray(to) && !to.length) return
    this.net.send('media', d, to || undefined)
  }
  addStream(stream, target, meta) { this.net.addStream(stream, target, meta) }
  removeStream(stream, target) { this.net.removeStream(stream, target) }
  leave() {
    if (this.left) return
    this.left = true
    clearInterval(this.timer)
    this.net?.leave()
    this.emit('left')
  }
}

// ---------------- Lobby: public list of active rooms ----------------
// Visitors join passively (they only connect to room hosts). Hosts of public rooms join
// actively and announce their room. Listings disappear when announcements stop.
export class Lobby extends Emitter {
  constructor() {
    super()
    this.rooms = new Map()
    this.net = null
    this.mode = null
    this.announce = null
  }
  // Everyone in the lobby joins actively. (Passive listeners only hear room hosts on the
  // relays' slow re-announce cycle, about once a minute, which made the list look empty.)
  open(mode) { // 'browse' | 'host'
    if (this.mode === mode) return this.opening
    this.close()
    this.mode = mode
    const token = this.token = {}
    this.opening = openRoom(CONFIG.lobbyRoom).then(net => {
      if (this.token !== token) { net.leave(); return }
      this.attach(net)
    })
    return this.opening
  }
  attach(net) {
    this.net = net
    this.emit('net', net)
    net.on('ann', (d, id) => {
      if (!d?.code) return
      const code = String(d.code).replace(/[^A-Z0-9]/g, '').slice(0, 16)
      this.rooms.set(code, {
        code, from: id, seen: Date.now(),
        ...cleanSettings(d), count: clamp(d.count | 0, 0, 999), gcount: cleanCounts(d.gcount)
      })
      this.emit('rooms')
    })
    net.on('gone', d => { if (this.rooms.delete(d?.code)) this.emit('rooms') })
    net.onJoin(id => { if (this.announce) net.send('ann', this.announce(), id); this.emit('rooms') })
    net.onLeave(id => {
      for (const [k, r] of this.rooms) if (r.from === id) this.rooms.delete(k)
      this.emit('rooms')
    })
    this.timer = setInterval(() => {
      if (this.announce) net.send('ann', this.announce())
      const now = Date.now()
      let changed = false
      for (const [k, r] of this.rooms) if (now - r.seen > CONFIG.listingTtlMs) { this.rooms.delete(k); changed = true }
      if (changed) this.emit('rooms')
    }, CONFIG.announceEveryMs)
  }
  setAnnounce(fn) { this.announce = fn; if (fn && this.net) this.net.send('ann', fn()) }
  withdraw(code) { this.net?.send('gone', {code}); this.announce = null }
  list() { return [...this.rooms.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)) }
  close() {
    if (this.net) this.emit('closed', this.net)
    clearInterval(this.timer)
    this.token = null
    this.rooms.clear()
    this.net?.leave()
    this.net = null
    this.mode = null
  }
  get peerCount() { return this.net ? this.net.peers().length : 0 }
}
