// Toy adapter layer. Every toy, whatever the brand, exposes the same small surface:
//   connect(), apply(outputs), stop(), disconnect(), plus name/status/kind/features.
// The room sends one "outputs" object per update (see features.js): an intensity for
// each feature (vibrate, rotate, thrust, suction, pump, stroke speed) and a stroke
// range. Each toy only uses the features it actually has.

import {CONFIG} from './config.js'
import {zeroOutputs, peakOf} from './features.js'

// Calls fn with the newest value at most every `ms`, always delivering the final value.
function coalesce(ms, fn) {
  let last = 0, pending = null, timer = null
  const fire = () => { timer = null; last = Date.now(); const v = pending; pending = null; fn(v) }
  return v => {
    pending = v
    if (timer) return
    timer = setTimeout(fire, Math.max(0, ms - (Date.now() - last)))
  }
}

async function jsonFetch(url, opts = {}) {
  const res = await fetch(url, opts)
  const text = await res.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  if (!res.ok) throw new Error((body && (body.message || body.error?.message)) || `HTTP ${res.status}`)
  return body
}

const pctNum = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : d }
const scale = (v, max) => Math.round(Math.max(0, Math.min(1, v)) * max)

// Personal stroke limits (cfg.min/cfg.max, percent) combined with the room's range (0..1).
function strokeWindow(cfg, o) {
  const min = pctNum(cfg.min, 0), max = Math.max(pctNum(cfg.min, 0) + 5, pctNum(cfg.max, 100))
  const lo = min + (max - min) * o.lo, hi = min + (max - min) * o.hi
  return {min: Math.round(lo), max: Math.round(Math.max(hi, lo + 5))}
}

// Position mode: where the stroker should be, in percent of its full travel, after the
// personal limits and the room's stroke range are applied.
function strokePosition(cfg, o) {
  const min = pctNum(cfg.min, 0), max = Math.max(pctNum(cfg.min, 0) + 5, pctNum(cfg.max, 100))
  const lo = min + (max - min) * o.lo, hi = min + (max - min) * Math.max(o.hi, o.lo + 0.05)
  return Math.round((lo + (hi - lo) * Math.max(0, Math.min(1, o.pos))) * 10) / 10
}
// How long a position move should take: never faster than the speed cap allows
// (at 100% the full travel takes 250 ms), never shorter than the update interval.
function moveTime(from, to, cap = 1, min = 150) {
  return Math.round(Math.max(min, (Math.abs(to - from) / 100) * 250 / Math.max(0.1, cap)))
}

class Toy {
  static features = ['vibrate']
  constructor(cfg) {
    this.cfg = cfg
    this.id = cfg.id || Math.random().toString(36).slice(2, 9)
    this.cfg.id = this.id
    this.status = 'disconnected' // disconnected | connecting | connected | error
    this.error = ''
    this.out = zeroOutputs()
    this.name = cfg.label || this.constructor.label
    this.features = [...this.constructor.features]
    this.onChange = () => {}
  }
  get level() { return peakOf(this.out) }
  setStatus(s, err = '') { this.status = s; this.error = err; this.onChange() }
  async connect() { this.setStatus('connected') }
  apply(o) { this.out = o; this.push?.(o) }
  async stop() { this.out = zeroOutputs(); this.push?.(this.out) }
  async disconnect() { await this.stop().catch(() => {}); this.setStatus('disconnected') }
}

// ---------------- Simulated toy (no hardware needed) ----------------
const SIM_MODELS = {
  'Vibrator': ['vibrate'],
  'Rabbit (vibrate + rotate)': ['vibrate', 'rotate'],
  'Stroker': ['stroke', 'range'],
  'Thrusting toy': ['vibrate', 'thrust'],
  'Suction toy': ['vibrate', 'suction'],
  'Pump toy': ['vibrate', 'pump'],
  'Everything': ['vibrate', 'rotate', 'thrust', 'suction', 'pump', 'stroke', 'range']
}
class SimToy extends Toy {
  static label = 'Simulated toy'
  static kind = 'sim'
  async connect() {
    const m = SIM_MODELS[this.cfg.model] ? this.cfg.model : 'Vibrator'
    this.features = SIM_MODELS[m]
    this.name = `Simulated ${m.toLowerCase()}`
    this.setStatus('connected')
  }
}

// ---------------- Lovense model table ----------------
// feature -> [Lovense action, max value]. Used by the Game Mode API and the Basic SDK.
const LV = {
  vibrate: ['Vibrate', 20], rotate: ['Rotate', 20], pump: ['Pump', 3], suction: ['Suction', 20],
  thrustOsci: ['Oscillate', 20], thrustGravity: ['Thrusting', 20], thrustFinger: ['Fingering', 20],
  strokeSolace: ['Thrusting', 20]
}
const LOVENSE_MODELS = {
  nora: {features: ['vibrate', 'rotate'], map: {vibrate: LV.vibrate, rotate: LV.rotate}},
  ridge: {features: ['vibrate', 'rotate'], map: {vibrate: LV.vibrate, rotate: LV.rotate}},
  max: {features: ['vibrate', 'pump'], map: {vibrate: LV.vibrate, pump: LV.pump}},
  osci: {features: ['thrust'], map: {thrust: LV.thrustOsci}},
  gravity: {features: ['vibrate', 'thrust'], map: {vibrate: LV.vibrate, thrust: LV.thrustGravity}},
  flexer: {features: ['vibrate', 'thrust'], map: {vibrate: LV.vibrate, thrust: LV.thrustFinger}},
  tenera: {features: ['suction'], map: {suction: LV.suction}},
  solace: {features: ['stroke', 'range'], map: {stroke: LV.strokeSolace}, depth: true},
  'solace pro': {features: ['stroke', 'range'], map: {stroke: LV.strokeSolace}, depth: true},
  'sex machine': {features: ['stroke'], map: {stroke: LV.strokeSolace}},
  mini_sex_machine: {features: ['stroke'], map: {stroke: LV.strokeSolace}}
}
const lovenseModel = name => LOVENSE_MODELS[String(name || '').toLowerCase()] || {features: ['vibrate'], map: {vibrate: LV.vibrate}}

function lovenseAction(model, o) {
  const parts = Object.entries(model.map).map(([f, [act, max]]) => `${act}:${scale(o[f], max)}`)
  if (model.depth) parts.push(`Depth:${Math.max(1, Math.ceil(o.hi * 3))}`)
  return parts.join(',')
}

// ---------------- Lovense: local Game Mode API of Lovense Remote / Connect ----------------
class LovenseLocal extends Toy {
  static label = 'Lovense (Remote app, Game Mode)'
  static kind = 'lovense-local'
  get base() {
    const ip = (this.cfg.ip || '').trim()
    const port = this.cfg.port || CONFIG.lovense.localDefaultPort
    // lovense.club hostnames resolve to the LAN IP and carry a valid TLS certificate
    return `https://${ip.replace(/\./g, '-')}.lovense.club:${port}`
  }
  cmd(body) {
    return jsonFetch(this.base + '/command', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-platform': 'ToyRooms'},
      body: JSON.stringify({apiVer: 1, ...body})
    })
  }
  async connect() {
    if (!/^\d+\.\d+\.\d+\.\d+$/.test((this.cfg.ip || '').trim())) throw new Error('Enter the Local IP shown in Game Mode')
    this.setStatus('connecting')
    const r = await this.cmd({command: 'GetToys'})
    let toys = r?.data?.toys
    if (typeof toys === 'string') { try { toys = JSON.parse(toys) } catch {} }
    this.toys = toys ? Object.values(toys).map(t => ({id: t.id, name: t.name, nick: t.nickName, model: lovenseModel(t.name)})) : []
    this.features = [...new Set(this.toys.flatMap(t => t.model.features))]
    if (!this.features.length) this.features = ['vibrate']
    const names = this.toys.map(t => t.nick || t.name).filter(Boolean)
    this.name = names.length ? `Lovense: ${names.join(', ')}` : 'Lovense (no toys found yet)'
    this.push = coalesce(250, o => this.send(o).catch(e => this.setStatus('error', e.message)))
    this.setStatus('connected')
  }
  async send(o) {
    if (!this.toys.length) return this.cmd({command: 'Function', action: `Vibrate:${scale(peakOf(o), 20)}`, timeSec: 0})
    // one command per toy, each with the actions that toy understands
    await Promise.all(this.toys.map(t => this.cmd({command: 'Function', action: lovenseAction(t.model, o), timeSec: 0, toy: t.id})))
  }
  async stop() {
    this.out = zeroOutputs()
    if (this.status === 'connected') await this.cmd({command: 'Function', action: 'Stop', timeSec: 0})
  }
}

// ---------------- Lovense: direct Bluetooth (Chrome / Edge / Android) ----------------
// Lovense toys use one of these GATT services. Newer toys use "XY300001-002Z-4bd4-..."
// where XY and Z vary by model and firmware, so every combination is listed: Chrome only
// lets the page open services it named up front.
const LOVENSE_SERVICES = (() => {
  const s = ['0000fff0-0000-1000-8000-00805f9b34fb', '6e400001-b5a3-f393-e0a9-e50e24dcca9e']
  for (let c = 0; c <= 0xff; c++) {
    for (const mid of ['0023', '0024', '0025']) s.push(`${c.toString(16).padStart(2, '0')}300001-${mid}-4bd4-bbd5-a6920e4c5653`)
  }
  return s
})()

// Turns Web Bluetooth's terse errors into something people can act on.
function bleError(e) {
  const m = e?.message || String(e)
  switch (e?.name) {
    case 'NotFoundError':
      return /cancel/i.test(m) ? 'No toy was picked. Tap Connect again and choose your toy (it shows as LVS-…).'
        : 'No Lovense toy found. Turn the toy on, and close Lovense Remote / Lovense Connect on every phone and computer: a toy can only connect to one app at a time.'
    case 'SecurityError': return 'Bluetooth is blocked here. The site must be opened over https:// (or localhost), and not inside another site.'
    case 'NotSupportedError': return 'This toy uses a Bluetooth service the browser could not open. Try Lovense Remote’s Game Mode or Intiface Central instead.'
    case 'NetworkError': return 'The toy stopped answering. Move it closer, make sure no Lovense app is connected to it, then try again.'
    case 'NotAllowedError': return 'Bluetooth permission was denied. Allow Bluetooth for this site in the browser’s site settings.'
    case 'InvalidStateError': return 'Bluetooth is busy. Wait a moment and try again.'
  }
  return m
}

// First letter(s) of the "DeviceType;" reply
const BLE_TYPES = {A: {model: 'Nora', features: ['vibrate', 'rotate']}, C: {model: 'Nora', features: ['vibrate', 'rotate']}, B: {model: 'Max', features: ['vibrate', 'pump']}}

class LovenseBLE extends Toy {
  static label = 'Lovense (Bluetooth, Chrome)'
  static kind = 'lovense-ble'
  async connect() {
    try { await this.connectBle() } catch (e) {
      try { this.device?.gatt?.disconnect() } catch {}
      throw new Error(bleError(e))
    }
  }
  async connectBle() {
    if (!window.isSecureContext) throw new Error('Bluetooth only works when the site is opened over https:// or on localhost (not http:// with an IP address).')
    if (!navigator.bluetooth) throw new Error('This browser has no Web Bluetooth. Use Chrome or Edge on Windows, macOS, Android or ChromeOS (on Linux turn on chrome://flags/#enable-experimental-web-platform-features). Safari and every iPhone/iPad browser can’t do this: use Lovense Remote’s Game Mode instead.')
    if (navigator.bluetooth.getAvailability && !(await navigator.bluetooth.getAvailability().catch(() => true))) throw new Error('Bluetooth is off or this device has no Bluetooth adapter.')
    this.setStatus('connecting')
    // the picker must open straight from the tap, so nothing slow happens before this
    const device = this.device || await navigator.bluetooth.requestDevice({
      filters: [{namePrefix: 'LVS-'}, {namePrefix: 'LOVE-'}, {namePrefix: 'LV-'}],
      optionalServices: LOVENSE_SERVICES
    })
    this.device = device
    device.addEventListener('gattserverdisconnected', () => { if (this.status === 'connected') this.setStatus('disconnected') })
    // the first GATT connection often fails right after pairing: try a few times
    let server = null
    for (let i = 0; i < 3 && !server; i++) {
      try { server = await device.gatt.connect() } catch (e) { if (i === 2) throw e; await new Promise(r => setTimeout(r, 600 * (i + 1))) }
    }
    let tx = null, rx = null
    let services = []
    try { services = await server.getPrimaryServices() } catch (e) {
      if (e.name === 'NotFoundError' || e.name === 'SecurityError') throw Object.assign(new Error('This toy’s Bluetooth service is not one we know yet.'), {name: 'NotSupportedError'})
      throw e
    }
    for (const svc of services) {
      for (const ch of await svc.getCharacteristics().catch(() => [])) {
        const u = ch.uuid
        if (/^.{4}0002-|^0000fff2-|^6e400002-/.test(u) && (ch.properties.write || ch.properties.writeWithoutResponse)) tx = ch
        if (/^.{4}0003-|^0000fff1-|^6e400003-/.test(u) && ch.properties.notify) rx = ch
      }
      if (tx) break
    }
    if (!tx) throw new Error('Could not find the toy control channel')
    this.tx = tx
    let type = null
    if (rx) {
      // ask the toy what it is, so Nora gets rotation and Max gets its pump
      type = await new Promise(async ok => {
        const t = setTimeout(() => ok(null), 1500)
        rx.addEventListener('characteristicvaluechanged', e => {
          const s = new TextDecoder().decode(e.target.value)
          if (/^[A-Z]+:/.test(s)) { clearTimeout(t); ok(s.split(':')[0]) }
        })
        try { await rx.startNotifications(); await this.write('DeviceType;') } catch { ok(null) }
      })
    }
    const info = BLE_TYPES[type] || {model: device.name?.replace(/^LVS-/, '') || 'toy', features: ['vibrate']}
    this.features = info.features
    this.name = `Lovense ${info.model} (BT)`
    this.push = coalesce(120, o => this.send(o))
    this.setStatus('connected')
  }
  async send(o) {
    await this.write(`Vibrate:${scale(o.vibrate, 20)};`)
    if (this.features.includes('rotate')) await this.write(`Rotate:${scale(o.rotate, 20)};`)
    if (this.features.includes('pump')) await this.write(`Air:Level:${scale(o.pump, 3)};`)
  }
  write(s) {
    const data = new TextEncoder().encode(s)
    const p = this.tx.properties.writeWithoutResponse ? this.tx.writeValueWithoutResponse(data) : this.tx.writeValue(data)
    return p.catch(e => this.setStatus('error', e.message))
  }
  async stop() { this.out = zeroOutputs(); if (this.tx) await this.send(this.out) }
  async disconnect() { await this.stop().catch(() => {}); this.device?.gatt?.disconnect(); this.setStatus('disconnected') }
}

// ---------------- Lovense: Basic SDK / QR connect ID (developer token) ----------------
// Pairing: we get an auth token for a per-browser uid, the SDK shows a QR code, the user
// scans it in Lovense Remote, and commands then go through Lovense's cloud.
class LovenseSDK extends Toy {
  static label = 'Lovense connect ID / QR code'
  static kind = 'lovense-sdk'
  static features = ['vibrate', 'rotate', 'pump', 'thrust', 'suction']
  async authToken(uid) {
    const {authTokenEndpoint, developerToken} = CONFIG.lovense
    if (authTokenEndpoint) {
      const r = await jsonFetch(`${authTokenEndpoint}?uid=${encodeURIComponent(uid)}`)
      return r.authToken || r.data?.authToken
    }
    // Direct call with the developer token. Anyone can read it from a public site; see README.
    const r = await jsonFetch(CONFIG.lovense.getTokenUrl, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({token: developerToken, uid, uname: uid.slice(0, 8)})
    })
    if (r?.code && r.code !== 0) throw new Error(r.message || 'Lovense rejected the developer token')
    return r?.data?.authToken
  }
  async connect() {
    const {platform, authTokenEndpoint, developerToken, basicSdkScript} = CONFIG.lovense
    if (!platform || !(authTokenEndpoint || developerToken)) {
      throw new Error('Not set up yet: add your Lovense platform name and developer token (or token endpoint) in js/config.js')
    }
    this.setStatus('connecting')
    const uid = this.cfg.uid || 'tr-' + Math.random().toString(36).slice(2)
    const authToken = await this.authToken(uid)
    if (!authToken) throw new Error('No auth token returned by Lovense')
    if (!window.LovenseBasicSdk) {
      await new Promise((ok, bad) => { const s = document.createElement('script'); s.src = basicSdkScript; s.onload = ok; s.onerror = () => bad(new Error('Could not load Lovense SDK')); document.head.append(s) })
    }
    this.sdk = new window.LovenseBasicSdk({platform, authToken, uid})
    await new Promise((ok, bad) => { this.sdk.on('ready', ok); this.sdk.on('sdkError', e => bad(new Error(e?.message || 'Lovense SDK error'))) })
    const qr = await this.sdk.getQrcode()
    this.qr = qr?.qrcodeUrl || qr?.qrcode || qr // shown in the toy list so it can be scanned in Lovense Remote
    this.name = 'Lovense: scan the QR code in Lovense Remote'
    this.onChange()
    await new Promise(ok => this.sdk.on('appStatusChange', s => s && ok()))
    this.qr = null
    this.push = coalesce(250, o => this.sdk.sendToyCommand({
      vibrate: scale(o.vibrate, 20), rotate: scale(o.rotate, 20), pump: scale(o.pump, 3),
      thrusting: scale(o.thrust, 20), suction: scale(o.suction, 20), time: 0
    }))
    this.name = 'Lovense (connect ID)'
    this.setStatus('connected')
  }
  async stop() { this.out = zeroOutputs(); this.sdk?.stopToyAction?.() }
}

// ---------------- The Handy: API v2 with connection key (HAMP speed mode) ----------------
// Stroke speed -> HAMP velocity, room stroke range (within personal limits) -> slide.
class HandyV2 extends Toy {
  static label = 'The Handy (connection key)'
  static kind = 'handy'
  static features = ['stroke', 'range']
  req(method, path, body) {
    return jsonFetch(CONFIG.handy.v2Base + path, {
      method,
      headers: {'X-Connection-Key': this.cfg.key.trim(), 'Content-Type': 'application/json', Accept: 'application/json'},
      body: body ? JSON.stringify(body) : undefined
    })
  }
  async connect() {
    if (!this.cfg.key?.trim()) throw new Error('Enter your Handy connection key')
    this.setStatus('connecting')
    const c = await this.req('GET', '/connected')
    if (!c?.connected) throw new Error('Handy is not online. Check Wi-Fi and the key.')
    await this.req('PUT', '/mode', {mode: 0}) // HAMP
    this.running = false
    this.slide = null
    this.push = coalesce(300, o => this.drive(o).catch(e => this.setStatus('error', e.message)))
    this.name = 'The Handy'
    this.setStatus('connected')
    this.push(this.out)
  }
  async drive(o) {
    if (o.pm) return this.drivePosition(o)
    if (this.hdsp) { this.hdsp = false; this.slide = null; await this.req('PUT', '/mode', {mode: 0}) }
    const w = strokeWindow(this.cfg, o)
    const key = w.min + '-' + w.max
    if (key !== this.slide) { this.slide = key; await this.req('PUT', '/slide', w) }
    if (o.stroke < 0.03) {
      if (this.running) { this.running = false; await this.req('PUT', '/hamp/stop') }
      return
    }
    await this.req('PUT', '/hamp/velocity', {velocity: Math.round(o.stroke * 100)})
    if (!this.running) { this.running = true; await this.req('PUT', '/hamp/start') }
  }
  // Position mode: HDSP "move to x% in t ms". The slide is opened fully because the
  // personal limits and the room range are already applied to the position.
  async drivePosition(o) {
    if (!this.hdsp) {
      this.hdsp = true; this.running = false
      await this.req('PUT', '/mode', {mode: 2}) // HDSP
      this.slide = '0-100'; await this.req('PUT', '/slide', {min: 0, max: 100})
    }
    const x = strokePosition(this.cfg, o)
    if (x === this.lastX) return
    const duration = moveTime(this.lastX ?? x, x, o.cap, 300)
    this.lastX = x
    await this.req('PUT', '/hdsp/xpt', {position: x, duration, stopOnTarget: true})
  }
  async stop() {
    this.out = zeroOutputs()
    if (this.status !== 'connected') return
    this.running = false
    if (this.hdsp) { this.hdsp = false; this.slide = null; this.lastX = null; await this.req('PUT', '/mode', {mode: 0}) }
    await this.req('PUT', '/hamp/stop')
  }
}

// ---------------- The Handy: API v3 HSP streaming ----------------
// Streams generated stroke points slightly ahead of time for smoother motion than HAMP.
class HandyHSP extends Toy {
  static label = 'The Handy HSP stream'
  static kind = 'handy-hsp'
  static features = ['stroke', 'range']
  req(method, key, body) {
    return jsonFetch(CONFIG.handy.v3Base + CONFIG.handy.v3Paths[key], {
      method,
      headers: {
        'X-Connection-Key': this.cfg.key.trim(),
        ...(this.appId ? {'X-Api-Key': this.appId} : {}),
        'Content-Type': 'application/json', Accept: 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined
    })
  }
  async connect() {
    if (!this.cfg.key?.trim()) throw new Error('Enter your Handy connection key')
    this.appId = this.cfg.appId?.trim() || CONFIG.handy.v3ApplicationId
    this.setStatus('connecting')
    const t0 = Date.now()
    const st = await this.req('GET', 'serverTime')
    this.offset = (st.server_time ?? st.serverTime) + (Date.now() - t0) / 2 - Date.now()
    this.streamId = Math.floor(Math.random() * 1e9)
    await this.req('PUT', 'hspSetup', {stream_id: this.streamId})
    this.t = 0; this.x = 0; this.up = true; this.idx = 0
    this.start = Date.now()
    await this.req('PUT', 'hspPlay', {start_time: 0, server_time: Math.round(Date.now() + this.offset), playback_rate: 1, loop: false})
    this.timer = setInterval(() => this.feed().catch(e => this.setStatus('error', e.message)), 400)
    // position mode reacts to every update instead of only every 400 ms
    this.push = coalesce(150, o => { if (o.pm) this.feed().catch(e => this.setStatus('error', e.message)) })
    this.name = 'The Handy (HSP)'
    this.setStatus('connected')
  }
  async feed() {
    const now = Date.now() - this.start
    if (this.t < now) this.t = now + 150
    const pts = []
    if (this.out.pm) {
      // position mode: one point slightly ahead of now at the wanted position
      const x = strokePosition(this.cfg, this.out)
      if (x === this.x && this.t > now) return
      this.t = Math.max(this.t + 50, now + moveTime(this.x, x, this.out.cap, 250))
      this.x = x
      pts.push({t: this.t, x})
    }
    while (!this.out.pm && this.t < now + 1200) {
      const o = this.out
      const w = strokeWindow(this.cfg, o)
      if (o.stroke < 0.03) { this.t += 400; pts.push({t: this.t, x: this.x}); continue }
      this.up = !this.up
      this.x = this.up ? w.max : w.min
      this.t += Math.round(1200 - o.stroke * 1050) // ms per half stroke
      pts.push({t: this.t, x: this.x})
    }
    if (pts.length) await this.req('PUT', 'hspAdd', {points: pts, flush: false, tail_point_stream_index: (this.idx += pts.length)})
  }
  async stop() { this.out = zeroOutputs() }
  async disconnect() { clearInterval(this.timer); await this.req('PUT', 'hspStop').catch(() => {}); this.setStatus('disconnected') }
}

// ---------------- Intiface Central / Buttplug.io (hundreds of brands) ----------------
const ACTUATOR_FEATURE = {Vibrate: 'vibrate', Rotate: 'rotate', Oscillate: 'thrust', Constrict: 'pump', Inflate: 'pump'}

class Intiface extends Toy {
  static label = 'Intiface Central (any brand)'
  static kind = 'intiface'
  async connect() {
    this.setStatus('connecting')
    const url = this.cfg.url?.trim() || CONFIG.intiface.defaultUrl
    this.msgId = 1
    this.waiters = new Map()
    this.devices = new Map()
    await new Promise((ok, bad) => {
      this.ws = new WebSocket(url)
      this.ws.onopen = ok
      this.ws.onerror = () => bad(new Error('Could not reach Intiface. Is the server started?'))
    })
    this.ws.onclose = () => { clearInterval(this.pinger); this.setStatus('disconnected') }
    this.ws.onmessage = e => JSON.parse(e.data).forEach(m => this.handle(m))
    const info = await this.send('RequestServerInfo', {ClientName: 'Toy Rooms', MessageVersion: 3})
    const ping = info.ServerInfo?.MaxPingTime
    if (ping) this.pinger = setInterval(() => this.send('Ping', {}).catch(() => {}), ping / 2)
    const list = await this.send('RequestDeviceList', {})
    list.DeviceList?.Devices?.forEach(d => this.addDevice(d))
    this.send('StartScanning', {}).catch(() => {})
    this.push = coalesce(100, o => this.drive(o))
    this.updateName()
    this.setStatus('connected')
  }
  send(type, body) {
    const Id = this.msgId++
    this.ws.send(JSON.stringify([{[type]: {Id, ...body}}]))
    return new Promise((ok, bad) => {
      this.waiters.set(Id, m => (m.Error ? bad(new Error(m.Error.ErrorMessage)) : ok(m)))
      setTimeout(() => { if (this.waiters.delete(Id)) bad(new Error('Intiface timeout')) }, 8000)
    })
  }
  handle(m) {
    const [type] = Object.keys(m), body = m[type]
    if (type === 'DeviceAdded') this.addDevice(body)
    else if (type === 'DeviceRemoved') { this.devices.delete(body.DeviceIndex); this.updateName() }
    const w = this.waiters.get(body.Id)
    if (body.Id && w) { this.waiters.delete(body.Id); w(m) }
  }
  addDevice(d) {
    const msgs = d.DeviceMessages || {}
    this.devices.set(d.DeviceIndex, {
      name: d.DeviceDisplayName || d.DeviceName,
      scalars: (msgs.ScalarCmd || []).map(s => ({type: s.ActuatorType, feature: ACTUATOR_FEATURE[s.ActuatorType]})),
      rotators: msgs.RotateCmd || [],
      linear: msgs.LinearCmd || [],
      pos: 0
    })
    this.updateName()
  }
  updateName() {
    const devs = [...this.devices.values()]
    const f = new Set()
    for (const d of devs) {
      d.scalars.forEach(s => s.feature && f.add(s.feature))
      if (d.rotators.length) f.add('rotate')
      if (d.linear.length) { f.add('stroke'); f.add('range') }
    }
    this.features = f.size ? [...f] : ['vibrate']
    this.name = devs.length ? `Intiface: ${devs.map(d => d.name).join(', ')}` : 'Intiface (scanning for toys...)'
    this.onChange()
  }
  drive(o) {
    for (const [idx, d] of this.devices) {
      const scal = d.scalars.filter(s => s.feature)
      if (scal.length) {
        this.send('ScalarCmd', {DeviceIndex: idx, Scalars: d.scalars.map((s, i) => ({Index: i, Scalar: s.feature ? o[s.feature] : 0, ActuatorType: s.type})).filter(s => d.scalars[s.Index].feature)}).catch(() => {})
      }
      if (d.rotators.length) {
        this.send('RotateCmd', {DeviceIndex: idx, Rotations: d.rotators.map((_, i) => ({Index: i, Speed: o.rotate, Clockwise: true}))}).catch(() => {})
      }
    }
    if (o.pm) this.positionStroker(o)
    else this.ensureStroker()
  }
  // Position mode: send linear devices straight to the wanted position.
  positionStroker(o) {
    clearTimeout(this.strokeTimer); this.strokeTimer = null
    const x = strokePosition(this.cfg, o)
    for (const [idx, d] of this.devices) {
      if (!d.linear.length || d.pos === x / 100) continue
      const dur = moveTime(d.pos * 100, x, o.cap, 120)
      d.pos = x / 100
      this.send('LinearCmd', {DeviceIndex: idx, Vectors: d.linear.map((_, i) => ({Index: i, Duration: dur, Position: d.pos}))}).catch(() => {})
    }
  }
  // Linear devices (strokers) move back and forth inside the stroke range at the stroke speed.
  ensureStroker() {
    if (this.strokeTimer || ![...this.devices.values()].some(d => d.linear.length)) return
    const step = () => {
      const o = this.out
      if (o.pm) { this.strokeTimer = null; return }
      const w = strokeWindow(this.cfg, o)
      const dur = o.stroke < 0.03 ? 500 : Math.round(1200 - o.stroke * 1000)
      for (const [idx, d] of this.devices) {
        if (!d.linear.length || o.stroke < 0.03) continue
        d.pos = d.pos === w.max / 100 ? w.min / 100 : w.max / 100
        this.send('LinearCmd', {DeviceIndex: idx, Vectors: d.linear.map((_, i) => ({Index: i, Duration: dur, Position: d.pos}))}).catch(() => {})
      }
      this.strokeTimer = setTimeout(step, dur)
    }
    step()
  }
  async stop() {
    this.out = zeroOutputs()
    if (this.ws?.readyState === 1) await this.send('StopAllDevices', {}).catch(() => {})
  }
  async disconnect() {
    clearTimeout(this.strokeTimer); this.strokeTimer = null
    await this.stop()
    clearInterval(this.pinger)
    this.ws?.close()
    this.setStatus('disconnected')
  }
}

// ---------------- XToys private webhook ----------------
// Sends the room's outputs to your own XToys session. A custom XToys script reads them
// and drives whatever toys you have connected in XToys (see README).
class XToysWebhook extends Toy {
  static label = 'XToys (private webhook)'
  static kind = 'xtoys'
  static features = ['vibrate', 'rotate', 'thrust', 'suction', 'pump', 'stroke', 'range']
  async connect() {
    const id = (this.cfg.webhook || '').trim().replace(/^.*\//, '')
    if (!/^[0-9A-Za-z_-]{4,}$/.test(id)) throw new Error('Enter your XToys private webhook ID (XToys > User Info > Private Webhook)')
    this.setStatus('connecting')
    await new Promise((ok, bad) => {
      this.ws = new WebSocket(CONFIG.xtoys.webhookBase + id)
      this.ws.onopen = ok
      this.ws.onerror = () => bad(new Error('Could not reach the XToys webhook'))
    })
    this.ws.onclose = () => this.status === 'connected' && this.setStatus('disconnected')
    this.push = coalesce(200, o => {
      if (this.ws?.readyState !== 1) return
      const msg = {action: CONFIG.xtoys.action}
      for (const k of ['vibrate', 'rotate', 'thrust', 'suction', 'pump', 'stroke', 'lo', 'hi']) msg[k] = Math.round((o[k] || 0) * 100)
      msg.mode = o.pm ? 'position' : 'speed'
      msg.position = Math.round(strokePosition(this.cfg, o))
      this.ws.send(JSON.stringify(msg))
    })
    this.name = 'XToys webhook'
    this.setStatus('connected')
    this.push(this.out)
  }
  async disconnect() { await this.stop().catch(() => {}); this.ws?.close(); this.setStatus('disconnected') }
}

export const TOY_TYPES = [SimToy, LovenseLocal, LovenseBLE, HandyV2, Intiface, XToysWebhook, HandyHSP, LovenseSDK]

// Fields shown in the "add toy" form for each type.
const strokeFields = [
  {k: 'min', label: 'My stroke bottom limit %', ph: '0'},
  {k: 'max', label: 'My stroke top limit %', ph: '100'}
]
export const TOY_FIELDS = {
  'sim': [{k: 'model', label: 'Pretend to be', type: 'select', options: Object.keys(SIM_MODELS)}],
  'lovense-local': [
    {k: 'ip', label: 'Local IP (from Lovense Remote > Game Mode)', ph: '192.168.1.23'},
    {k: 'port', label: 'HTTPS port', ph: '30010'}
  ],
  'lovense-ble': [],
  'handy': [{k: 'key', label: 'Connection key (Handy app / handyfeeling.com)', ph: 'e.g. aBc123'}, ...strokeFields],
  'handy-hsp': [
    {k: 'key', label: 'Connection key', ph: 'e.g. aBc123'},
    {k: 'appId', label: 'Application ID (optional)', ph: 'only if your account needs one'},
    ...strokeFields
  ],
  'intiface': [{k: 'url', label: 'Intiface server address', ph: CONFIG.intiface.defaultUrl}, ...strokeFields],
  'lovense-sdk': [],
  'xtoys': [{k: 'webhook', label: 'XToys private webhook ID', ph: 'from XToys > User Info'}]
}

export const TOY_HELP = {
  'sim': 'An on-screen toy. Great for trying rooms without hardware. Pick which kind of toy it pretends to be.',
  'lovense-local': 'Open Lovense Remote (or Lovense Connect), connect your toys, then open Discover > Game Mode and turn on "Enable LAN". Use the Local IP and HTTPS port it shows. Your phone and this device must be on the same Wi-Fi. Each toy gets the features it has (Nora rotates, Max pumps, Gravity thrusts, and so on).',
  'lovense-ble': 'Connects straight to the toy over Bluetooth. Needs Chrome or Edge on Windows, macOS, Android or ChromeOS (not Safari, not iPhone/iPad), and the site opened over https:// or localhost. Turn the toy on and close Lovense Remote / Connect everywhere first: a toy only talks to one app at a time. Tap Connect, then pick the toy (LVS-…).',
  'handy': 'Turn on your Handy, put it in Wi-Fi mode, and copy the connection key from the Handy app or handyfeeling.com. The room controls stroke speed and stroke range, always inside your own limits below.',
  'handy-hsp': 'Smoother motion using the Handy Streaming Protocol (HSP). Uses the same connection key. If it fails on your firmware, use the plain connection-key option instead.',
  'intiface': 'Install Intiface Central (free) on your computer or Android, press Start Server, and connect any of the hundreds of toys it supports. Vibration, rotation, oscillation, constriction and strokers are all mapped.',
  'xtoys': 'Sends the room to your own XToys session, so any toy XToys supports can follow along. Needs a small custom script in XToys that reacts to the "toyrooms" webhook action (see README).',
  'lovense-sdk': 'Pair by scanning a QR code in Lovense Remote; control then works from anywhere, not just your Wi-Fi. The site owner sets this up once in js/config.js.'
}

export class ToyManager {
  constructor() {
    this.toys = []
    this.cap = +(localStorage.getItem('tr-cap') || 1)
    this.paused = false
    this.room = zeroOutputs()
    this.onChange = () => {}
  }
  // The room's outputs after this person's own max and pause are applied.
  get effective() {
    const o = {...this.room}
    for (const k of ['vibrate', 'rotate', 'thrust', 'suction', 'pump', 'stroke']) o[k] = this.paused ? 0 : Math.min(o[k], this.cap)
    o.cap = this.cap
    if (this.paused) o.pm = 0
    return o
  }
  get level() { return peakOf(this.room) }
  create(kind, cfg) {
    const T = TOY_TYPES.find(t => t.kind === kind) || SimToy
    const toy = new T({...cfg, kind: T.kind})
    toy.onChange = () => this.onChange()
    return toy
  }
  async add(kind, cfg) {
    const toy = this.create(kind, cfg)
    this.toys.push(toy)
    this.onChange()
    await this.retry(toy)
    this.save()
    return toy
  }
  async retry(toy) {
    try { await toy.connect(); toy.apply(this.effective) } catch (e) { toy.setStatus('error', e.message || String(e)) }
    this.onChange()
  }
  async remove(toy) {
    await toy.disconnect().catch(() => {})
    this.toys = this.toys.filter(t => t !== toy)
    this.save()
    this.onChange()
  }
  setOutputs(o) { this.room = o; this.apply() }
  apply() {
    const e = this.effective
    for (const t of this.toys) if (t.status === 'connected') t.apply(e)
  }
  setCap(c) { this.cap = c; try { localStorage.setItem('tr-cap', c) } catch {} this.apply() }
  setPaused(p) {
    this.paused = p
    if (p) this.toys.forEach(t => t.status === 'connected' && t.stop().catch(() => {}))
    else this.apply()
  }
  stopAll() { this.room = zeroOutputs(); this.toys.forEach(t => t.status === 'connected' && t.stop().catch(() => {})) }
  connected() { return this.toys.filter(t => t.status === 'connected') }
  summary() { return this.connected().map(t => t.name).slice(0, 4) }
  features() { return [...new Set(this.connected().flatMap(t => t.features))] }
  save() {
    // Remember toy setups on this device only (never sent to the room).
    const list = this.toys.filter(t => t.cfg.kind !== 'lovense-ble').map(t => t.cfg)
    try { localStorage.setItem('tr-toys', JSON.stringify(list)) } catch {}
  }
  saved() { try { return JSON.parse(localStorage.getItem('tr-toys') || '[]') } catch { return [] } }
}
