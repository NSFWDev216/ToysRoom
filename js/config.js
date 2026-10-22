// Central configuration. Everything that may need a key, URL or tweak lives here.

export const CONFIG = {
  appId: 'toyrooms-p2p-v1', // change this to run a completely separate network of rooms

  // Signaling only (finding peers). All room data then flows directly peer-to-peer.
  // 'nostr' = public Nostr relays, 'torrent' = public WebTorrent trackers,
  // 'local' = same-browser tabs only (for testing, via BroadcastChannel).
  // Override per visit with ?net=torrent or ?net=local
  network: 'nostr',

  // Public STUN servers used for WebRTC NAT traversal.
  iceServers: [
    {urls: 'stun:stun.l.google.com:19302'},
    {urls: 'stun:stun1.l.google.com:19302'},
    {urls: 'stun:stun.cloudflare.com:3478'},
    {urls: 'stun:global.stun.twilio.com:3478'}
  ],
  // Optional free/self-hosted TURN servers for strict NATs, e.g.
  // {urls: 'turn:your.turn.host:3478', username: 'user', credential: 'pass'}
  turnServers: [],

  lobbyRoom: 'lobby-v1',
  announceEveryMs: 5000,
  listingTtlMs: 16000,
  controlRateHz: 10,

  defaults: {maxPeople: 8, turnSeconds: 120},
  limits: {maxPeople: 50, minTurn: 15, maxTurn: 1800, maxControllers: 10},

  // ---- Toy services ----
  handy: {
    // API v2 works with just the device connection key (no developer key).
    v2Base: 'https://www.handyfeeling.com/api/handy/v2',
    // API v3 (HSP streaming). Works with the connection key; an Application ID is optional.
    v3Base: 'https://www.handyfeeling.com/api/handy-rest/v3',
    v3ApplicationId: '', // optional
    v3Paths: {
      mode: '/mode',
      serverTime: '/servertime',
      hspSetup: '/hsp/setup',
      hspAdd: '/hsp/add',
      hspPlay: '/hsp/play',
      hspStop: '/hsp/stop'
    }
  },
  lovense: {
    // Local "Game Mode" API exposed by the Lovense Remote / Lovense Connect app. No key needed.
    localDefaultPort: 30010,
    // Lovense Basic SDK (QR-code "connect ID" pairing), uses your developer token.
    // WARNING: on a static site anything in this file is public. A developerToken here can
    // be copied by any visitor. Safer: leave it empty and set authTokenEndpoint to a tiny
    // serverless function that holds the token and returns {authToken} for ?uid= (README).
    basicSdkScript: 'https://api.lovense-api.com/basic-sdk/core.min.js',
    getTokenUrl: 'https://api.lovense-api.com/api/basicApi/getToken',
    platform: '', // <-- your Website Name from the Lovense developer dashboard
    developerToken: '', // <-- your developer token (public if set here!)
    authTokenEndpoint: '' // <-- or: URL returning {authToken} for ?uid=...
  },
  intiface: {defaultUrl: 'ws://127.0.0.1:12345'},

  // XToys private webhook: room output is sent to your own XToys session, where a custom
  // XToys script can drive any toy XToys supports (see README).
  xtoys: {webhookBase: 'wss://webhook.xtoys.app/', action: 'toyrooms'},

  // ---- Pattern sources for "Browse patterns" (see js/sources.js and README) ----
  patternSources: [
    {id: 'catalog', name: 'Toy Rooms catalog', type: 'catalog', url: 'patterns/catalog.json'},
    // The real XToys pattern site shown inside Toy Rooms. Browse there, then bring a
    // pattern over with drag & drop, paste or the clipboard button (see README).
    {id: 'xtoys-site', name: 'XToys pattern site (embedded)', type: 'embed', url: 'https://xtoys.app/patterns'},
    {
      id: 'xtoys', name: 'XToys public patterns', type: 'api',
      url: '', // <-- your proxy endpoint once XToys gives you API access
      apiKey: '', // <-- optional key for YOUR proxy (never the provider's secret)
      setupHint: 'XToys has no public pattern API yet. See README > Pattern sources to connect it later.'
    },
    {
      id: 'lovense', name: 'Lovense pattern library', type: 'api',
      url: '', // <-- your proxy endpoint once Lovense gives you pattern access
      apiKey: '',
      setupHint: 'Lovense does not publish its pattern library through an API. See README > Pattern sources.'
    }
  ]
}

export function iceConfig() {
  return {iceServers: [...CONFIG.iceServers, ...CONFIG.turnServers]}
}
