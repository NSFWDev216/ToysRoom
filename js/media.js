// Shared media for a controller's group: music (YouTube / Spotify players, or a song
// streamed from the controller) and the live feed (YouTube, Twitch, a video link, any
// web page that allows being shown inside another site, or a video file streamed
// peer-to-peer).
//
// Embedded players run on each person's own device. The controller's player is the
// "leader": play, pause and seek are sent to the group, and everyone else's player
// follows. Nothing goes through a server of ours.

const SCRIPTS = {}
function loadScript(src) {
  return (SCRIPTS[src] ||= new Promise((ok, bad) => {
    const s = document.createElement('script')
    s.src = src
    s.async = true
    s.onload = ok
    s.onerror = () => { delete SCRIPTS[src]; bad(new Error('Could not load ' + new URL(src).host)) }
    document.head.append(s)
  }))
}

let ytReady = null
function youtubeApi() {
  return (ytReady ||= new Promise((ok, bad) => {
    if (window.YT?.Player) return ok(window.YT)
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => { prev?.(); ok(window.YT) }
    loadScript('https://www.youtube.com/iframe_api').catch(e => { ytReady = null; bad(e) })
  }))
}
let spReady = null
function spotifyApi() {
  return (spReady ||= new Promise((ok, bad) => {
    if (window.__spotifyIframeApi) return ok(window.__spotifyIframeApi)
    window.onSpotifyIframeApiReady = api => { window.__spotifyIframeApi = api; ok(api) }
    loadScript('https://open.spotify.com/embed/iframe-api/v1').catch(e => { spReady = null; bad(e) })
  }))
}

const VIDEO_EXT = /\.(mp4|webm|ogv|ogg|mov|m4v|mp3|m4a|wav|flac|aac|opus)(\?|#|$)/i

// A Scrolller category link (https://scrolller.com/<category>), or null for anything else.
export function parseScrolllerLink(input) {
  const src = parseMediaLink(input)
  return src?.kind === 'scrolller' ? src : null
}
// "these_tits_are_stunning_3cd07b46" -> "These tits are stunning"
export const scrolllerTitle = slug => {
  const t = String(slug || '').replace(/^r\//, '').replace(/_[0-9a-f]{6,}$/i, '').replace(/[_-]+/g, ' ').trim()
  return t ? t[0].toUpperCase() + t.slice(1) : 'Scrolller'
}

// Turns a pasted link into something we can play. Returns null if it isn't a link.
export function parseMediaLink(input) {
  let u
  const text = String(input || '').trim()
  // a pasted <iframe src="..."> embed code works too
  const src = text.match(/src=["']([^"']+)["']/i)?.[1] || text
  try { u = new URL(/^[a-z]+:\/\//i.test(src) ? src : 'https://' + src) } catch { return null }
  if (!/^https?:$/.test(u.protocol) || (!u.hostname.includes('.') && u.hostname !== 'localhost')) return null
  const host = u.hostname.replace(/^(www|m|music)\./, '')
  const startOf = () => {
    const t = u.searchParams.get('t') || u.searchParams.get('start') || ''
    const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/)
    return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0
  }
  if (host === 'scrolller.com') {
    const slug = u.pathname.match(/^\/((?:r\/)?[A-Za-z0-9_-]{2,100})\/?$/)?.[1]
    if (slug) return {kind: 'scrolller', slug, url: 'https://scrolller.com/' + slug}
    return null
  }
  if (host === 'youtu.be') return {kind: 'youtube', id: u.pathname.slice(1, 12), start: startOf(), url: u.href}
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const id = u.searchParams.get('v') || u.pathname.match(/\/(?:embed|shorts|live|v)\/([\w-]{11})/)?.[1]
    if (id) return {kind: 'youtube', id, start: startOf(), url: u.href}
    const list = u.searchParams.get('list')
    if (list) return {kind: 'youtube', list, start: 0, url: u.href}
  }
  if (host === 'open.spotify.com') {
    const m = u.pathname.match(/\/(?:intl-[\w-]+\/)?(?:embed\/)?(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]+)/)
    if (m) return {kind: 'spotify', uri: `spotify:${m[1]}:${m[2]}`, url: u.href}
  }
  if (text.startsWith('spotify:')) return {kind: 'spotify', uri: text, url: text}
  if (host === 'twitch.tv' || host === 'clips.twitch.tv' || host === 'player.twitch.tv') {
    if (host === 'clips.twitch.tv') return {kind: 'twitch', clip: u.pathname.slice(1) || u.searchParams.get('clip'), url: u.href}
    if (host === 'player.twitch.tv') return {kind: 'twitch', channel: u.searchParams.get('channel'), video: u.searchParams.get('video'), url: u.href}
    const p = u.pathname.split('/').filter(Boolean)
    if (p[0] === 'videos') return {kind: 'twitch', video: p[1], url: u.href}
    if (p[1] === 'clip') return {kind: 'twitch', clip: p[2], url: u.href}
    if (p[0]) return {kind: 'twitch', channel: p[0], url: u.href}
  }
  if (VIDEO_EXT.test(u.pathname)) return {kind: 'video', url: u.href}
  return {kind: 'page', url: u.href}
}

export const mediaLabel = src => src ? ({
  youtube: '▶ YouTube', spotify: '🟢 Spotify', twitch: '🟣 Twitch', video: '🎞 Video', page: '🌐 Web page', stream: '📡 Shared from the controller'
}[src.kind] || '') : ''

// Wraps one player inside `box`. `leader` players report what they do through onState.
export class EmbedPlayer {
  constructor(box, {leader = false, audioOnly = false, onState = () => {}, onNeedTap = () => {}} = {}) {
    this.box = box
    this.leader = leader
    this.audioOnly = audioOnly
    this.onState = onState
    this.onNeedTap = onNeedTap
    this.src = null
    this.volume = 1
    this.want = null // last state from the leader
  }

  get kind() { return this.src?.kind }

  async load(src) {
    if (src && this.src && JSON.stringify(src) === JSON.stringify(this.src)) return
    this.destroy()
    this.src = src
    if (!src) return
    const token = this.token = {}
    const holder = document.createElement('div')
    holder.className = 'embed-holder'
    this.box.replaceChildren(holder)
    if (src.kind === 'youtube') {
      const YT = await youtubeApi()
      if (this.token !== token) return
      const target = document.createElement('div')
      holder.append(target)
      await new Promise(ok => {
        this.yt = new YT.Player(target, {
          host: 'https://www.youtube-nocookie.com',
          videoId: src.id || undefined,
          playerVars: {playsinline: 1, rel: 0, start: src.start || 0, ...(src.list ? {listType: 'playlist', list: src.list} : {}), ...(this.leader ? {} : {controls: 0, disablekb: 1})},
          events: {
            onReady: () => { this.setVolume(this.volume); ok() },
            onStateChange: e => this.ytChange(e.data)
          }
        })
      })
      if (this.leader) this.poll = setInterval(() => this.checkJump(), 1000)
    } else if (src.kind === 'spotify') {
      const api = await spotifyApi()
      if (this.token !== token) return
      const target = document.createElement('div')
      holder.append(target)
      await new Promise(ok => api.createController(target, {uri: src.uri, width: '100%', height: this.audioOnly ? 152 : 232}, c => {
        this.sp = c
        c.addListener('ready', ok)
        c.addListener('playback_update', e => this.spChange(e.data))
      }))
    } else if (src.kind === 'twitch') {
      const parent = location.hostname || 'localhost'
      const url = src.clip
        ? `https://clips.twitch.tv/embed?clip=${encodeURIComponent(src.clip)}&parent=${parent}`
        : `https://player.twitch.tv/?${src.video ? 'video=' + encodeURIComponent(src.video) : 'channel=' + encodeURIComponent(src.channel)}&parent=${parent}&autoplay=true&muted=false`
      holder.append(this.frame(url))
    } else if (src.kind === 'video') {
      const v = this.mediaEl(src.url)
      holder.append(v)
    } else if (src.kind === 'page') {
      const f = this.frame(src.url)
      f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-forms allow-presentation')
      holder.append(f)
      const note = document.createElement('div')
      note.className = 'muted small embed-note'
      note.textContent = 'Blank? This site does not allow being shown inside other sites. Use “Open in new tab”.'
      holder.append(note)
    } else if (src.kind === 'stream') {
      const v = this.mediaEl(null)
      v.srcObject = src.stream
      v.controls = false
      holder.append(v)
      this.tryPlay(v)
    }
    if (this.want) this.apply(this.want)
  }

  frame(url) {
    const f = document.createElement('iframe')
    f.src = url
    f.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture'
    f.allowFullscreen = true
    f.referrerPolicy = 'strict-origin-when-cross-origin'
    return f
  }

  mediaEl(url) {
    const v = document.createElement(this.audioOnly && url && /\.(mp3|m4a|wav|flac|aac|opus|ogg)(\?|#|$)/i.test(url) ? 'audio' : 'video')
    v.playsInline = true
    v.controls = this.leader
    if (url) v.src = url
    v.volume = this.volume
    if (this.leader) {
      for (const ev of ['play', 'pause', 'seeked']) v.addEventListener(ev, () => this.report())
    }
    this.el = v
    return v
  }

  tryPlay(v) {
    v.play().catch(() => this.onNeedTap())
  }

  // ---- leader side: report what the controller does ----
  report() {
    const s = this.state()
    if (s) { this.lastReport = {...s, at: performance.now()}; this.onState(s) }
  }
  state() {
    if (this.yt?.getCurrentTime) return {playing: this.yt.getPlayerState?.() === 1, t: this.yt.getCurrentTime() || 0}
    if (this.sp && this.spState) return {playing: !this.spState.isPaused, t: (this.spState.position || 0) / 1000}
    if (this.el && this.el.src) return {playing: !this.el.paused, t: this.el.currentTime}
    return null
  }
  ytChange(code) {
    if (this.leader) { if (code === 1 || code === 2) this.report() }
    else if (code === -1 || code === 5) this.apply(this.want)
  }
  spChange(d) {
    const prev = this.spState
    this.spState = d
    if (!this.leader) return
    const jump = prev && Math.abs((d.position - prev.position) / 1000) > 3
    if (!prev || prev.isPaused !== d.isPaused || jump) this.report()
  }
  // a seek in YouTube doesn't fire an event: notice the jump
  checkJump() {
    const s = this.state(), r = this.lastReport
    if (!s || !r) return s && this.report()
    const expected = r.t + (r.playing ? (performance.now() - r.at) / 1000 : 0)
    if (s.playing !== r.playing || Math.abs(s.t - expected) > 2) this.report()
  }

  // ---- follower side: copy the controller ----
  apply(want) {
    if (!want) return
    this.want = {...want, got: want.got || performance.now()}
    const t = this.want.t + (this.want.playing ? (performance.now() - this.want.got) / 1000 : 0)
    if (this.yt?.seekTo) {
      if (Math.abs((this.yt.getCurrentTime?.() || 0) - t) > 2) this.yt.seekTo(t, true)
      if (want.playing) { this.yt.playVideo(); setTimeout(() => { if (this.yt?.getPlayerState?.() !== 1 && this.want?.playing) this.onNeedTap() }, 1500) }
      else this.yt.pauseVideo()
    } else if (this.sp) {
      const at = (this.spState?.position || 0) / 1000
      if (Math.abs(at - t) > 3) this.sp.seek(t)
      if (want.playing && (!this.spState || this.spState.isPaused)) this.sp.resume?.() ?? this.sp.play()
      if (!want.playing && this.spState && !this.spState.isPaused) this.sp.pause()
    } else if (this.el && this.el.src) {
      if (Math.abs(this.el.currentTime - t) > 1.5) this.el.currentTime = t
      if (want.playing && this.el.paused) this.tryPlay(this.el)
      if (!want.playing && !this.el.paused) this.el.pause()
    }
  }
  // after a tap (browsers only allow sound after the person touches the page)
  resume() {
    if (this.yt?.playVideo) this.yt.playVideo()
    else if (this.sp) this.sp.play()
    else if (this.el) this.el.play().catch(() => {})
    if (this.want) setTimeout(() => this.apply(this.want), 300)
  }

  // leader controls (used by the music DJ bar and the gamepad)
  togglePlay() {
    if (this.yt?.getPlayerState) this.yt.getPlayerState() === 1 ? this.yt.pauseVideo() : this.yt.playVideo()
    else if (this.sp) this.sp.togglePlay()
    else if (this.el) this.el.paused ? this.el.play() : this.el.pause()
  }
  seekBy(sec) {
    const s = this.state()
    if (!s) return
    const t = Math.max(0, s.t + sec)
    if (this.yt?.seekTo) this.yt.seekTo(t, true)
    else if (this.sp) this.sp.seek(t)
    else if (this.el) this.el.currentTime = t
    setTimeout(() => this.report(), 300)
  }
  seekTo(t) { const s = this.state(); if (s) this.seekBy(t - s.t) }
  get duration() {
    if (this.yt?.getDuration) return this.yt.getDuration() || 0
    if (this.spState) return (this.spState.duration || 0) / 1000
    return Number.isFinite(this.el?.duration) ? this.el.duration : 0
  }

  // Volume is each person's own. Spotify's embed has no volume control, so it uses the
  // device volume.
  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v))
    if (this.yt?.setVolume) { this.yt.setVolume(Math.round(this.volume * 100)); this.volume ? this.yt.unMute() : this.yt.mute() }
    if (this.el) { this.el.volume = this.volume; this.el.muted = this.volume === 0 || !!this.selfMuted }
  }
  get canSetVolume() { return this.kind !== 'spotify' && this.kind !== 'twitch' && this.kind !== 'page' }

  destroy() {
    this.token = null
    clearInterval(this.poll)
    try { this.yt?.destroy() } catch {}
    try { this.sp?.destroy() } catch {}
    if (this.el) { this.el.pause?.(); this.el.removeAttribute('src'); this.el.srcObject = null }
    this.yt = this.sp = this.el = this.spState = this.lastReport = null
    this.src = null
    this.want = null
    this.box.replaceChildren()
  }
}
