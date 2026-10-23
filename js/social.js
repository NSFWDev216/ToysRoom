// Friends and the "who's online" list, with no server and no sign-in.
//
// Everyone with the site open is connected to the lobby (peer to peer). Each browser
// announces itself there ("presence") every so often, signed with a key pair that is
// made in this browser and kept with the profile. Friends are remembered by that key,
// so somebody else can't later pretend to be your friend by copying their name or ID.
//
// Friends, friend requests and settings are stored in this browser (localStorage), the
// same way the profile is. A request to someone who is offline waits here and is sent
// when they next come online.

import {cleanPublicProfile} from './profile.js'

const KEY = 'tr-friends'
const KEY_ID = 'tr-identity-key'
const ONLINE_MS = 75000 // shown as online for this long after their last announcement
const ANNOUNCE_MS = 25000

const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n)
const enc = new TextEncoder()
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)))
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0))

class Emitter {
  constructor() { this.h = {} }
  on(e, f) { (this.h[e] ||= []).push(f); return this }
  emit(e, ...a) { (this.h[e] || []).forEach(f => f(...a)) }
}

export function loadFriends() {
  let d = {}
  try { d = JSON.parse(localStorage.getItem(KEY) || '{}') || {} } catch {}
  const obj = o => (o && typeof o === 'object' && !Array.isArray(o) ? o : {})
  return {
    friends: obj(d.friends), incoming: obj(d.incoming), outgoing: obj(d.outgoing),
    settings: {visible: d.settings?.visible !== false, friendsJoin: d.settings?.friendsJoin !== false}
  }
}

// Short fingerprint of a public key, shown as the "friend code" check.
async function fingerprint(pubB64) {
  const h = await crypto.subtle.digest('SHA-256', unb64(pubB64))
  return [...new Uint8Array(h).slice(0, 6)].map(x => x.toString(16).padStart(2, '0')).join('')
}

export class Social extends Emitter {
  constructor(profile) {
    super()
    this.profile = profile
    this.data = loadFriends()
    this.online = new Map() // uid -> {uid, peerId, name, ..., room, seen, pub, fp}
    this.net = null
    this.room = null // what I'm doing: {code, name, isPrivate} or null (lobby)
    this.ready = this.initKeys().catch(() => { this.noCrypto = true })
    setInterval(() => this.expire(), 10000)
  }

  // ---------- identity ----------
  async initKeys() {
    if (!crypto?.subtle) throw new Error('no crypto')
    let saved = null
    try { saved = JSON.parse(localStorage.getItem(KEY_ID) || 'null') } catch {}
    const algo = {name: 'ECDSA', namedCurve: 'P-256'}
    if (saved?.priv && saved?.pub) {
      this.priv = await crypto.subtle.importKey('jwk', saved.priv, algo, false, ['sign'])
      this.pub = saved.pub
    } else {
      const k = await crypto.subtle.generateKey(algo, true, ['sign', 'verify'])
      this.priv = k.privateKey
      this.pub = b64(await crypto.subtle.exportKey('raw', k.publicKey))
      const privJwk = await crypto.subtle.exportKey('jwk', k.privateKey)
      try { localStorage.setItem(KEY_ID, JSON.stringify({priv: privJwk, pub: this.pub})) } catch {}
    }
    this.fp = await fingerprint(this.pub)
  }
  // signs uid + my peer id + time, so a message can't be replayed from someone else's connection
  async sign(peerId, ts) {
    await this.ready
    if (!this.priv) return ''
    const sig = await crypto.subtle.sign({name: 'ECDSA', hash: 'SHA-256'}, this.priv, enc.encode(`${this.profile.uid}|${peerId}|${ts}`))
    return b64(sig)
  }
  async verify(uid, peerId, ts, pub, sig) {
    try {
      if (!pub || !sig || Math.abs(Date.now() - ts) > 10 * 60000) return false
      const key = await crypto.subtle.importKey('raw', unb64(pub), {name: 'ECDSA', namedCurve: 'P-256'}, false, ['verify'])
      return await crypto.subtle.verify({name: 'ECDSA', hash: 'SHA-256'}, key, unb64(sig), enc.encode(`${uid}|${peerId}|${ts}`))
    } catch { return false }
  }

  save() { try { localStorage.setItem(KEY, JSON.stringify(this.data)) } catch {} ; this.emit('change') }
  get settings() { return this.data.settings }
  setSetting(k, v) { this.data.settings[k] = v; this.save(); this.announce() }

  // ---------- network ----------
  attach(net) {
    this.net = net
    net.on('pres', (d, peerId) => this.onPresence(d, peerId))
    net.on('fr', (d, peerId) => this.onFriendMsg(d, peerId))
    net.onJoin(peerId => this.announce(peerId))
    net.onLeave(peerId => {
      for (const [uid, p] of this.online) if (p.peerId === peerId) this.online.delete(uid)
      this.emit('online')
    })
    clearInterval(this.timer)
    this.timer = setInterval(() => this.announce(), ANNOUNCE_MS)
    this.announce()
  }
  detach(net) { if (this.net === net) { this.net = null; this.online.clear(); this.emit('online') } }
  setRoom(room) { this.room = room; this.announce() }

  async presence(peerId, forFriend) {
    const ts = Date.now()
    const p = this.profile
    const r = this.room
    const room = !r ? null : (!r.isPrivate || (forFriend && this.settings.friendsJoin))
      ? {code: r.code, name: r.name, isPrivate: !!r.isPrivate} : {isPrivate: true}
    return {
      uid: p.uid, name: p.name, ...cleanPublicProfile(p), status: r ? 'room' : 'lobby', room,
      pub: this.pub, ts, sig: await this.sign(this.net?.selfId, ts)
    }
  }
  // Everyone gets my public presence (unless I'm hidden); friends also get my private room.
  async announce(target) {
    const net = this.net
    if (!net) return
    await this.ready
    const peers = target ? [target] : net.peers()
    const friendPeers = peers.filter(id => [...this.online.values()].some(o => o.peerId === id && this.data.friends[o.uid]))
    const others = peers.filter(id => !friendPeers.includes(id))
    if (this.settings.visible && others.length) net.send('pres', await this.presence(), target ? others : undefined)
    if (friendPeers.length) net.send('pres', await this.presence(null, true), friendPeers)
    // hidden: peers I don't know yet still need to learn who I am if they are my friends
    if (!this.settings.visible && others.length) net.send('pres', {uid: this.profile.uid, hidden: true, pub: this.pub, ts: Date.now(), sig: await this.sign(net.selfId, Date.now())}, target ? others : undefined)
  }

  async onPresence(d, peerId) {
    if (!d || typeof d !== 'object') return
    const uid = clean(d.uid, 64)
    if (!uid || uid === this.profile.uid) return
    const ts = +d.ts || 0
    if (!(await this.verify(uid, peerId, ts, d.pub, d.sig))) return
    const friend = this.data.friends[uid]
    // a friend is recognised by their key: someone reusing their ID is ignored
    if (friend?.pub && friend.pub !== d.pub) return
    const fresh = !this.online.has(uid)
    if (d.hidden) {
      // hidden people only show up for their friends, who then ask for the full presence
      if (friend) { this.online.set(uid, {...(this.online.get(uid) || {}), uid, peerId, pub: d.pub, hidden: true, seen: Date.now()}); this.announce(peerId) }
      return
    }
    const prof = cleanPublicProfile(d)
    const room = d.room && typeof d.room === 'object'
      ? {code: clean(d.room.code, 16).replace(/[^A-Z0-9]/g, ''), name: clean(d.room.name, 40), isPrivate: !!d.room.isPrivate} : null
    this.online.set(uid, {...prof, uid, peerId, name: clean(d.name, 24) || 'Guest', status: d.status === 'room' ? 'room' : 'lobby', room, pub: d.pub, fp: await fingerprint(d.pub), seen: Date.now()})
    if (friend) {
      // keep their latest name and look
      Object.assign(friend, {name: clean(d.name, 24) || friend.name, avatar: prof.avatar, color: prof.color, gender: prof.gender, genderCustom: prof.genderCustom})
      this.save()
    }
    if (fresh) {
      this.announce(peerId) // so they see me straight away too
      // requests that waited for them to come online
      if (this.data.outgoing[uid] && !this.data.outgoing[uid].sent) this.sendFriend(uid, 'req')
    }
    this.emit('online')
  }

  expire() {
    const now = Date.now()
    let changed = false
    for (const [uid, p] of this.online) if (now - p.seen > ONLINE_MS) { this.online.delete(uid); changed = true }
    if (changed) this.emit('online')
  }

  // ---------- friends ----------
  status(uid) {
    if (this.data.friends[uid]) return 'friend'
    if (this.data.incoming[uid]) return 'incoming'
    if (this.data.outgoing[uid]) return 'outgoing'
    return 'none'
  }
  card(uid) {
    const o = this.online.get(uid) || {}
    return {uid, name: o.name || 'Someone', avatar: o.avatar || '🙂', color: o.color, gender: o.gender, genderCustom: o.genderCustom, pub: o.pub, fp: o.fp}
  }
  async sendFriend(uid, t) {
    const o = this.online.get(uid)
    if (!o || !this.net) return false
    const ts = Date.now()
    this.net.send('fr', {t, uid: this.profile.uid, name: this.profile.name, ...cleanPublicProfile(this.profile), pub: this.pub, ts, sig: await this.sign(this.net.selfId, ts)}, o.peerId)
    return true
  }
  // Send (or queue) a friend request. Returns 'sent' | 'queued' | 'friends'.
  async request(uid, known) {
    uid = clean(uid, 64)
    if (!uid || uid === this.profile.uid) return 'self'
    if (this.data.friends[uid]) return 'friends'
    if (this.data.incoming[uid]) { await this.accept(uid); return 'friends' }
    const sent = await this.sendFriend(uid, 'req')
    this.data.outgoing[uid] = {...(known || this.card(uid)), uid, at: Date.now(), sent}
    this.save()
    return sent ? 'sent' : 'queued'
  }
  async accept(uid) {
    const r = this.data.incoming[uid]
    if (!r) return
    delete this.data.incoming[uid]
    this.data.friends[uid] = {...r, since: Date.now()}
    this.save()
    await this.sendFriend(uid, 'acc')
    this.announce()
  }
  async decline(uid) {
    if (!this.data.incoming[uid]) return
    delete this.data.incoming[uid]
    this.save()
    await this.sendFriend(uid, 'dec')
  }
  async cancel(uid) {
    if (!this.data.outgoing[uid]) return
    delete this.data.outgoing[uid]
    this.save()
    await this.sendFriend(uid, 'cancel')
  }
  async remove(uid) {
    if (!this.data.friends[uid]) return
    delete this.data.friends[uid]
    this.save()
    await this.sendFriend(uid, 'rm')
  }

  async onFriendMsg(d, peerId) {
    if (!d || typeof d !== 'object') return
    const uid = clean(d.uid, 64)
    if (!uid || uid === this.profile.uid || !(await this.verify(uid, peerId, +d.ts || 0, d.pub, d.sig))) return
    const known = this.data.friends[uid] || this.data.outgoing[uid] || this.data.incoming[uid]
    if (known?.pub && known.pub !== d.pub) return // not the person we know by this ID
    const prof = cleanPublicProfile(d)
    const who = {uid, name: clean(d.name, 24) || 'Someone', avatar: prof.avatar, color: prof.color, gender: prof.gender, genderCustom: prof.genderCustom, pub: d.pub, fp: await fingerprint(d.pub)}
    if (d.t === 'req') {
      if (this.data.friends[uid]) { await this.sendFriend(uid, 'acc'); return }
      if (this.data.outgoing[uid]) { // we both asked: that's a yes
        delete this.data.outgoing[uid]
        this.data.friends[uid] = {...who, since: Date.now()}
        this.save(); await this.sendFriend(uid, 'acc'); this.emit('notice', `${who.name} is now your friend`)
        return
      }
      if (Object.keys(this.data.incoming).length >= 100) return
      const isNew = !this.data.incoming[uid]
      this.data.incoming[uid] = {...who, at: Date.now()}
      this.save()
      if (isNew) this.emit('notice', `${who.name} sent you a friend request`)
    } else if (d.t === 'acc') {
      if (!this.data.outgoing[uid] && !this.data.friends[uid]) return
      delete this.data.outgoing[uid]
      this.data.friends[uid] = {...(this.data.friends[uid] || {}), ...who, since: this.data.friends[uid]?.since || Date.now()}
      this.save()
      this.emit('notice', `${who.name} accepted your friend request`)
      this.announce(peerId)
    } else if (d.t === 'dec') {
      if (this.data.outgoing[uid]) { delete this.data.outgoing[uid]; this.save() }
    } else if (d.t === 'cancel') {
      if (this.data.incoming[uid]) { delete this.data.incoming[uid]; this.save() }
    } else if (d.t === 'rm') {
      if (this.data.friends[uid]) { delete this.data.friends[uid]; this.save() }
    }
  }

  get requestCount() { return Object.keys(this.data.incoming).length }
  isOnline(uid) { const o = this.online.get(uid); return !!o && !o.hidden }
}
