// Music-driven control: analyses a local audio file (or the microphone) and turns
// loudness/bass energy into a 0..1 level. Can also expose the audio as a MediaStream
// so it can be shared with everyone in the room.

export class MusicDriver {
  constructor() {
    this.ctx = null
    this.analyser = null
    this.source = null
    this.audio = null
    this.micStream = null
    this.shareDest = null
    this.smooth = 0
    this.peak = 0.05
    this.sensitivity = 1
    this.focus = 'bass' // 'bass' | 'full'
    this.volume = 1
    this.bpm = 120
    this.beatOn = false
  }

  ensureCtx() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)()
      this.analyser = this.ctx.createAnalyser()
      this.analyser.fftSize = 1024
      this.analyser.smoothingTimeConstant = 0.6
      this.bins = new Uint8Array(this.analyser.frequencyBinCount)
      this.shareDest = this.ctx.createMediaStreamDestination()
      // what I hear myself; the people I share with set their own volume
      this.monitor = this.ctx.createGain()
      this.monitor.gain.value = this.volume ?? 1
      this.monitor.connect(this.ctx.destination)
    }
    if (this.ctx.state === 'suspended') this.ctx.resume()
  }

  disconnectSource() {
    try { this.source?.disconnect() } catch {}
    this.source = null
    this.extStream = null
    if (this.micStream) { this.micStream.getTracks().forEach(t => t.stop()); this.micStream = null }
  }

  async playFile(file) {
    this.ensureCtx()
    this.disconnectSource()
    if (!this.audio) {
      this.audio = new Audio()
      this.audio.loop = true
      this.audio.crossOrigin = 'anonymous'
    }
    if (this.audio.src) URL.revokeObjectURL(this.audio.src)
    this.audio.src = URL.createObjectURL(file)
    if (!this.mediaNode) this.mediaNode = this.ctx.createMediaElementSource(this.audio)
    this.source = this.mediaNode
    this.source.connect(this.analyser)
    this.source.connect(this.monitor)
    this.source.connect(this.shareDest)
    await this.audio.play()
  }

  async useMic() {
    this.ensureCtx()
    this.disconnectSource()
    this.audio?.pause()
    this.micStream = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: false, noiseSuppression: false}})
    this.source = this.ctx.createMediaStreamSource(this.micStream)
    this.source.connect(this.analyser)
  }

  // Follow someone else's stream (the screen share's sound) without playing it here.
  // The stream belongs to the caller, so stop() leaves it running.
  useStream(stream) {
    this.ensureCtx()
    this.disconnectSource()
    this.audio?.pause()
    this.source = this.ctx.createMediaStreamSource(stream)
    this.source.connect(this.analyser)
    this.extStream = stream
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v))
    if (this.monitor) this.monitor.gain.value = this.volume
  }
  get isFile() { return !!this.audio && this.source === this.mediaNode }
  get time() { return this.isFile ? this.audio.currentTime : 0 }
  get duration() { return this.isFile && Number.isFinite(this.audio.duration) ? this.audio.duration : 0 }
  seekTo(t) { if (this.isFile) this.audio.currentTime = Math.max(0, Math.min(this.duration || 0, t)) }
  seekBy(d) { this.seekTo(this.time + d) }

  togglePause() {
    if (!this.audio || this.source !== this.mediaNode) return false
    if (this.audio.paused) this.audio.play(); else this.audio.pause()
    return !this.audio.paused
  }

  stop() {
    this.audio?.pause()
    this.disconnectSource()
    this.smooth = 0
  }

  get active() {
    return !!this.source && !(this.source === this.mediaNode && this.audio?.paused)
  }

  // Stream of the music for sharing with the room (file playback only).
  get shareStream() { this.ensureCtx(); return this.shareDest.stream }

  // Beat without audio: pulses at a tempo (for embedded players whose sound can't be read).
  beatLevel() {
    const ph = ((performance.now() - (this.beatZero || 0)) / (60000 / this.bpm)) % 1
    return Math.min(1, Math.pow(1 - ph, 2.2) * this.sensitivity)
  }
  // tap along to the music: the tempo is the average of the last taps
  tap() {
    const now = performance.now()
    this.taps = (this.taps || []).filter(t => now - t < 3000)
    this.taps.push(now)
    if (this.taps.length >= 2) {
      const gaps = this.taps.slice(1).map((t, i) => t - this.taps[i])
      this.bpm = Math.round(Math.max(40, Math.min(220, 60000 / (gaps.reduce((a, b) => a + b) / gaps.length))))
    }
    this.beatZero = now
    return this.bpm
  }

  level() {
    if (!this.active) return this.beatOn ? this.beatLevel() : 0
    this.analyser.getByteFrequencyData(this.bins)
    const n = this.focus === 'bass' ? Math.max(4, Math.floor(this.bins.length * 0.06)) : this.bins.length
    let sum = 0
    for (let i = 0; i < n; i++) sum += this.bins[i]
    const raw = sum / n / 255
    // auto-gain: track a slowly decaying peak so quiet and loud songs both use the full range
    this.peak = Math.max(raw, this.peak * 0.995, 0.05)
    const norm = Math.min(1, (raw / this.peak) * this.sensitivity)
    const shaped = Math.pow(norm, 1.6)
    this.smooth = shaped > this.smooth ? shaped : this.smooth * 0.8 + shaped * 0.2
    return Math.min(1, this.smooth)
  }
}
