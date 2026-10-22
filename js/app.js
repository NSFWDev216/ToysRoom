// UI wiring: age gate, profile, lobby, room view, controls, pattern library and toys.

import {CONFIG} from './config.js'
import {networkMode, relayCount} from './net.js'
import {RoomSession, Lobby, makeCode, normalizeCode, cleanSettings} from './room.js'
import {ToyManager, TOY_TYPES, TOY_FIELDS, TOY_HELP} from './toys.js'
import {PATTERNS, patternLevel} from './patterns.js'
import {MusicDriver} from './music.js'
import {CHANNELS, CHANNEL_KEYS, FEATURE_LABELS, zeroOutputs, peakOf} from './features.js'
import {loadProfile, saveProfile, publicProfile, genderLabel, rememberRoom, exportProfile, importProfile, GENDERS, ROLES, AVATARS} from './profile.js'
import {Fader, RangeBar} from './controls.js'
import {ACTIONS, DEFAULT_STEPS, loadKeys, saveKeys, defaultKeys, lookup, comboOf, prettyCombo} from './shortcuts.js'
import {VoiceChat} from './voice.js'
import {sources, listPatterns, downloadPattern, extractPatternText} from './sources.js'
import {EmbedPlayer, parseMediaLink, mediaLabel, parseScrolllerLink, scrolllerTitle} from './media.js'
import {GamepadInput, ANALOG, PAD_ACTIONS, defaultPad, familyOf, padName, inputLabel} from './gamepad.js'
import {loadLibrary, saveLibrary, parsePattern, makePattern, patternOutputs, durationOf, Recorder} from './library.js'

const $ = s => document.querySelector(s)
const $$ = s => [...document.querySelectorAll(s)]
const store = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d } catch { return d } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch {} }
}
const pct = v => Math.round(v * 100) + '%'
const fmtTime = ms => {
  const s = Math.ceil(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(s % 60).padStart(2, '0')}`
}
function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v
    else if (k === 'style') e.style.cssText = v
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v)
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v)
  }
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k))
  return e
}
let toastTimer
function toast(msg) {
  const t = $('#toast')
  t.textContent = msg
  t.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800)
}

// ---------------- state ----------------
const profile = loadProfile()
const toys = new ToyManager()
const music = new MusicDriver()
const lobby = new Lobby()
const recorder = new Recorder()
let library = loadLibrary()
const voice = new VoiceChat()
voice.onBlocked = () => $('#listen-btn').classList.remove('hidden')
let session = null
let mode = 'manual'
let pattern = null // built-in key, or 'lib:<id>'
let patternStart = 0
let lastSent = {key: '', at: 0}
let lastCtlAt = 0
let unread = 0
// controller's mixer: per feature, linked to the main level or set by hand
const mixer = Object.fromEntries(CHANNEL_KEYS.map(k => [k, {linked: true, val: 0}]))
const range = {lo: 0, hi: 1}
// Stroker control: 'speed' (stroke speed + range) or 'pos' (main value = stroke position)
let strokerMode = store.get('tr-stroker-mode', 'speed') === 'pos' ? 'pos' : 'speed'
const posTrack = {pos: 0, at: 0, speed: 0} // to estimate a speed for toys that only know speed

$('#net-pill').textContent = {nostr: 'P2P · Nostr', torrent: 'P2P · Torrent', local: 'Local test'}[networkMode] || 'P2P'

// ---------------- age gate ----------------
function initGate() {
  const ok = store.get('tr-age-ok') === '1'
  if (ok) { $('#gate').remove(); return start() }
  document.body.classList.add('gated')
  const update = () => { $('#gate-enter').disabled = !($('#gate-age').checked && $('#gate-consent').checked) }
  $('#gate-age').onchange = update
  $('#gate-consent').onchange = update
  $('#gate-enter').onclick = () => {
    store.set('tr-age-ok', '1')
    document.body.classList.remove('gated')
    $('#gate').remove()
    start()
  }
}

// ---------------- profile ----------------
function renderNameBtn() {
  $('#name-label').textContent = profile.name
  $('#name-avatar').textContent = profile.avatar
}
function openProfile() {
  $('#pf-name').value = profile.name
  $('#pf-gender').replaceChildren(...GENDERS.map(g => el('option', {value: g, selected: g === profile.gender}, g)))
  $('#pf-custom').value = profile.genderCustom
  $('#pf-custom-wrap').classList.toggle('hidden', profile.gender !== 'Self-describe')
  $('#pf-role').replaceChildren(...Object.entries(ROLES).map(([k, v]) => el('option', {value: k, selected: k === profile.role}, v)))
  $('#pf-color').value = profile.color
  $('#pf-about').value = profile.about
  $('#pf-uid').textContent = profile.uid.slice(0, 13)
  renderAvatars(profile.avatar)
  $('#profile-modal').classList.remove('hidden')
}
function renderAvatars(sel) {
  $('#pf-avatars').replaceChildren(...AVATARS.map(a => el('button', {type: 'button', class: a === sel ? 'sel' : '', onclick: () => renderAvatars(a), 'data-av': a}, a)))
  $('#pf-avatars').dataset.sel = sel
}
$('#pf-gender').onchange = e => $('#pf-custom-wrap').classList.toggle('hidden', e.target.value !== 'Self-describe')
$('#pf-close').onclick = () => $('#profile-modal').classList.add('hidden')
$('#profile-modal').onclick = e => { if (e.target.id === 'profile-modal') $('#profile-modal').classList.add('hidden') }
$('#profile-form').onsubmit = e => {
  e.preventDefault()
  Object.assign(profile, {
    name: $('#pf-name').value.trim().slice(0, 24) || profile.name,
    gender: $('#pf-gender').value,
    genderCustom: $('#pf-custom').value.trim().slice(0, 24),
    role: $('#pf-role').value,
    avatar: $('#pf-avatars').dataset.sel || profile.avatar,
    color: $('#pf-color').value,
    about: $('#pf-about').value.trim().slice(0, 140)
  })
  saveProfile(profile)
  renderNameBtn()
  session?.update({name: profile.name, profile: publicProfile(profile)})
  $('#profile-modal').classList.add('hidden')
  toast('Profile saved in this browser')
}
$('#pf-export').onclick = () => exportProfile(profile)
$('#pf-import').onchange = async e => {
  try {
    const p = await importProfile(e.target.files[0])
    Object.assign(profile, p)
    renderNameBtn()
    openProfile()
    toast('Profile imported')
  } catch (err) { toast(err.message) }
  e.target.value = ''
}
$('#name-btn').onclick = openProfile

// ---------------- lobby ----------------
function showLobby() {
  $('#lobby').classList.remove('hidden')
  $('#room').classList.add('hidden')
  lobby.setAnnounce(null)
  lobby.open('browse').catch(e => { $('#lobby-status').textContent = 'Could not start: ' + e.message })
  renderRooms()
  renderRecent()
}

function lobbyStatus(count) {
  const relays = relayCount()
  if (networkMode !== 'local' && !relays) return 'Connecting to relays…'
  const peers = lobby.peerCount
  const who = peers ? ` · ${peers} ${peers === 1 ? 'person' : 'people'} online` : ''
  return (count ? `${count} active` : 'Listening for rooms…') + who + (networkMode !== 'local' ? ` · ${relays} relays` : '')
}

function renderRooms() {
  const list = $('#room-list')
  const rooms = lobby.list()
  list.replaceChildren()
  $('#lobby-status').textContent = lobbyStatus(rooms.length)
  if (!rooms.length) {
    list.append(el('div', {class: 'empty'}, 'No public rooms right now. Create one and invite friends!'))
    return
  }
  for (const r of rooms) {
    const full = r.count >= r.maxPeople
    list.append(el('div', {class: 'room-item'},
      el('div', {class: 'row between'}, el('b', {}, r.name), el('span', {class: 'pill'}, `${r.count}/${r.maxPeople}`)),
      r.topic ? el('div', {class: 'muted small'}, r.topic) : null,
      el('div', {class: 'row between'},
        el('span', {class: 'muted small'}, `${r.controllers > 1 ? `🎛 ${r.controllers} controllers · ` : ''}${r.rotate ? `⏱ ${fmtTime(r.turnSeconds * 1000)} turns` : 'fixed controllers'}`),
        el('button', {class: 'btn small primary', disabled: full, onclick: () => enterRoom(r.code)}, full ? 'Full' : 'Join'))
    ))
  }
}
lobby.on('rooms', () => { if (!session) renderRooms() })
setInterval(() => { if (!session) $('#lobby-status').textContent = lobbyStatus(lobby.list().length) }, 2000)

function renderRecent() {
  $('#recent-card').classList.toggle('hidden', !profile.recent.length)
  $('#recent-list').replaceChildren(...profile.recent.map(r =>
    el('button', {class: 'btn small', title: 'Code ' + r.code, onclick: () => enterRoom(r.code)}, `${r.name || r.code}`)))
}

$('#join-form').onsubmit = e => {
  e.preventDefault()
  const code = normalizeCode($('#join-code').value)
  if (code.length < 4) return toast('Enter the invite code you were given')
  enterRoom(code)
}
$('#create-open').onclick = () => { $('#create-form').classList.remove('hidden'); $('#c-name').focus() }
$('#create-cancel').onclick = () => $('#create-form').classList.add('hidden')
$('#create-form').onsubmit = e => {
  e.preventDefault()
  const settings = cleanSettings({
    name: $('#c-name').value, topic: $('#c-topic').value,
    maxPeople: $('#c-max').value, turnSeconds: $('#c-turn').value, isPrivate: $('#c-private').checked,
    controllers: $('#c-ctrls').value, rotate: $('#c-rotate').checked
  })
  $('#create-form').classList.add('hidden')
  enterRoom(makeCode(), settings)
}

// ---------------- room ----------------
function myMember() {
  return {name: profile.name, wants: $('#t-wants').checked, toys: toys.summary(), feats: toys.features(), profile: publicProfile(profile)}
}

async function enterRoom(code, settings) {
  if (session) leaveRoom(true)
  voice.reset()
  renderVoice()
  lobby.close()
  $('#lobby').classList.add('hidden')
  $('#room').classList.remove('hidden')
  $('#chat-log').replaceChildren()
  $('#r-code').textContent = code
  history.replaceState(null, '', '#join=' + code)
  switchTab('control')

  wasController = false
  const s = new RoomSession({code, me: myMember(), settings})
  session = s
  s.on('members', () => {
    for (const id of voice.peers.keys()) if (!s.members.has(id)) voice.removePeer(id)
    renderPeople(); renderTurn(); renderMixer(); syncLobbyRole() })
  s.on('settings', () => { renderRoomHead(); if (s.settings) rememberRoom(profile, s.code, s.settings.name) })
  s.on('turn', () => { renderTurn(); syncLobbyRole() })
  s.on('outputs', (o, src) => {
    lastCtlAt = Date.now()
    toys.setOutputs(o)
    renderLevel(o, src)
  })
  s.on('chat', m => {
    const mem = s.members.get(m.id)
    if (mem && profile.muted.includes(mem.profile?.uid)) return
    addChat({...m, profile: m.self ? profile : mem?.profile})
  })
  s.on('sys', t => addChat({sys: true, text: t}))
  s.on('kicked', reason => {
    toast(reason === 'full' ? 'That room is full' : 'You left the room')
    session = null
    afterLeave()
  })
  s.on('peerjoin', id => { syncShares(); voice.sendTo(id); setTimeout(() => sendMediaState(), 1500) })
  s.on('members', syncShares)
  s.on('turn', () => { syncShares(); checkMediaSources(); sendMediaState() })
  s.on('media', onMedia)
  s.on('stream', (stream, id, meta) => {
    // The same stream can be announced once per track, and not always with its label:
    // remember what each stream is, and treat anything with a picture as the feed.
    const kind = meta?.kind || streamKinds.get(stream.id) || (stream.getVideoTracks().length ? 'feed' : '')
    if (kind) streamKinds.set(stream.id, kind)
    if (kind === 'voice') return voice.addPeer(id, stream, s.members.get(id)?.profile?.uid || id)
    if (kind === 'feed') {
      // if its sound was taken for music a moment ago, take it back (otherwise mute can't reach it)
      if ($('#room-audio').srcObject?.id === stream.id) { $('#room-audio').srcObject = null; musicStreamFrom = null; renderNowPlaying() }
      feedStream = {stream, from: id}
      return renderFeed()
    }
    musicStreamFrom = id
    const a = $('#room-audio')
    a.srcObject = stream
    a.play().then(() => $('#listen-btn').classList.add('hidden')).catch(() => $('#listen-btn').classList.remove('hidden'))
    renderNowPlaying()
  })
  addChat({sys: true, text: settings ? 'Room created. Share the invite code so others can join.' : 'Connecting to the room…'})
  renderRoomHead()
  renderLevel(zeroOutputs(), '')
  try {
    await s.join()
  } catch (e) {
    toast('Could not connect: ' + e.message)
    leaveRoom()
    return
  }
  if (s.settings) rememberRoom(profile, s.code, s.settings.name)
  // a code nobody is using: offer to open it as a new room
  setTimeout(() => {
    if (session === s && !s.settings) {
      addChat({sys: true, text: 'Nobody is in this room right now. The room may have ended, or the people in it may still be connecting.'})
      addChat({action: {label: 'Open this code as a new room', fn: () => enterRoom(s.code, cleanSettings({name: 'Room ' + s.code, isPrivate: true}))}})
    }
  }, 15000)
}

function syncLobbyRole() {
  if (!session || session.left) return
  const pub = session.settings && !session.settings.isPrivate
  if (session.isHost && pub) {
    const s = session
    lobby.open('host').then(() => { if (session === s) lobby.setAnnounce(() => ({code: s.code, ...s.settings, count: s.members.size})) })
  } else if (lobby.mode === 'host') {
    lobby.withdraw(session.code)
    lobby.close()
  }
}

function leaveRoom(quiet) {
  if (!session) return
  const s = session
  session = null
  if (lobby.mode === 'host') lobby.withdraw(s.code)
  s.leave()
  if (!quiet) afterLeave()
}
function afterLeave() {
  voice.reset()
  renderVoice()
  stopMusic()
  stopFeed(true)
  incoming.music = incoming.feed = incoming.scroll = null; feedStream = null; musicStreamFrom = null
  stopScroll(true)
  $('#room-audio').srcObject = null
  renderNowPlaying(); renderFeed()
  stopRecording(false)
  pattern = null
  toys.stopAll()
  history.replaceState(null, '', location.pathname + location.search)
  showLobby()
}
$('#r-leave').onclick = () => leaveRoom()
$('#home-btn').onclick = () => { if (session && !confirm('Leave this room?')) return; leaveRoom() }

$('#r-invite').onclick = async () => {
  const url = `${location.origin}${location.pathname}${location.search}#join=${session.code}`
  const text = `Join my room on Toy Rooms. Code: ${session.code}\n${url}`
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({title: 'Toy Rooms invite', text, url})
    else { await navigator.clipboard.writeText(url); toast('Invite link copied') }
  } catch { prompt('Copy this invite link', url) }
}

function renderRoomHead() {
  if (!session) return
  const st = session.settings
  $('#r-name').textContent = st?.name || 'Joining room…'
  $('#r-topic').textContent = st?.topic || ''
  $('#r-private').classList.toggle('hidden', !st?.isPrivate)
  $('#r-count').textContent = `👥 ${session.members.size}/${st?.maxPeople ?? '?'}`
  const host = session.isHost
  $('#host-tools').classList.toggle('hidden', !host || !st)
  if (host && st && document.activeElement?.closest('#host-tools') == null) {
    $('#h-max').value = st.maxPeople
    $('#h-turn').value = st.turnSeconds
    $('#h-ctrls').value = st.controllers
    $('#h-rotate').checked = st.rotate
  }
}
$('#h-save').onclick = () => {
  session?.updateSettings({maxPeople: $('#h-max').value, turnSeconds: $('#h-turn').value, controllers: $('#h-ctrls').value, rotate: $('#h-rotate').checked})
  toast('Room settings saved')
}

function renderPeople() {
  if (!session) return
  renderRoomHead()
  const ul = $('#people')
  ul.replaceChildren()
  const order = session.order
  $('#p-count').textContent = `(${order.length})`
  renderPickNote()
  order.forEach((m, i) => {
    const p = m.self ? profile : (m.profile || {})
    const tags = []
    if (i === 0) tags.push('👑 host')
    if (session.isControllerId(m.id)) {
      const n = session.groupOf(m.id).length - 1
      tags.push(`🎛 controlling${session.controllers.length > 1 || n ? ` ${n} ${n === 1 ? 'person' : 'people'}` : ''}`)
    } else if (session.controllers.length > 1) {
      const c = session.members.get(session.controllerOf(m.id))
      if (c) tags.push(`controlled by ${c.self ? 'you' : c.name}`)
    }
    if (!m.wants) tags.push('sitting out')
    if (session.allowed.includes(m.id)) tags.push('📌 picked')
    const g = genderLabel(p)
    const muted = !m.self && profile.muted.includes(p.uid)
    const feats = m.self ? toys.features() : (m.feats || [])
    const vol = !m.self && m.voice ? new Fader({vertical: false, value: voice.volumeOf(p.uid || m.id), label: 'Volume for ' + m.name, onInput: v => voice.setVolume(m.id, p.uid || m.id, v)}) : null
    const vMuted = voice.isMuted(p.uid || m.id)
    ul.append(el('li', {'data-peer': m.self ? 'self' : m.id},
      el('div', {class: 'who'},
        el('span', {class: 'av'}, p.avatar || '🙂'),
        el('div', {class: 'grow'},
          el('b', {style: `color:${p.color || 'inherit'}`}, m.name + (m.self ? ' (you)' : '')),
          el('div', {class: 'muted small'}, [g, ROLES[p.role] && p.role !== 'both' ? ROLES[p.role] : '', ...tags].filter(Boolean).join(' · '))),
        (m.self ? voice.joined : m.voice) ? el('span', {class: 'vbadge', title: 'In voice chat'}, (m.self ? voice.micOn : m.micOn) ? '🎙' : '🎙̸') : null,
        !m.self && p.uid ? el('button', {class: 'btn small ghost mute', title: muted ? 'Show their chat messages' : 'Hide their chat messages', onclick: () => toggleMute(p.uid)}, muted ? '💬̸' : '💬') : null),
      vol ? el('div', {class: 'vc'},
        el('button', {class: 'btn small ghost', title: vMuted ? 'Unmute their voice' : 'Mute their voice', onclick: () => { voice.toggleMute(m.id, p.uid || m.id); renderPeople() }}, vMuted ? '🔇' : '🔊'),
        vol.el) : null,
      session.isHost ? hostPickRow(m) : null,
      p.about ? el('div', {class: 'about'}, p.about) : null,
      el('div', {class: 'toys'}, m.toys?.length ? '🔌 ' + m.toys.join(', ') : 'No toys connected'),
      feats.length ? el('div', {class: 'feat-tags'}, feats.map(f => el('span', {}, FEATURE_LABELS[f] || f))) : null))
  })
}
// Host: hand-pick controllers
function hostPickRow(m) {
  const isCtl = session.isControllerId(m.id)
  const picked = session.allowed.includes(m.id)
  return el('div', {class: 'pick-row'},
    isCtl
      ? el('button', {class: 'btn small ghost', onclick: () => { session.removeController(m.id); toast(`${m.self ? 'You' : m.name} left the controls`) }}, '✖ Remove from controls')
      : el('button', {class: 'btn small', disabled: !m.wants, title: m.wants ? 'Give them the controls now' : 'They are sitting out (Take turns is off)',
        onclick: () => { if (session.makeController(m.id)) toast(`${m.self ? 'You have' : m.name + ' has'} the controls`) }}, '🎛 Make controller'),
    el('button', {class: 'btn small ghost' + (picked ? ' on' : ''), title: 'Only picked people take turns at the controls',
      onclick: () => session.setAllowed(m.id, !picked)}, picked ? '📌 Picked' : '📌 Pick'))
}
function renderPickNote() {
  if (!session?.isHost) return
  const n = session.allowed.length
  $('#pick-note').textContent = n
    ? `Only the ${n} picked ${n === 1 ? 'person takes' : 'people take'} turns at the controls. Tap 📌 on someone in the list to add or remove them.`
    : 'Everyone who ticks “Take turns” can control. Tap 📌 Pick on people above to give the controls only to them, or 🎛 Make controller to hand someone the controls right now.'
  $('#pick-clear').classList.toggle('hidden', !n)
}
$('#pick-clear').onclick = () => session?.clearAllowed()
function toggleMute(uid) {
  profile.muted = profile.muted.includes(uid) ? profile.muted.filter(u => u !== uid) : [...profile.muted, uid]
  saveProfile(profile)
  renderPeople()
}

let wasController = false
function renderTurn() {
  if (!session) return
  const me = session.isController
  const ctrls = session.controllers.map(id => session.members.get(id)).filter(Boolean)
  const mine = session.members.get(session.myController)
  let who = 'Nobody yet'
  if (me) {
    const n = session.groupOf(session.selfId).length - 1
    who = ctrls.length > 1 || n ? `You! Controlling ${n} ${n === 1 ? 'person' : 'people'} + yourself` : 'You! Take the controls'
  } else if (mine) {
    who = ctrls.length > 1 ? `${mine.name} controls you` : mine.name
  }
  $('#t-label').textContent = ctrls.length > 1 ? `Controllers (${ctrls.length}): ${ctrls.map(m => m.self ? 'you' : m.name).join(', ')}` : 'Controller'
  $('#t-who').textContent = who
  $('#t-who').classList.toggle('me', me)
  $('#t-pass').classList.toggle('hidden', !me)
  $('#t-skip').classList.toggle('hidden', !session.isHost || !ctrls.length || !session.settings?.rotate)
  $('#t-shuffle').classList.toggle('hidden', !session.isHost || !ctrls.length)
  $('#locked').classList.toggle('hidden', me)
  $('#locked-sub').textContent = session.settings?.rotate === false
    ? 'Rotation is off. The controls move when a controller passes or leaves.'
    : 'You’ll get them automatically when the timer rotates.'
  // a new seat at the controls starts from zero, so nobody inherits someone else's settings
  if (me !== wasController) { wasController = me; resetControls() }
  if (!me) stopRecording(true)
  renderPeople()
  renderMixer()
}

function tickTurnBar() {
  if (!session) return
  const st = session.settings
  if (st && !st.rotate) {
    $('#t-bar').style.width = session.controllers.length ? '100%' : '0%'
    $('#t-left').textContent = session.controllers.length ? 'Rotation is off: controllers keep the controls until they pass or leave.' : 'Controls start when someone opts in.'
    return
  }
  const total = (st?.turnSeconds || 1) * 1000
  const rem = session.controllers.length ? session.remaining : 0
  $('#t-bar').style.width = (rem / total * 100).toFixed(1) + '%'
  const next = session.controllers.length ? session.nextEligible([], session.controllers.length)
    .filter(id => !session.controllers.includes(id)).map(id => session.members.get(id)?.name).filter(Boolean) : []
  $('#t-left').textContent = session.controllers.length
    ? `${fmtTime(rem)} left${next.length ? ` · next: ${next.join(', ')}` : ''}`
    : 'Turns start when someone opts in.'
}

$('#t-wants').onchange = e => session?.update({wants: e.target.checked})
$('#t-pass').onclick = () => session?.pass()
$('#t-skip').onclick = () => session?.skip()
$('#t-shuffle').onclick = () => { session?.shuffle(); toast('Controllers shuffled') }

// ---------------- voice chat ----------------
function renderVoice() {
  $('#v-join').classList.toggle('hidden', voice.joined)
  $('#v-controls').classList.toggle('hidden', !voice.joined)
  $('#v-mic').textContent = voice.micOn ? '🎤 On' : '🎤 Muted'
  $('#v-mic').classList.toggle('off', voice.joined && !voice.micOn)
}
$('#v-join').onclick = async () => {
  if (!session) return
  try {
    await voice.join(session)
    session.update({voice: true, micOn: true})
    toast('You joined voice chat')
  } catch (e) { toast('Microphone blocked: ' + e.message) }
  renderVoice(); renderPeople()
}
function toggleMic() {
  if (!voice.joined) return
  voice.setMic(!voice.micOn)
  session?.update({micOn: voice.micOn})
  renderVoice(); renderPeople()
}
$('#v-mic').onclick = toggleMic
$('#v-leave').onclick = () => {
  voice.leave()
  session?.update({voice: false, micOn: false})
  renderVoice(); renderPeople()
}
// light up whoever is talking
setInterval(() => {
  if (!session) return
  for (const li of document.querySelectorAll('#people li[data-peer]')) li.classList.toggle('speaking', voice.speaking(li.dataset.peer))
}, 200)

// ---------------- chat ----------------
function addChat(m) {
  const log = $('#chat-log')
  const near = log.scrollHeight - log.scrollTop - log.clientHeight < 60
  let node
  if (m.action) node = el('button', {class: 'btn small', onclick: m.action.fn}, m.action.label)
  else if (m.sys) node = el('div', {class: 'msg sys'}, m.text)
  else node = el('div', {class: 'msg' + (m.self ? ' self' : '')},
    el('b', {style: `color:${m.profile?.color || 'var(--accent)'}`}, el('span', {class: 'av'}, m.profile?.avatar || ''), m.from), m.text)
  log.append(node)
  while (log.children.length > 300) log.firstChild.remove()
  if (near || m.self) log.scrollTop = log.scrollHeight
  const chatVisible = !$('[data-pane=chat]').classList.contains('hidden-mobile') || matchMedia('(min-width: 961px)').matches
  if (!m.sys && !m.self && !m.action && !chatVisible) {
    unread++
    $('#chat-badge').textContent = unread
    $('#chat-badge').classList.remove('hidden')
  }
}
$('#chat-form').onsubmit = e => {
  e.preventDefault()
  session?.chat($('#chat-input').value)
  $('#chat-input').value = ''
}

// ---------------- tabs (mobile) ----------------
function switchTab(name) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name))
  $$('.pane').forEach(p => p.classList.toggle('hidden-mobile', p.dataset.pane !== name))
  if (name === 'chat') { unread = 0; $('#chat-badge').classList.add('hidden') }
}
$$('.tab').forEach(t => t.onclick = () => switchTab(t.dataset.tab))

// ---------------- room level display ----------------
function renderLevel(o, src) {
  const peak = peakOf(o)
  $('#lvl-bar').style.width = pct(peak)
  $('#lvl-num').textContent = pct(peak)
  const who = session?.members.get(session.myController)?.name
  $('#lvl-src').textContent = peak > 0 && who ? `${who} · ${src || 'slider'}` : ''
  // per-feature bars for features someone in the room has
  const feats = session ? session.roomFeatures() : new Set()
  const box = $('#lvl-chans')
  const shown = CHANNELS.filter(c => feats.has(c.k) && !(feats.size === 1 && c.k === 'vibrate'))
  const keys = shown.map(c => c.k).join() + (o.pm ? '|pos' : '')
  if (box.dataset.keys !== keys) {
    box.dataset.keys = keys
    box.replaceChildren(...shown.map(c => el('div', {class: 'cb'}, c.k === 'stroke' && o.pm ? '📍 Stroke position' : `${c.icon} ${c.label}`, el('div', {}, el('div', {'data-lvl': c.k})))))
  }
  for (const c of shown) { const b = box.querySelector(`[data-lvl="${c.k}"]`); if (b) b.style.width = pct(c.k === 'stroke' && o.pm ? o.pos : o[c.k]) }
}

// ---------------- controls ----------------
$$('.seg-btn').forEach(b => b.onclick = () => setMode(b.dataset.mode))
function setMode(m) {
  mode = m
  $$('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === m))
  $$('[data-mode-pane]').forEach(p => p.classList.toggle('hidden', p.dataset.modePane !== m))
  if (m !== 'pattern') { pattern = null; renderPatterns() }
}
function resetControls() {
  // a new seat at the controls starts from zero so nobody inherits someone else's settings
  setMain(0)
  pattern = null
  for (const k of CHANNEL_KEYS) mixer[k] = {linked: true, val: 0}
  setRange(0, 1)
  renderMixer(true)
  renderPatterns()
  if (!session?.isController) { stopMusic(); stopFeed(); stopScroll() }
  $('#feed-card').classList.toggle('hidden', !session?.isController)
}

// Main fader (manual mode)
const mainFader = new Fader({value: 0, label: 'Main level', onInput: v => { $('#slider-num').textContent = pct(v) }})
$('#main-fader').replaceWith(mainFader.el)
mainFader.el.id = 'main-fader'
function setMain(v) {
  mainFader.set(v)
  $('#slider-num').textContent = pct(mainFader.value)
}
$$('[data-preset]').forEach(b => b.onclick = () => setMain(b.dataset.preset / 100))

// Feature desk: a fader per feature, each linked to the main level or set by hand.
const featFaders = {}
function renderMixer(force) {
  const box = $('#mixer')
  if (force || !box.children.length) {
    box.replaceChildren(...CHANNELS.map(c => {
      const f = new Fader({value: mixer[c.k].val, label: c.label, onInput: v => {
        mixer[c.k] = {linked: false, val: v}
        updateChannel(c.k)
      }})
      featFaders[c.k] = f
      const link = el('button', {type: 'button', class: 'link' + (mixer[c.k].linked ? ' on' : ''), title: mixer[c.k].linked ? 'Following the main level. Tap to set by hand.' : 'Set by hand. Tap to follow the main level.',
        onclick: () => toggleLink(c.k)}, mixer[c.k].linked ? '🔗 main' : '✋ hand')
      return el('div', {class: 'ch' + (mixer[c.k].linked ? ' linked' : ''), 'data-ch': c.k},
        el('div', {class: 'ch-val', 'data-chv': c.k}, pct(mixer[c.k].val)),
        f.el, el('div', {class: 'ch-name'}, c.icon + ' ' + c.label + (c.k === 'stroke' && strokerMode === 'pos' ? ' (auto)' : '')), link)
    }))
  }
  // show the features the people I control actually have
  const feats = session?.isController ? session.roomFeatures(session.selfId) : (session ? session.roomFeatures() : new Set())
  const all = $('#show-all-feats').checked || feats.size === 0
  for (const c of CHANNELS) box.querySelector(`[data-ch="${c.k}"]`)?.classList.toggle('hidden', !all && !feats.has(c.k))
  $('#range-box').classList.toggle('hidden', !all && !feats.has('range'))
}
// update one feature's label and link button in place (never rebuild mid-drag)
function updateChannel(k) {
  const box = $(`[data-ch="${k}"]`)
  if (!box) return
  const linked = mixer[k].linked
  box.classList.toggle('linked', linked)
  const link = box.querySelector('.link')
  link.classList.toggle('on', linked)
  link.textContent = linked ? '🔗 main' : '✋ hand'
  link.title = linked ? 'Following the main level. Tap to set by hand.' : 'Set by hand. Tap to follow the main level.'
  if (!linked) box.querySelector('.ch-val').textContent = pct(mixer[k].val)
}
function toggleLink(k) {
  mixer[k].linked = !mixer[k].linked
  if (!mixer[k].linked) mixer[k].val = featFaders[k]?.value || 0
  updateChannel(k)
}
$('#show-all-feats').onchange = () => renderMixer()

// Stroke range bar
const rangeBar = new RangeBar({lo: 0, hi: 1, onInput: (lo, hi) => { range.lo = lo; range.hi = hi; renderRange() }})
$('#range-bar').replaceWith(rangeBar.el)
function setRange(lo, hi) { rangeBar.set(lo, hi); range.lo = rangeBar.lo; range.hi = rangeBar.hi; renderRange() }
const posMark = el('div', {class: 'r-pos', hidden: true, title: 'Where the stroker is now'})
rangeBar.el.append(posMark)
function setStrokerMode(m, quiet) {
  strokerMode = m === 'pos' ? 'pos' : 'speed'
  store.set('tr-stroker-mode', strokerMode)
  $$('#stroker-mode .sm-btn').forEach(b => { const on = b.dataset.sm === strokerMode; b.classList.toggle('active', on); b.setAttribute('aria-checked', String(on)) })
  $('#stroker-hint').textContent = strokerMode === 'pos'
    ? '📍 Position: the main level (slider, pattern or music) is where the stroker is inside the range. 0% = bottom of the range, 100% = top. Funscripts play their exact positions.'
    : '🔁 Speed + range: the main level is the stroke speed and the stroker moves up and down inside the range by itself.'
  posMark.hidden = strokerMode !== 'pos'
  $('[data-ch="stroke"] .ch-name')?.replaceChildren('🔁 Stroke speed' + (strokerMode === 'pos' ? ' (auto)' : ''))
  if (!quiet) toast(strokerMode === 'pos' ? 'Stroker: position control' : 'Stroker: speed + range control')
}
$$('#stroker-mode .sm-btn').forEach(b => b.onclick = () => setStrokerMode(b.dataset.sm))
function renderRange() {
  $('#range-num').textContent = `${Math.round(range.lo * 100)}–${Math.round(range.hi * 100)}%`
}

// ---------------- keyboard shortcuts ----------------
let keys = loadKeys()
let keyMap = lookup(keys)
let listening = null
function renderKeys() {
  $('#keys-enabled').checked = keys.enabled
  $('#step-main').value = keys.steps.main
  $('#step-range').value = keys.steps.range
  $('#step-feature').value = keys.steps.feature
  $('#keys-list').replaceChildren(...ACTIONS.map(a => el('div', {class: 'key-row'},
    el('span', {}, a.label),
    el('button', {type: 'button', class: 'btn small' + (listening === a.id ? ' listening' : ''), onclick: () => { listening = a.id; renderKeys() }},
      listening === a.id ? 'Press a key…' : prettyCombo(keys.binds[a.id])))))
}
function persistKeys() { saveKeys(keys); keyMap = lookup(keys) }
$('#keys-btn').onclick = () => { listening = null; renderKeys(); $('#keys-modal').classList.remove('hidden') }
$('#keys-close').onclick = () => { listening = null; $('#keys-modal').classList.add('hidden') }
$('#keys-modal').onclick = e => { if (e.target.id === 'keys-modal') $('#keys-close').click() }
$('#keys-enabled').onchange = e => { keys.enabled = e.target.checked; persistKeys() }
for (const k of ['main', 'range', 'feature']) {
  $('#step-' + k).onchange = e => { keys.steps[k] = Math.max(1, Math.min(50, +e.target.value || DEFAULT_STEPS[k])); persistKeys() }
}
$('#keys-reset').onclick = () => { keys = defaultKeys(); listening = null; persistKeys(); renderKeys() }

function runAction(id) {
  const st = keys.steps
  if (id === 'pause') return $('#panic').click()
  if (id === 'toggleMic') return toggleMic()
  if (!session?.isController) return
  const nudgeMain = d => { if (mode !== 'manual') setMode('manual'); setMain(mainFader.value + d) }
  const builtins = Object.keys(PATTERNS)
  switch (id) {
    case 'mainUp': return nudgeMain(st.main / 100)
    case 'mainDown': return nudgeMain(-st.main / 100)
    case 'mainZero': return setMain(0)
    case 'mainMax': return setMain(1)
    case 'rangeUp': return rangeBar.shift(st.range / 100)
    case 'rangeDown': return rangeBar.shift(-st.range / 100)
    case 'rangeWiden': return rangeBar.resize(st.range / 100 * 2)
    case 'rangeNarrow': return rangeBar.resize(-st.range / 100 * 2)
    case 'modeManual': return setMode('manual')
    case 'modePattern': return setMode('pattern')
    case 'modeMusic': return setMode('music')
    case 'modeScreen': return setMode('screen')
    case 'strokerMode': return setStrokerMode(strokerMode === 'pos' ? 'speed' : 'pos')
    case 'nextPattern': {
      if (mode !== 'pattern') setMode('pattern')
      const list = [...builtins, ...library.map(p => 'lib:' + p.id)]
      pattern = list[(list.indexOf(pattern) + 1) % list.length]
      patternStart = performance.now()
      return renderPatterns()
    }
    case 'pass': return session.pass()
  }
  const m = id.match(/^(\w+?)(Up|Down|Link)$/)
  if (m && mixer[m[1]]) {
    const k = m[1]
    if (m[2] === 'Link') return toggleLink(k)
    const v = Math.max(0, Math.min(1, (mixer[k].linked ? featFaders[k].value : mixer[k].val) + (m[2] === 'Up' ? 1 : -1) * st.feature / 100))
    mixer[k] = {linked: false, val: v}
    featFaders[k].set(v)
    updateChannel(k)
  }
}

addEventListener('keydown', e => {
  if (listening) {
    e.preventDefault()
    if (e.key === 'Backspace' || e.key === 'Delete') keys.binds[listening] = ''
    else {
      const c = comboOf(e)
      if (!c) return
      // a key can only do one thing
      for (const [id, v] of Object.entries(keys.binds)) if (v === c) keys.binds[id] = ''
      keys.binds[listening] = c
    }
    listening = null
    persistKeys()
    return renderKeys()
  }
  if (!keys.enabled) return
  const t = e.target
  if (t.closest?.('input, textarea, select, [contenteditable], .modal')) return
  // a focused fader or range bar uses the plain arrow keys itself
  if ((t.classList?.contains('fader') || t.classList?.contains('rangebar')) && !e.shiftKey && e.key.startsWith('Arrow')) return
  const id = keyMap.get(comboOf(e))
  if (!id) return
  e.preventDefault()
  runAction(id)
})

// ---------------- gamepad ----------------
const padAcc = {}
// small stick moves add up until they make a whole step
function padStep(id, d, unit, fn) {
  padAcc[id] = (padAcc[id] || 0) + d
  const steps = Math.trunc(padAcc[id] / unit)
  if (steps) { padAcc[id] -= steps * unit; fn(steps * unit) }
}
const MODES = ['manual', 'pattern', 'music', 'screen']
function runPad(id) {
  if (id === 'cycleMode') return session?.isController && setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length])
  if (id === 'musicPlay') return session?.isController && $('#m-pause').click()
  if (id === 'musicBack') return session?.isController && musicSeekBy(-10)
  if (id === 'musicFwd') return session?.isController && musicSeekBy(10)
  runAction(id)
}
const pad = new GamepadInput({
  onButton: runPad,
  onAnalog(id, v, dt) {
    if (!session?.isController) return
    if (id === 'mainSet') { if (mode !== 'manual') setMode('manual'); return setMain(v) }
    if (id === 'mainRate') { if (mode !== 'manual') setMode('manual'); return setMain(mainFader.value + v * dt) }
    if (id === 'rangeMove') return padStep(id, v * dt * 0.6, 0.01, d => rangeBar.shift(d))
    if (id === 'rangeSize') return padStep(id, v * dt * 0.6, 0.02, d => rangeBar.resize(d))
    if (id === 'patternSpeed') return padStep(id, v * dt * 100, 1, d => { const r = $('#p-speed'); r.value = +r.value + d; r.oninput({target: r}) })
    if (id === 'musicSeek') return padStep(id, v * dt * 20, 1, d => { if (musicDur()) musicSeekBy(d) })
  },
  onChange: renderPad
})
let padListening = null
function renderPad() {
  const p = pad.pad
  $('#pad-dot').classList.toggle('hidden', !p)
  if ($('#pad-modal').classList.contains('hidden')) return
  const fam = familyOf(p)
  $('#pad-status').textContent = !pad.supported ? 'This browser has no gamepad support.'
    : p ? `✅ ${padName(p)} connected${p.mapping === 'standard' ? '' : ' (non-standard layout: bind each control yourself)'}.`
      : '🎮 No gamepad found. Connect it by USB or Bluetooth, then press any button on it.'
  const c = pad.cfg
  $('#pad-enabled').checked = c.enabled
  $('#pad-rumble').checked = c.rumble
  $('#pad-dz').value = Math.round(c.deadzone * 100); $('#pad-dz-num').textContent = Math.round(c.deadzone * 100) + '%'
  $('#pad-speed').value = Math.round(c.speed * 100); $('#pad-speed-num').textContent = c.speed.toFixed(1) + '×'
  const bindBtn = (key, code) => el('button', {type: 'button', class: 'btn small' + (padListening === key ? ' listening' : ''), onclick: () => listenPad(key)},
    padListening === key ? 'Move or press…' : inputLabel(code, fam))
  const clear = (fn) => el('button', {type: 'button', class: 'btn small ghost', title: 'Clear', onclick: () => { fn(); pad.save(); renderPad() }}, '✕')
  $('#pad-analog').replaceChildren(...ANALOG.map(a => el('div', {class: 'key-row'}, el('span', {}, a.label),
    el('span', {class: 'row gap'}, bindBtn('a:' + a.id, c.analog[a.id]), clear(() => { c.analog[a.id] = '' })))))
  $('#pad-buttons').replaceChildren(...PAD_ACTIONS.map(a => el('div', {class: 'key-row'}, el('span', {}, a.label),
    el('span', {class: 'row gap'}, bindBtn('b:' + a.id, c.buttons[a.id]), clear(() => { delete c.buttons[a.id] })))))
}
function listenPad(key) {
  padListening = key
  renderPad()
  if (!pad.pad) toast('Press any button on the gamepad first so the browser can see it')
  pad.capture = code => {
    const [kind, id] = key.split(':')
    const c = pad.cfg
    if (kind === 'a') {
      // a trigger is a button with an analog value; sticks are axes
      for (const k of Object.keys(c.analog)) if (c.analog[k] === code) c.analog[k] = ''
      c.analog[id] = code
    } else {
      for (const k of Object.keys(c.buttons)) if (c.buttons[k] === code) delete c.buttons[k]
      c.buttons[id] = code.replace('-', '')
    }
    padListening = null
    pad.save()
    renderPad()
  }
  pad.start()
}
$('#pad-btn').onclick = () => { padListening = null; $('#pad-modal').classList.remove('hidden'); renderPad() }
$('#pad-close').onclick = () => { padListening = null; pad.capture = null; $('#pad-modal').classList.add('hidden') }
$('#pad-modal').onclick = e => { if (e.target.id === 'pad-modal') $('#pad-close').click() }
$('#pad-enabled').onchange = e => { pad.cfg.enabled = e.target.checked; pad.save() }
$('#pad-rumble').onchange = e => { pad.cfg.rumble = e.target.checked; pad.save(); if (!e.target.checked) pad.rumble(0) }
$('#pad-dz').oninput = e => { pad.cfg.deadzone = e.target.value / 100; pad.save(); renderPad() }
$('#pad-speed').oninput = e => { pad.cfg.speed = e.target.value / 100; pad.save(); renderPad() }
$('#pad-reset').onclick = () => { pad.cfg = defaultPad(); pad.save(); renderPad() }
// live status while the window is open, and rumble with my toy level
setInterval(() => {
  pad.rumble(session ? peakOf(toys.effective) : 0)
}, 200)

// ---------------- patterns & library ----------------
function renderPatterns() {
  $('#pattern-grid').replaceChildren(...Object.entries(PATTERNS).map(([k, p]) =>
    el('button', {class: 'btn' + (pattern === k ? ' sel' : ''), onclick: () => selectPattern(k)}, p.label)))
  $('#lib-count').textContent = library.length ? `${library.length} saved` : ''
  $('#library-grid').replaceChildren(...(library.length ? library.map(p => {
    const key = 'lib:' + p.id
    return el('div', {class: 'btn' + (pattern === key ? ' sel' : ''), role: 'button', tabindex: 0, onclick: () => selectPattern(key)},
      el('span', {}, p.name, el('small', {}, `${p.source} · ${fmtTime(durationOf(p) * 1000)}`)),
      el('span', {class: 'x', title: 'Delete', onclick: e => { e.stopPropagation(); deletePattern(p.id) }}, '✕'))
  }) : [el('div', {class: 'muted small'}, 'Nothing saved yet. Import a pattern or record one.')]))
}
function selectPattern(k) {
  pattern = pattern === k ? null : k
  patternStart = performance.now()
  renderPatterns()
}
function deletePattern(id) {
  if (!confirm('Delete this pattern?')) return
  library = library.filter(p => p.id !== id)
  saveLibrary(library)
  if (pattern === 'lib:' + id) pattern = null
  renderPatterns()
}
function addToLibrary(parsed, name) {
  const p = makePattern(parsed, name)
  library = [p, ...library]
  if (!saveLibrary(library)) {
    library = library.slice(1)
    return toast('Browser storage is full. Delete some patterns first.')
  }
  renderPatterns()
  toast(`Saved “${p.name}” (${fmtTime(durationOf(p) * 1000)})`)
}
function importText(text, name) {
  try { addToLibrary(parsePattern(text, name), name.replace(/\.[^.]+$/, '')) } catch (e) { toast('Could not import: ' + e.message) }
}
$('#lib-file').onchange = async e => {
  const f = e.target.files[0]
  if (f) importText(await f.text(), f.name)
  e.target.value = ''
}
$('#lib-url').onclick = async () => {
  const url = prompt('Link to a pattern file (.funscript, Lovense pattern, JSON or CSV)')
  if (!url) return
  try {
    const r = await fetch(url)
    if (!r.ok) throw new Error('HTTP ' + r.status)
    importText(await r.text(), decodeURIComponent(url.split('/').pop().split('?')[0]) || 'Linked pattern')
  } catch (e) {
    toast('That site does not allow loading from here. Download the file and use Import file instead.')
  }
}
$('#lib-paste').onclick = () => {
  const text = prompt('Paste a pattern (Lovense pattern text, funscript JSON or numbers)')
  if (text) importText(text, prompt('Name this pattern', 'Pasted pattern') || 'Pasted pattern')
}
$('#rec-btn').onclick = () => {
  if (recorder.active) return stopRecording(true)
  if (!session?.isController) return toast('Record while you have the controls')
  recorder.start()
  $('#rec-btn').classList.add('on')
  $('#rec-btn').textContent = '⏹ Stop recording'
  toast('Recording everything you do with the controls')
}
function stopRecording(save) {
  if (!recorder.active) return
  const rec = recorder.stop()
  $('#rec-btn').classList.remove('on')
  $('#rec-btn').textContent = '⏺ Record'
  if (save && rec) addToLibrary(rec, prompt('Name your recording', 'My pattern') || 'My pattern')
}
// ---------------- browse pattern sources ----------------
let browseItems = []
function openBrowse() {
  const list = sources()
  $('#browse-source').replaceChildren(...list.map(s => el('option', {value: s.id}, s.name + (s.ready ? '' : ' (not connected)'))))
  $('#browse-modal').classList.remove('hidden')
  loadBrowse()
}
let browseTimer
async function loadBrowse() {
  const src = sources().find(s => s.id === $('#browse-source').value)
  const box = $('#browse-list')
  const embed = src?.type === 'embed'
  $('#browse-embed').classList.toggle('hidden', !embed)
  $('#browse-q').classList.toggle('hidden', embed)
  $('#browse-modal .modal-card').classList.toggle('embed-mode', embed)
  $('#browse-note').textContent = src?.ready ? '' : (src?.setupHint || '')
  box.replaceChildren()
  if (embed) {
    if ($('#embed-frame').getAttribute('src') !== src.url) $('#embed-frame').src = src.url
    $('#embed-open').href = src.url
    $('#browse-note').textContent = 'This is the real XToys site. If it stays blank, use "Open in new tab".'
    return
  }
  if (!src?.ready) return
  box.append(el('div', {class: 'muted small'}, 'Loading…'))
  try {
    browseItems = await listPatterns(src, $('#browse-q').value)
    box.replaceChildren(...(browseItems.length ? browseItems.map(p => el('div', {class: 'b-item'},
      el('div', {class: 'grow'},
        el('b', {}, p.name),
        el('div', {}, [p.description, p.author && 'by ' + p.author].filter(Boolean).join(' · ')),
        el('div', {class: 'tags'}, [p.format, ...p.tags].filter(Boolean).map(t => el('span', {}, t)))),
      el('button', {class: 'btn small primary', onclick: async e => {
        e.target.disabled = true
        try { addToLibrary(parsePattern(await downloadPattern(src, p), p.url || ''), p.name) } catch (err) { toast('Could not add: ' + err.message); e.target.disabled = false }
      }}, '＋ Save'))) : [el('div', {class: 'muted small'}, 'No patterns found.')]))
  } catch (e) {
    box.replaceChildren(el('div', {class: 'muted small'}, e.message))
  }
}
$('#lib-browse').onclick = openBrowse

// Bring a pattern over from the embedded site
function saveEmbedded(text, name) {
  try {
    const t = extractPatternText(text)
    addToLibrary(parsePattern(t, name || ''), ($('#embed-name').value.trim() || (name || 'XToys pattern').replace(/\.[^.]+$/, '')))
    $('#embed-text').value = ''
    $('#embed-name').value = ''
  } catch (e) { toast('Could not read that pattern: ' + e.message) }
}
$('#embed-save').onclick = () => saveEmbedded($('#embed-text').value)
$('#embed-clip').onclick = async () => {
  try {
    const t = await navigator.clipboard.readText()
    if (!t.trim()) return toast('The clipboard is empty')
    $('#embed-text').value = t
    saveEmbedded(t)
  } catch { toast('Clipboard access was blocked. Paste into the box instead.') }
}
$('#embed-file').onchange = async e => {
  const f = e.target.files[0]
  if (f) saveEmbedded(await f.text(), f.name)
  e.target.value = ''
}
const drop = $('#embed-drop')
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over') })
drop.addEventListener('dragleave', () => drop.classList.remove('over'))
drop.addEventListener('drop', async e => {
  e.preventDefault()
  drop.classList.remove('over')
  const f = e.dataTransfer.files[0]
  if (f) return saveEmbedded(await f.text(), f.name)
  const t = e.dataTransfer.getData('text/plain')
  if (t) saveEmbedded(t)
})
$('#browse-source').onchange = loadBrowse
$('#browse-q').oninput = () => { clearTimeout(browseTimer); browseTimer = setTimeout(loadBrowse, 300) }
$('#browse-close').onclick = () => $('#browse-modal').classList.add('hidden')
$('#browse-modal').onclick = e => { if (e.target.id === 'browse-modal') $('#browse-close').click() }

$('#p-speed').oninput = e => { $('#p-speed-num').textContent = (e.target.value / 100).toFixed(1) + '×' }
$('#p-max').oninput = e => { $('#p-max-num').textContent = e.target.value + '%' }
$('#p-stop').onclick = () => { pattern = null; renderPatterns() }

// ---------------- music ----------------
$('#m-file').onchange = async e => {
  const f = e.target.files[0]
  if (!f) return
  try {
    await music.playFile(f)
    $('#m-now').textContent = '▶ ' + f.name
    $('#m-pause').disabled = $('#m-stop').disabled = false
    myMusic = {src: {kind: 'stream'}, title: f.name.slice(0, 80)}
    updateSharing()
    sendMusicState()
  } catch (err) { toast('Could not play that file: ' + err.message) }
  e.target.value = ''
}
$('#m-mic').onclick = async () => {
  try {
    await music.useMic()
    $('#m-now').textContent = '🎤 Listening to your microphone'
    $('#m-stop').disabled = false
    $('#m-pause').disabled = true
    updateSharing()
  } catch (err) { toast('Microphone blocked: ' + err.message) }
}
$('#m-pause').onclick = () => { music.togglePause(); setTimeout(sendMusicState, 200) }
$('#m-stop').onclick = stopMusic
$('#m-sens').oninput = e => { music.sensitivity = e.target.value / 100; $('#m-sens-num').textContent = music.sensitivity.toFixed(1) + '×' }
$$('[name=m-focus]').forEach(r => r.onchange = () => { music.focus = r.value })
$('#m-share').onchange = updateSharing
$('#m-scope').onchange = () => { updateSharing(); sendMusicState() }
function updateSharing() {
  const want = $('#m-share').checked && session?.isController && music.isFile
  if (want && !musicShare) musicShare = new GroupShare(music.shareStream, {kind: 'music'}, () => $('#m-scope').value)
  if (!want && musicShare) { musicShare.stop(); musicShare = null }
  syncShares()
}
function stopMusic() {
  const had = !!myMusic
  if (music.extStream) music.beatOn = false; else music.stop()
  $('#m-now').textContent = ''
  $('#m-pause').disabled = $('#m-stop').disabled = true
  if (musicShare) { musicShare.stop(); musicShare = null }
  myMusic = null
  if (had) session?.sendMedia({slot: 'music', src: null, scope: $('#m-scope').value})
}

$('#m-beat').onchange = e => { music.beatOn = e.target.checked; music.beatZero = performance.now() }
$('#m-bpm').onchange = e => { music.bpm = Math.max(40, Math.min(220, +e.target.value || 120)); e.target.value = music.bpm }
$('#m-taptempo').onclick = () => { $('#m-bpm').value = music.tap(); if (!music.beatOn) { music.beatOn = true; $('#m-beat').checked = true } }

// DJ bar: position, seek and my own volume
const musicTime = () => music.time
const musicDur = () => music.duration
function musicSeekBy(d) {
  music.seekBy(d)
  setTimeout(sendMusicState, 250)
}
$('#m-back').onclick = () => musicSeekBy(-10)
$('#m-fwd').onclick = () => musicSeekBy(10)
let seeking = false
$('#m-seek').oninput = e => { seeking = true; $('#m-time').textContent = fmtClock(e.target.value / 1000 * musicDur()) }
$('#m-seek').onchange = e => {
  seeking = false
  const t = e.target.value / 1000 * musicDur()
  music.seekTo(t)
  setTimeout(sendMusicState, 250)
}
$('#m-vol').oninput = e => {
  const v = e.target.value / 100
  music.setVolume(v)
  $('#m-vol-num').textContent = e.target.value + '%'
}
const fmtClock = sec => { sec = Math.max(0, Math.floor(sec || 0)); const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s2 = String(sec % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${s2}` : `${m}:${s2}` }
setInterval(() => {
  const dur = musicDur()
  $('#m-seek').disabled = !dur
  if (!seeking) {
    $('#m-seek').value = dur ? Math.round(musicTime() / dur * 1000) : 0
    $('#m-time').textContent = fmtClock(musicTime())
  }
  $('#m-dur').textContent = fmtClock(dur)
  renderNpTime()
}, 250)

// ---------------- shared media: music and live feed for my group ----------------
// A stream I send to the people I control (or to the whole room). Keeps itself up to date
// as people join, leave or move between groups.
class GroupShare {
  constructor(stream, meta, scope = () => 'group') { this.stream = stream; this.meta = meta; this.scope = scope; this.to = new Set() }
  targets() {
    if (!session?.isController) return []
    if (this.scope() === 'room') return [...session.members.keys()].filter(id => id !== session.selfId)
    return session.groupOf(session.selfId).filter(id => id !== session.selfId)
  }
  sync() {
    if (!session) return
    const want = new Set(this.targets())
    for (const id of want) if (!this.to.has(id)) { session.addStream(this.stream, id, this.meta); this.to.add(id) }
    for (const id of [...this.to]) {
      if (want.has(id)) continue
      if (session.members.has(id)) session.removeStream(this.stream, id)
      this.to.delete(id)
    }
  }
  stop() { for (const id of this.to) if (session?.members.has(id)) session.removeStream(this.stream, id); this.to.clear() }
}
let musicShare = null, feedShare = null
function syncShares() { musicShare?.sync(); feedShare?.sync() }

// my (controller) side
let myMusic = null, myFeed = null
function sendMusicState(target) {
  if (!session?.isController || !myMusic) return
  const st = music.isFile ? {playing: !music.audio.paused, t: music.time} : null
  session.sendMedia({slot: 'music', scope: $('#m-scope').value, src: myMusic.src, title: myMusic.title, ...(st || {}), dur: musicDur()}, target)
}
function sendFeedState(target) {
  if (!session?.isController || !myFeed) return
  const st = myFeed.src.kind === 'stream' ? null : feedPlayer.state()
  session.sendMedia({slot: 'feed', src: myFeed.src, title: myFeed.title, ...(st || {})}, target)
}
function sendMediaState() { sendMusicState(); sendFeedState(); sendScrollState() }
setInterval(() => { if (session?.isController) sendMediaState() }, 5000) // late joiners and drift

// receiving side: only from my own controller (music shared with the whole room: any controller)
const incoming = {music: null, feed: null, scroll: null}
const renderSlot = slot => slot === 'music' ? renderNowPlaying() : slot === 'feed' ? renderFeed() : renderScroll()
let musicStreamFrom = null, feedStream = null
const streamKinds = new Map() // stream id -> 'voice' | 'music' | 'feed'
function acceptMedia(slot, d, id) {
  if (!session || id === session.selfId) return false
  if (id === session.myController) return true
  return slot === 'music' && d?.scope === 'room' && session.isControllerId(id)
}
function onMedia(d, id) {
  const slot = ['music', 'feed', 'scroll'].includes(d.slot) ? d.slot : null
  if (!slot || !acceptMedia(slot, d, id)) return
  if (!d.src) { if (incoming[slot]?.from === id) { incoming[slot] = null; renderSlot(slot) } return }
  // never trust a peer's embed details: rebuild them from the link
  const src = d.src.kind === 'stream' ? {kind: 'stream'} : parseMediaLink(String(d.src.url || '').slice(0, 2000))
  if (!src || (src.kind !== 'stream' && src.url?.startsWith('blob:'))) return
  if ((slot === 'scroll') !== (src.kind === 'scrolller')) return // the Scrolller window only shows Scrolller categories
  incoming[slot] = {from: id, src, title: String(d.title || '').slice(0, 80), playing: !!d.playing, t: Math.max(0, +d.t || 0), dur: Math.max(0, +d.dur || 0), got: performance.now(), seen: Date.now()}
  renderSlot(slot)
}
function checkMediaSources() {
  for (const slot of ['music', 'feed', 'scroll']) {
    const m = incoming[slot]
    if (m && !acceptMedia(slot, {scope: 'room'}, m.from) && m.from !== session?.myController) { incoming[slot] = null }
    if (m && Date.now() - m.seen > 16000) incoming[slot] = null
  }
  renderNowPlaying(); renderFeed(); renderScroll()
}
setInterval(() => { if (session) checkMediaSources() }, 4000)

function renderNowPlaying() {
  const m = incoming.music
  const streamOn = !!musicStreamFrom && !!$('#room-audio').srcObject && (m?.src.kind === 'stream' || !m)
  $('#np-card').classList.toggle('hidden', !m && !streamOn)
  if (!m) return
  const who = session?.members.get(m.from)?.name || 'The controller'
  $('#np-from').textContent = `from ${who}`
  $('#np-title').textContent = m.title || mediaLabel(m.src)
}
function renderNpTime() {
  const m = incoming.music
  if (!m) return
  const t = m.t + (m.playing ? (performance.now() - m.got) / 1000 : 0)
  $('#np-time').textContent = (m.playing ? '▶ ' : '⏸ ') + fmtClock(t) + (m.dur ? ' / ' + fmtClock(m.dur) : '')
}
$('#np-vol').oninput = e => {
  const v = e.target.value / 100
  $('#np-vol-num').textContent = e.target.value + '%'
  $('#room-audio').volume = v
  store.set('tr-music-vol', e.target.value)
}
$('#np-vol').value = store.get('tr-music-vol', '100'); $('#np-vol').oninput({target: $('#np-vol')})
$('#np-tap').onclick = () => { $('#room-audio').play().catch(() => {}); $('#np-tap').classList.add('hidden') }

// ---------------- screen share mode ----------------
// The controller shares a tab / window / screen with its sound. It goes peer-to-peer to
// the people they control (shown in the live feed window), and the toys follow the sound.
const canShareScreen = !!navigator.mediaDevices?.getDisplayMedia
$('#s-unsupported').hidden = canShareScreen
$('#s-start').disabled = !canShareScreen
$('#s-start').onclick = async () => {
  if (!session?.isController) return toast('Only controllers can share their screen')
  let stream
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: {frameRate: {ideal: 24, max: 30}},
      audio: {echoCancellation: false, noiseSuppression: false, autoGainControl: false},
      systemAudio: 'include', selfBrowserSurface: 'exclude', surfaceSwitching: 'include'
    })
  } catch (e) { return toast(e.name === 'NotAllowedError' ? 'Screen sharing was cancelled' : 'Could not share: ' + e.message) }
  const hasAudio = stream.getAudioTracks().length > 0
  if (!$('#s-video').checked) stream.getVideoTracks().forEach(t => { t.enabled = false })
  stopFeed(true)
  feedHidden = false
  feedPlayer.leader = true
  await feedPlayer.load({kind: 'stream', stream, id: stream.id})
  feedPlayer.selfMuted = true // you already hear it; avoids an echo
  feedPlayer.setVolume(feedPlayer.volume)
  updateFeedFoot()
  showFeedWindow(true, '🖥 Your screen share', '')
  feedShare = new GroupShare(stream, {kind: 'feed'})
  feedShare.sync()
  myFeed = {src: {kind: 'stream'}, title: '🖥 Screen share', screen: stream}
  if (hasAudio) music.useStream(stream)
  sendFeedState()
  $('#s-start').disabled = true; $('#s-stop').disabled = $('#feed-stop').disabled = false
  $('#s-now').textContent = hasAudio ? '🔴 Sharing with sound. Toys follow it in Screen mode.' : '⚠️ Sharing without sound, so toys have nothing to follow. Share a tab with “Share tab audio” ticked.'
  $('#feed-state').textContent = 'showing: screen share'
  // the browser's own "Stop sharing" button
  stream.getVideoTracks()[0]?.addEventListener('ended', () => { if (myFeed?.screen === stream) stopFeed() })
  if (mode !== 'screen') setMode('screen')
}
$('#s-stop').onclick = () => stopFeed()
$('#s-video').onchange = e => myFeed?.screen?.getVideoTracks().forEach(t => { t.enabled = e.target.checked })
$('#s-sens').oninput = e => { music.sensitivity = e.target.value / 100; $('#s-sens-num').textContent = music.sensitivity.toFixed(1) + '×'; $('#m-sens').value = e.target.value; $('#m-sens-num').textContent = $('#s-sens-num').textContent }
$$('[name=s-focus]').forEach(r => r.onchange = () => { music.focus = r.value })

// ---------------- live feed ----------------
const feedPlayer = new EmbedPlayer($('#fm-body'), {onState: () => sendFeedState(), onNeedTap: () => $('#fm-tap').classList.remove('hidden')})
let feedHidden = false
function showFeedWindow(on, title, link) {
  $('#feed-mini').classList.toggle('hidden', !on || feedHidden)
  $('#fm-show').classList.toggle('hidden', !on || !feedHidden)
  if (!on) return
  $('#fm-title').textContent = title
  $('#fm-open').classList.toggle('hidden', !link)
  if (link) $('#fm-open').href = link
}
async function renderFeed() {
  if (session?.isController && myFeed) return
  const m = incoming.feed
  if (!m) { if (!myFeed) { feedPlayer.destroy(); showFeedWindow(false) } return }
  const who = session?.members.get(m.from)?.name || 'Controller'
  showFeedWindow(true, `📺 ${m.title || mediaLabel(m.src)} · ${who}`, m.src.kind === 'stream' ? '' : m.src.url)
  feedPlayer.leader = false
  feedPlayer.selfMuted = false
  applyFeedVolume()
  try {
    if (m.src.kind === 'stream') {
      if (!feedStream || feedStream.from !== m.from) return
      await feedPlayer.load({kind: 'stream', stream: feedStream.stream, id: feedStream.stream.id})
    } else {
      await feedPlayer.load(m.src)
      feedPlayer.apply({playing: m.playing, t: m.t, got: m.got})
    }
  } catch (e) { $('#fm-title').textContent = e.message }
  updateFeedFoot()
}
// the volume bar only works for streams and video files; embedded sites have their own
function updateFeedFoot() {
  const own = ['stream', 'video'].includes(feedPlayer.kind)
  $('#fm-volbox').classList.toggle('hidden', !own)
  $('#fm-volnote').classList.toggle('hidden', own || !feedPlayer.kind)
}
// Toys follow what the controller hears: capture this tab's own sound (the browser asks).
async function captureOwnTab() {
  const s = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: {echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false},
    preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude', systemAudio: 'exclude'
  })
  s.getVideoTracks().forEach(t => t.stop())
  if (!s.getAudioTracks().length) { s.getTracks().forEach(t => t.stop()); throw new Error('No sound was shared. Choose this tab and keep “Share tab audio” on.') }
  return s
}
function followFeedSound(stream, label) {
  music.useStream(stream)
  if (mode !== 'screen') setMode('screen')
  $('#s-now').textContent = '🎚 Toys follow the sound of your ' + label
}
async function startFeed(src, title) {
  stopFeed(true)
  feedHidden = false
  feedPlayer.leader = true
  feedPlayer.selfMuted = false
  showFeedWindow(true, '📺 ' + title + ' · you are showing this', src.kind === 'video' && src.url.startsWith('blob:') ? '' : src.url)
  await feedPlayer.load(src)
  if (feedPlayer.el) feedPlayer.tryPlay(feedPlayer.el)
  updateFeedFoot()
  $('#feed-stop').disabled = false
  $('#feed-state').textContent = 'showing: ' + title
}
$('#feed-go').onclick = async () => {
  if (!session?.isController) return toast('Only controllers can set the live feed')
  const src = parseMediaLink($('#feed-link').value)
  if (!src) return toast('Paste a link to a video, stream or page')
  // ask for the tab's sound first, while the browser still counts this as a tap
  let tabAudio = null
  if ($('#feed-follow').checked) {
    if (!navigator.mediaDevices?.getDisplayMedia) toast('This browser can’t share tab sound, so the toys won’t follow the feed')
    else try { tabAudio = await captureOwnTab() } catch (e) { toast(e.name === 'NotAllowedError' ? 'Feed shown without moving the toys (tab sound not shared)' : e.message) }
  }
  try {
    await startFeed(src, mediaLabel(src))
    myFeed = {src: {kind: src.kind, url: src.url}, title: mediaLabel(src), tabAudio}
    if (tabAudio) {
      followFeedSound(tabAudio, 'live feed (this tab)')
      tabAudio.getAudioTracks()[0].addEventListener('ended', () => { if (myFeed?.tabAudio === tabAudio && music.extStream === tabAudio) { music.stop(); $('#s-now').textContent = '' } })
    }
    sendFeedState()
  } catch (e) { tabAudio?.getTracks().forEach(t => t.stop()); toast(e.message) }
}
$('#feed-link').onkeydown = e => { if (e.key === 'Enter') $('#feed-go').click() }
$('#feed-file').onchange = async e => {
  const f = e.target.files[0]
  e.target.value = ''
  if (!f || !session?.isController) return
  const url = URL.createObjectURL(f)
  try {
    await startFeed({kind: 'video', url}, f.name)
    const v = feedPlayer.el
    const cap = v.captureStream?.bind(v) || v.mozCaptureStream?.bind(v)
    if (!cap) throw new Error('This browser can’t stream a video file (try Chrome, Edge or Firefox)')
    v.play().catch(() => {})
    await new Promise(ok => v.readyState >= 2 ? ok() : v.addEventListener('loadeddata', ok, {once: true}))
    const stream = cap()
    feedShare = new GroupShare(stream, {kind: 'feed'})
    feedShare.sync()
    myFeed = {src: {kind: 'stream'}, title: f.name.slice(0, 80), blob: url}
    if ($('#feed-follow').checked && stream.getAudioTracks().length) followFeedSound(stream, 'video file')
    sendFeedState()
  } catch (err) { toast(err.message); stopFeed() }
}
function stopFeed(quiet) {
  const had = !!myFeed
  if (myFeed?.screen) {
    myFeed.screen.getTracks().forEach(t => t.stop())
    if (music.extStream === myFeed.screen) music.stop()
    $('#s-start').disabled = false; $('#s-stop').disabled = true; $('#s-now').textContent = ''
  }
  if (myFeed?.tabAudio) myFeed.tabAudio.getTracks().forEach(t => t.stop())
  if (myFeed && music.extStream && !myFeed.screen) { music.stop(); $('#s-now').textContent = '' }
  if (feedShare) { feedShare.stop(); feedShare = null }
  if (myFeed?.blob) URL.revokeObjectURL(myFeed.blob)
  myFeed = null
  if (feedPlayer.leader) { feedPlayer.destroy(); feedPlayer.leader = false; showFeedWindow(false) }
  $('#feed-stop').disabled = true
  $('#feed-state').textContent = ''
  if (had && !quiet) session?.sendMedia({slot: 'feed', src: null})
}
$('#feed-stop').onclick = () => stopFeed()
$('#fm-hide').onclick = () => { feedHidden = true; $('#feed-mini').classList.add('hidden'); $('#fm-show').classList.remove('hidden') }
$('#fm-show').onclick = () => { feedHidden = false; $('#fm-show').classList.add('hidden'); $('#feed-mini').classList.remove('hidden') }
$('#fm-size').onclick = () => $('#feed-mini').classList.toggle('big')
// my own volume and mute for the live feed / screen share (nobody else is affected)
let fmMuted = store.get('tr-feed-muted', '0') === '1'
function applyFeedVolume() {
  const v = fmMuted ? 0 : $('#fm-vol').value / 100
  feedPlayer.setVolume(v)
  $('#fm-mute').textContent = fmMuted || v === 0 ? '🔇' : '🔊'
  $('#fm-vol-num').textContent = fmMuted ? 'muted' : $('#fm-vol').value + '%'
}
$('#fm-vol').oninput = e => { fmMuted = false; store.set('tr-feed-muted', '0'); store.set('tr-feed-vol', e.target.value); applyFeedVolume() }
$('#fm-mute').onclick = () => { fmMuted = !fmMuted; store.set('tr-feed-muted', fmMuted ? '1' : '0'); applyFeedVolume() }
$('#fm-vol').value = store.get('tr-feed-vol', '100')
applyFeedVolume()
$('#fm-tap').onclick = () => { feedPlayer.resume(); $('#fm-tap').classList.add('hidden') }
// drag the mini windows by their title bars
function makeDraggable(box) {
  const head = box.querySelector('.fm-head')
  let start = null
  head.addEventListener('pointerdown', e => {
    if (e.target.closest('button, a, input, label')) return
    const r = box.getBoundingClientRect()
    start = {x: e.clientX - r.left, y: e.clientY - r.top}
    head.setPointerCapture(e.pointerId)
  })
  head.addEventListener('pointermove', e => {
    if (!start) return
    const w = box.offsetWidth, h = box.offsetHeight
    box.style.left = Math.max(0, Math.min(innerWidth - w, e.clientX - start.x)) + 'px'
    box.style.top = Math.max(0, Math.min(innerHeight - h, e.clientY - start.y)) + 'px'
    box.style.right = box.style.bottom = 'auto'
  })
  head.addEventListener('pointerup', () => { start = null })
}
makeDraggable($('#feed-mini'))
makeDraggable($('#sc-mini'))

// ---------------- Scrolller preview ----------------
// Controllers can point the people they control at a Scrolller category. Only
// scrolller.com category links are accepted. Each person can hide it, switch to a simple
// card (if Scrolller refuses to be shown inside other sites), or open it full screen in
// a new tab.
let myScroll = null
let scView = store.get('tr-sc-view', 'live') // 'live' | 'card'
let scHidden = store.get('tr-sc-auto', '1') !== '1'
$('#sc-auto').checked = !scHidden
function sendScrollState(target) {
  if (!session?.isController || !myScroll) return
  session.sendMedia({slot: 'scroll', src: {kind: 'scrolller', url: myScroll.url}, title: myScroll.title}, target)
}
function showScroll(src, who) {
  const title = scrolllerTitle(src.slug)
  $('#sc-title').textContent = `🖼 ${title}${who ? ' · ' + who : ''}`
  $('#sc-full').href = src.url
  $('#sc-mini').classList.toggle('hidden', scHidden)
  $('#sc-show').classList.toggle('hidden', !scHidden)
  $('#sc-view').textContent = scView === 'live' ? '🃏' : '🌐'
  $('#sc-view').title = scView === 'live' ? 'Show a simple card instead' : 'Show the live Scrolller page'
  const body = $('#sc-body')
  if (body.dataset.key === src.url + scView) return
  body.dataset.key = src.url + scView
  if (scView === 'card') {
    body.replaceChildren(el('div', {class: 'sc-card'}, el('div', {}, '🖼'), el('b', {}, title), el('div', {class: 'muted small'}, 'scrolller.com'),
      el('a', {class: 'btn primary', href: src.url, target: '_blank', rel: 'noopener noreferrer'}, '↗ Open full screen on Scrolller')))
  } else {
    const f = el('iframe', {src: src.url, title: 'Scrolller: ' + title, allow: 'autoplay; fullscreen', referrerpolicy: 'strict-origin-when-cross-origin',
      sandbox: 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox'})
    body.replaceChildren(f, el('div', {class: 'muted small embed-note'}, 'Blank? Tap 🃏 for a card, or ↗ Full to open it on Scrolller.'))
  }
}
function hideScroll() {
  $('#sc-mini').classList.add('hidden'); $('#sc-show').classList.add('hidden')
  $('#sc-body').replaceChildren(); delete $('#sc-body').dataset.key
}
function renderScroll() {
  if (session?.isController && myScroll) return showScroll(myScroll.src, 'you are showing this')
  const m = incoming.scroll
  if (!m) return hideScroll()
  showScroll(m.src, session?.members.get(m.from)?.name || '')
}
$('#sc-go').onclick = () => {
  if (!session?.isController) return toast('Only controllers can set the Scrolller preview')
  const src = parseScrolllerLink($('#sc-link').value)
  if (!src) return toast('Only Scrolller category links work here, like https://scrolller.com/name_1a2b3c4d')
  myScroll = {src, url: src.url, title: scrolllerTitle(src.slug)}
  scHidden = false
  $('#sc-stop').disabled = false
  renderScroll()
  sendScrollState()
}
$('#sc-link').onkeydown = e => { if (e.key === 'Enter') $('#sc-go').click() }
function stopScroll(quiet) {
  const had = !!myScroll
  myScroll = null
  $('#sc-stop').disabled = true
  if (had && !quiet) session?.sendMedia({slot: 'scroll', src: null})
  renderScroll()
}
$('#sc-stop').onclick = () => stopScroll()
$('#sc-hide').onclick = () => { scHidden = true; renderScroll() }
$('#sc-show').onclick = () => { scHidden = false; renderScroll() }
$('#sc-size').onclick = () => $('#sc-mini').classList.toggle('big')
$('#sc-view').onclick = () => { scView = scView === 'live' ? 'card' : 'live'; store.set('tr-sc-view', scView); renderScroll() }
$('#sc-auto').onchange = e => store.set('tr-sc-auto', e.target.checked ? '1' : '0')

$('#listen-btn').onclick = () => {
  voice.resumeAll()
  $('#room-audio').play().catch(() => {})
  $('#listen-btn').classList.add('hidden')
}

// ---------------- controller loop ----------------
// Works out every feature's value for the chosen mode and sends it to the room.
function computeOutputs() {
  const o = zeroOutputs()
  let main = 0, src = mode, fromPattern = null
  if (mode === 'manual') { main = mainFader.value; src = 'manual' }
  else if (mode === 'pattern') {
    const t = performance.now() - patternStart, speed = $('#p-speed').value / 100, strength = $('#p-max').value / 100
    if (pattern?.startsWith('lib:')) {
      const p = library.find(x => 'lib:' + x.id === pattern)
      fromPattern = p && patternOutputs(p, t, speed, strength)
      main = fromPattern?.m || 0
      src = p?.name || 'pattern'
    } else if (pattern) {
      main = patternLevel(pattern, t / 1000, speed) * strength
      src = PATTERNS[pattern].label
    }
  } else if (mode === 'music') { main = music.level(); src = 'music' }
  else if (mode === 'screen') { main = myFeed && music.extStream ? music.level() : 0; src = myFeed?.screen ? 'screen share' : 'live feed sound' }
  for (const k of CHANNEL_KEYS) {
    o[k] = mixer[k].linked ? (fromPattern ? fromPattern[k] : main) : mixer[k].val
  }
  if (strokerMode === 'pos') {
    // the main value is the position inside my stroke range; funscripts use their own positions
    o.pm = 1
    o.pos = fromPattern ? fromPattern.pos : main
    o.lo = range.lo; o.hi = range.hi
    // toys that only understand a speed get one from how fast the position moves
    const now = performance.now(), dt = Math.max(1, now - posTrack.at) / 1000
    const v = Math.min(1, Math.abs(o.pos - posTrack.pos) / dt / 2) // full travel in 0.5 s = 100%
    posTrack.speed = posTrack.speed * 0.7 + v * 0.3
    posTrack.pos = o.pos; posTrack.at = now
    if (mixer.stroke.linked) o.stroke = posTrack.speed < 0.02 ? 0 : posTrack.speed
  } else if (fromPattern?.hasRange) { o.lo = fromPattern.lo; o.hi = fromPattern.hi } else { o.lo = range.lo; o.hi = range.hi }
  return {o, main, src}
}

setInterval(() => {
  tickTurnBar()
  if (!session || session.left) return
  if (session.isController) {
    const {o, main, src} = computeOutputs()
    recorder.add(o, main)
    const key = CHANNEL_KEYS.map(k => Math.round(o[k] * 100)).join() + `|${Math.round(o.lo * 100)},${Math.round(o.hi * 100)}|${o.pm ? Math.round(o.pos * 100) : '-'}`
    const now = Date.now()
    // send on change, and at least once a second as a heartbeat
    if (key !== lastSent.key || now - lastSent.at > 1000) {
      session.sendOutputs(o, src)
      lastSent = {key, at: now}
    }
    if (o.pm) posMark.style.left = pct(o.lo + (o.hi - o.lo) * o.pos)
    for (const c of CHANNELS) {
      const v = $(`[data-chv="${c.k}"]`)
      if (v && mixer[c.k].linked) {
        v.textContent = pct(o[c.k])
        featFaders[c.k]?.set(o[c.k])
      }
    }
  } else if (toys.level > 0 && Date.now() - lastCtlAt > 3500) {
    // safety: if the controller vanishes, stop instead of running forever
    toys.setOutputs(zeroOutputs())
    renderLevel(zeroOutputs(), '')
  }
}, 1000 / CONFIG.controlRateHz)

// ---------------- my safety controls ----------------
$('#cap').value = Math.round(toys.cap * 100)
$('#cap-num').textContent = pct(toys.cap)
$('#cap').oninput = e => { toys.setCap(e.target.value / 100); $('#cap-num').textContent = e.target.value + '%' }
$('#panic').onclick = () => {
  toys.setPaused(!toys.paused)
  $('#panic').classList.toggle('on', toys.paused)
  $('#panic').textContent = toys.paused ? '▶ Resume my toys' : '⏸ Pause my toys'
  toast(toys.paused ? 'Your toys are paused' : 'Your toys follow the room again')
}

// ---------------- toys drawer ----------------
function openDrawer(open = true) {
  $('#drawer').classList.toggle('open', open)
  $('#drawer').setAttribute('aria-hidden', String(!open))
}
$('#toys-btn').onclick = () => openDrawer()
$('#toys-open2').onclick = () => openDrawer()
$('#drawer-close').onclick = () => openDrawer(false)
$('#drawer').onclick = e => { if (e.target.id === 'drawer') openDrawer(false) }

$('#toy-type').replaceChildren(...TOY_TYPES.map(T => el('option', {value: T.kind}, T.label)))
$('#toy-type').onchange = renderToyFields
function renderToyFields() {
  const kind = $('#toy-type').value
  $('#toy-help').textContent = TOY_HELP[kind] || ''
  const last = (() => { try { return JSON.parse(store.get('tr-last-' + kind, '{}')) } catch { return {} } })()
  $('#toy-fields').replaceChildren(...(TOY_FIELDS[kind] || []).map(f => el('label', {}, f.label,
    f.type === 'select'
      ? el('select', {name: f.k}, f.options.map(o => el('option', {value: o, selected: last[f.k] === o}, o)))
      : el('input', {name: f.k, placeholder: f.ph || '', value: last[f.k] || '', autocomplete: 'off', spellcheck: 'false'}))))
}
$('#toy-form').onsubmit = async e => {
  e.preventDefault()
  const kind = $('#toy-type').value
  const cfg = {}
  $('#toy-fields').querySelectorAll('input,select').forEach(i => { if (i.value.trim()) cfg[i.name] = i.value.trim() })
  store.set('tr-last-' + kind, JSON.stringify(cfg))
  if (kind === 'lovense-sdk') cfg.uid = profile.uid
  const toy = await toys.add(kind, cfg)
  if (toy.status === 'error') toast(toy.error)
  else toast(`${toy.name} connected`)
}

function renderToys() {
  const list = $('#toy-list')
  list.replaceChildren()
  if (!toys.toys.length) list.append(el('div', {class: 'muted small'}, 'No toys yet. Add one below. Try the simulated toy first to see how rooms work.'))
  for (const t of toys.toys) {
    const chans = t.features.filter(f => f !== 'range')
    list.append(el('div', {class: 'toy'},
      el('div', {class: 'row between'}, el('b', {}, t.name), el('span', {class: 'status ' + t.status}, t.status)),
      t.error ? el('div', {class: 'small', style: 'color:var(--danger)'}, t.error) : null,
      t.cfg.kind === 'sim' ? el('div', {class: 'sim', 'data-sim': t.id}) : null,
      t.qr ? el('img', {class: 'qr', src: t.qr, alt: 'Scan in Lovense Remote'}) : null,
      el('div', {class: 'chan-bars'}, chans.map(f => el('div', {class: 'cb'}, FEATURE_LABELS[f], el('div', {}, el('div', {'data-tb': t.id + ':' + f}))))),
      t.features.includes('range') ? el('div', {class: 'muted small', 'data-tr': t.id}) : null,
      el('div', {class: 'row gap wrap'},
        t.status === 'connected'
          ? el('button', {class: 'btn small', onclick: () => testToy(t)}, 'Test 2s')
          : el('button', {class: 'btn small', onclick: () => toys.retry(t)}, 'Reconnect'),
        el('button', {class: 'btn small ghost', onclick: () => toys.remove(t)}, 'Remove'))))
  }
  const n = toys.connected().length
  $('#toy-count').textContent = n
  $('#my-toys-line').textContent = n ? `Your toys: ${toys.summary().join(', ')}` : 'No toys connected. Tap “My toys”.'
  if (session && !session.left) {
    const sum = toys.summary(), feats = toys.features()
    if (JSON.stringify([sum, feats]) !== JSON.stringify([session.me.toys, session.me.feats])) session.update({toys: sum, feats})
  }
}
toys.onChange = renderToys

function testToy(t) {
  const o = zeroOutputs()
  for (const k of CHANNEL_KEYS) o[k] = 0.5
  t.apply(o)
  setTimeout(() => t.apply(toys.effective), 2000)
}

// animate sim toys and the per-toy feature bars
function animateToys() {
  for (const t of toys.toys) {
    for (const f of t.features) {
      const bar = document.querySelector(`[data-tb="${t.id}:${f}"]`)
      if (bar) bar.style.width = pct(t.out[f] || 0)
    }
    const r = document.querySelector(`[data-tr="${t.id}"]`)
    if (r) r.textContent = `Stroke range ${Math.round(t.out.lo * 100)}–${Math.round(t.out.hi * 100)}% of my limits` + (t.out.pm ? ` · 📍 position ${Math.round((t.out.lo + (t.out.hi - t.out.lo) * t.out.pos) * 100)}%` : '')
    const sim = document.querySelector(`[data-sim="${t.id}"]`)
    if (sim) { sim.style.transform = `scale(${1 + t.level * 0.35}) rotate(${(t.out.rotate || 0) * 25}deg)`; sim.classList.toggle('buzz', t.level > 0.02) }
  }
  requestAnimationFrame(animateToys)
}

// ---------------- start ----------------
async function start() {
  renderNameBtn()
  renderToyFields()
  renderToys()
  renderPatterns()
  renderMixer(true)
  renderRange()
  setStrokerMode(strokerMode, true)
  setMode('manual')
  animateToys()
  // reconnect toys saved on this device (not Bluetooth, which needs a tap)
  for (const cfg of toys.saved()) toys.add(cfg.kind, cfg)
  const m = location.hash.match(/join=([A-Za-z0-9]+)/)
  if (m) enterRoom(normalizeCode(m[1]))
  else showLobby()
}

addEventListener('beforeunload', () => { toys.stopAll(); session?.leave(); lobby.close() })
initGate()
