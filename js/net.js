// Transport layer: one small interface over Trystero (Nostr / WebTorrent signaling,
// WebRTC data channels) or a same-browser BroadcastChannel mode for testing.
//
// openRoom(roomId, {passive, password}) -> {
//   selfId, send(action, data, targetId?), on(action, fn(data, peerId)),
//   onJoin(fn), onLeave(fn), onStream(fn), addStream(stream, targetId?),
//   removeStream(stream), peers(), leave()
// }

import {CONFIG, iceConfig} from './config.js'

const params = new URLSearchParams(location.search)
export const networkMode = params.get('net') || CONFIG.network

let trystero = null
async function lib() {
  if (!trystero) trystero = await import('./vendor/trystero.js')
  return trystero
}

// How many signaling relays/trackers are currently connected (for the status line).
export function relayCount() {
  if (networkMode === 'local') return 1
  if (!trystero) return 0
  try {
    const socks = networkMode === 'torrent' ? trystero.torrentSockets() : trystero.nostrSockets()
    return Object.values(socks || {}).filter(ws => ws && ws.readyState === 1).length
  } catch { return 0 }
}

export async function openRoom(roomId, opts = {}) {
  if (networkMode === 'local') return openLocal(roomId)
  const t = await lib()
  const join = networkMode === 'torrent' ? t.joinTorrent : t.joinNostr
  const cfg = {appId: CONFIG.appId, rtcConfig: iceConfig()}
  if (opts.password) cfg.password = opts.password
  if (opts.passive) cfg.passive = true
  const room = join(cfg, roomId)
  const actions = {}
  const handlers = {}
  const joinFns = [], leaveFns = [], streamFns = []
  const peerSet = new Set()

  function action(name) {
    if (!actions[name]) {
      const a = room.makeAction(name)
      a.onMessage = (data, ctx) => (handlers[name] || []).forEach(fn => fn(data, ctx.peerId))
      actions[name] = a
    }
    return actions[name]
  }
  room.onPeerJoin = id => { peerSet.add(id); joinFns.forEach(f => f(id)) }
  room.onPeerLeave = id => { peerSet.delete(id); leaveFns.forEach(f => f(id)) }
  room.onPeerStream = (stream, id, meta) => streamFns.forEach(f => f(stream, id, meta))

  return {
    selfId: t.selfId,
    send(name, data, target) {
      action(name).send(data, target ? {target} : undefined).catch(() => {})
    },
    on(name, fn) { action(name); (handlers[name] ||= []).push(fn) },
    onJoin: fn => joinFns.push(fn),
    onLeave: fn => leaveFns.push(fn),
    onStream: fn => streamFns.push(fn),
    addStream(stream, target, metadata) { room.addStream(stream, {...(target ? {target} : {}), ...(metadata ? {metadata} : {})}) },
    removeStream(stream, target) { try { room.removeStream(stream, target ? {target} : undefined) } catch {} },
    peers: () => [...peerSet],
    leave() { room.leave() }
  }
}

// ---------- local (BroadcastChannel) transport for testing in multiple tabs ----------
const localSelf = Math.random().toString(36).slice(2, 12)

function openLocal(roomId) {
  const ch = new BroadcastChannel(`${CONFIG.appId}:${roomId}`)
  const handlers = {}
  const joinFns = [], leaveFns = []
  const seen = new Map() // peerId -> last heartbeat
  const post = (m) => ch.postMessage({...m, from: localSelf})

  ch.onmessage = ({data: m}) => {
    if (m.from === localSelf || (m.to && (Array.isArray(m.to) ? !m.to.includes(localSelf) : m.to !== localSelf))) return
    if (m.t === 'hi' || m.t === 'beat') {
      const isNew = !seen.has(m.from)
      seen.set(m.from, Date.now())
      if (isNew) {
        if (m.t === 'hi') post({t: 'beat', to: m.from})
        joinFns.forEach(f => f(m.from))
      }
    } else if (m.t === 'bye') {
      if (seen.delete(m.from)) leaveFns.forEach(f => f(m.from))
    } else if (m.t === 'msg' && seen.has(m.from)) {
      (handlers[m.a] || []).forEach(fn => fn(m.d, m.from))
    }
  }
  post({t: 'hi'})
  const beat = setInterval(() => {
    post({t: 'beat'})
    const now = Date.now()
    for (const [id, ts] of seen) {
      if (now - ts > 6000) { seen.delete(id); leaveFns.forEach(f => f(id)) }
    }
  }, 2000)
  const bye = () => post({t: 'bye'})
  addEventListener('pagehide', bye)

  return {
    selfId: localSelf,
    send(a, d, to) { post({t: 'msg', a, d, to}) },
    on(a, fn) { (handlers[a] ||= []).push(fn) },
    onJoin: fn => joinFns.push(fn),
    onLeave: fn => leaveFns.push(fn),
    onStream() {}, // audio sharing is not available in local test mode
    addStream() {},
    removeStream() {},
    peers: () => [...seen.keys()],
    leave() {
      clearInterval(beat); bye(); removeEventListener('pagehide', bye); ch.close()
    }
  }
}
