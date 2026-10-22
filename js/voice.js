// Group voice chat over the room's existing peer-to-peer WebRTC connections.
// Everyone who joins voice sends their microphone straight to everyone else (a "mesh"),
// so there is no server and no cost. Works well up to roughly 8-10 people talking.

const VOL_KEY = 'tr-voice-vol'

export class VoiceChat {
  constructor() {
    this.stream = null
    this.micOn = false
    this.peers = new Map() // peerId -> {audio, stream, analyser, data}
    this.volumes = (() => { try { return JSON.parse(localStorage.getItem(VOL_KEY) || '{}') } catch { return {} } })()
    this.muted = new Set() // uids muted for this visit
    this.ctx = null
    this.onBlocked = () => {}
  }
  get joined() { return !!this.stream }

  async join(session) {
    this.stream = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true, autoGainControl: true}, video: false})
    this.micOn = true
    this.session = session
    session.addStream(this.stream, undefined, {kind: 'voice'})
    this.ensureCtx()
    this.selfMeter = this.meter(this.stream)
  }
  // send my voice to someone who joined the room after me
  sendTo(peerId) { if (this.stream && this.session) this.session.addStream(this.stream, peerId, {kind: 'voice'}) }

  leave() {
    if (!this.stream) return
    try { this.session?.removeStream(this.stream) } catch {}
    this.stream.getTracks().forEach(t => t.stop())
    this.stream = null
    this.micOn = false
    this.selfMeter = null
  }
  setMic(on) {
    this.micOn = on && !!this.stream
    this.stream?.getAudioTracks().forEach(t => { t.enabled = this.micOn })
  }

  ensureCtx() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)()
    if (this.ctx.state === 'suspended') this.ctx.resume()
  }
  meter(stream) {
    try {
      this.ensureCtx()
      const src = this.ctx.createMediaStreamSource(stream)
      const an = this.ctx.createAnalyser()
      an.fftSize = 512
      src.connect(an)
      return {an, data: new Uint8Array(an.fftSize)}
    } catch { return null }
  }
  level(m) {
    if (!m) return 0
    m.an.getByteTimeDomainData(m.data)
    let peak = 0
    for (const v of m.data) peak = Math.max(peak, Math.abs(v - 128))
    return peak / 128
  }

  // incoming voice from a peer
  addPeer(peerId, stream, uid) {
    this.removePeer(peerId)
    const audio = new Audio()
    audio.autoplay = true
    audio.playsInline = true
    audio.srcObject = stream
    const p = {audio, stream, uid, meter: this.meter(stream)}
    this.peers.set(peerId, p)
    this.applyVolume(peerId)
    audio.play().catch(() => this.onBlocked())
  }
  removePeer(peerId) {
    const p = this.peers.get(peerId)
    if (!p) return
    p.audio.pause()
    p.audio.srcObject = null
    this.peers.delete(peerId)
  }
  resumeAll() { for (const p of this.peers.values()) p.audio.play().catch(() => {}) }
  speaking(peerId) {
    if (peerId === 'self') return this.micOn && this.level(this.selfMeter) > 0.08
    return this.level(this.peers.get(peerId)?.meter) > 0.08
  }

  volumeOf(uid) { return this.volumes[uid] ?? 1 }
  setVolume(peerId, uid, v) {
    this.volumes[uid] = v
    try { localStorage.setItem(VOL_KEY, JSON.stringify(this.volumes)) } catch {}
    this.applyVolume(peerId)
  }
  toggleMute(peerId, uid) {
    if (this.muted.has(uid)) this.muted.delete(uid); else this.muted.add(uid)
    this.applyVolume(peerId)
  }
  isMuted(uid) { return this.muted.has(uid) }
  applyVolume(peerId) {
    const p = this.peers.get(peerId)
    if (!p) return
    p.audio.muted = this.muted.has(p.uid)
    p.audio.volume = Math.max(0, Math.min(1, this.volumeOf(p.uid)))
  }
  reset() {
    this.leave()
    for (const id of [...this.peers.keys()]) this.removePeer(id)
  }
}
