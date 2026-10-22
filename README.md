# Toy Rooms

A static website (HTML + JavaScript, no build step, no server) where adults share
control of their connected toys in rooms. It is meant for GitHub Pages or any
free static host.

## What it does

- **Age gate** on first visit (18+ and consent checkboxes, remembered on that device).
- **Rooms** with a name, topic, max people and a control turn length.
- **Public room list** of active rooms, and **private rooms** that never appear in
  the list and can only be joined with the invite code or link.
- **Rotating controller**: one person controls everyone's toys at a time. When the
  timer runs out the controls pass to the next person. People can untick "Take turns"
  to sit out, the controller can pass early, and the host can skip.
- **Controls**: an old-school vertical slider with presets, 8 built-in patterns
  (speed and strength adjustable), and **music mode**, where toys follow the beat
  of a song (or the microphone) and the room can hear the song.
- **Multiple controllers**: the host picks how many people control at once (1 to 10).
  Everyone else is split evenly between them in join order, and the groups rebalance
  automatically as people come and go. Each person sees who controls them.
- **Rotation on or off**: the host decides whether controllers rotate on a timer (and
  how long each turn is) or keep the controls until they pass or leave. "Rotate now"
  lets the host move to the next controllers early. Both settings can be changed
  while the room is running.
- **Shuffle controllers**: the host can instantly give every controller seat to new,
  randomly picked people (people who weren't controlling get priority).
- **Host picks controllers**: in the People list the host can tap **🎛 Make
  controller** to hand someone the controls right now (they take a free seat, or the
  newest controller's seat), **✖ Remove from controls**, and **📌 Pick** people so only
  the picked people take turns at the controls. “Let everyone take turns” clears the
  picks.
- **Music for your group, DJ style**: the controller's music goes only to the people
  they control by default (or to everyone in the room, chosen next to “Let them hear
  my music”). The controller gets a seek bar with ⏪ 10 s / ⏩ 10 s to scrub and rewind,
  and their own volume. People who hear the music get a **🎵 Now playing** card with
  their own volume bar.
- **🖥 Screen mode** (next to Manual, Patterns and Music): the controller shares a
  tab, window or the whole screen **with its sound** (YouTube, Spotify, a game,
  anything), only to the people they control, and the toys follow that sound. Each
  person watching has their own 🔇 mute button and volume slider. This replaced the
  separate YouTube / Spotify players in Music mode, which couldn't drive the toys.
  See “Screen mode” below.
- **🖼 Scrolller preview**: controllers can open a Scrolller category
  (`https://scrolller.com/<category>`, nothing else is accepted) for the people they
  control, in its own small window with “↗ Full” to open it full screen in a new tab.
  See “Scrolller preview” below.
- **📺 Live feed**: controllers can show the people they control a YouTube video, a
  Twitch stream, a video link, any web page that allows it, or a video file from
  their device (streamed peer-to-peer only to their group). It opens in a small
  window that can be dragged, enlarged, hidden, and has its own volume.
- **🎮 Gamepad**: PS4, PS5, Xbox One / Series and most generic pads work in Manual,
  Patterns and Music. Every stick, trigger and button is configurable (🎮 button next
  to ⌨). Your own pad can also rumble with your toy level.
- **Drag-friendly controls**: all faders and the stroke-range bar use pointer events,
  so press-and-drag works the same with a mouse, finger or pen. You can grab anywhere
  on a fader. The range bar can be dragged by either end, or by the middle to slide
  the whole window.
- **Keyboard shortcuts** (⌨ button next to the mode tabs), all rebindable and saved
  in the browser. Defaults: ↑/↓ main level, 0 off, M max, Shift+→/← slide the stroke
  range by 1% (25–50% becomes 26–51%), Shift+↑/↓ widen or narrow it, Q/W/E/R modes,
  N next pattern, Esc pause my toys. Each feature also has optional up/down/link keys,
  and the step sizes can be changed. Holding a key keeps changing the value.
- **Feature mixer**: toys aren't just "intensity". The controller drives vibrate,
  rotate, thrust/oscillate, suction, pump/constrict and stroke speed separately, plus a
  stroke range (bottom/top). Each feature can follow the main level or be set by hand,
  and every toy only uses the features it has (Nora rotates, Max pumps, The Handy
  strokes inside the range, and so on). Each person's own stroke limits always apply.
- **Stroker control toggle** (above the stroke range): choose **🔁 Speed + range** (the
  main level is the stroke speed and the stroker moves up and down inside the range by
  itself) or **📍 Position** (the main level is where the stroker is inside the range:
  0% = bottom, 100% = top). It works in Manual, Patterns and Music. In position mode a
  Funscript plays its exact positions, a glowing marker on the range bar shows where the
  stroker is, and toys that only understand a speed (for example Lovense Solace) get a
  speed worked out from how fast the position moves. Shortcut: `P`. The personal max
  slider limits how fast a stroker may travel in position mode (at 100% a full stroke
  takes 0.25 s). The Handy (connection key) uses HDSP for this, the Handy HSP stream
  sends position points, and Intiface sends LinearCmd moves.
- **Pattern library**: import patterns from other platforms (Funscript files used by
  The Handy, XToys and EroScripts; Lovense pattern files/text; JSON or CSV number
  lists), or record your own while you control. Saved in the browser.
- **Local profile, no sign-in**: a permanent ID, name, gender, preference, avatar,
  colour and short bio, stored in the browser. Export/import it as a file to use it
  on another device. Recent rooms are remembered, and you can mute people in chat.
- **Chat** and a people list showing who is host, who is controlling, and what toys
  each person has.
- **Safety for every person**: a personal max-intensity slider, a "Pause my toys"
  button (Esc key on desktop), and toys stop automatically if the controller drops
  off for more than ~3 seconds.
- Works on phones (tabbed layout) and desktops (three columns).

## Supported toys

| Option in "My toys" | Needs | Notes |
|---|---|---|
| Simulated toy | nothing | On-screen toy for trying it out |
| Lovense (Remote app, Game Mode) | Lovense Remote or Lovense Connect app | In the app: Discover > Game Mode > Enable LAN. Enter the Local IP and HTTPS port it shows (default 30010). Phone and browser on the same Wi-Fi. |
| Lovense (Bluetooth, Chrome) | Chrome/Edge on desktop or Android | Talks to the toy directly. Not available on iPhone/Safari. |
| Lovense connect ID / QR code | your Lovense developer token (site owner sets it up once) | Users scan a QR code in Lovense Remote; works from anywhere. See below. |
| The Handy (connection key) | the Handy's connection key | Uses Handy API v2 with only the connection key. The room level sets stroke speed; stroke range is set per user. |
| The Handy HSP stream | connection key | Handy Streaming Protocol (API v3). Smoother motion. If your firmware or account rejects it, use the plain connection-key option. |
| Intiface Central (any brand) | Intiface Central running on the same device | Covers hundreds of toys over Bluetooth (Lovense, We-Vibe, Kiiroo, Satisfyer, Handy and more). |
| XToys (private webhook) | an XToys account and a small XToys script | Sends the room to your own XToys session so any toy XToys supports can follow. See "XToys webhook" below. |

Toy connection details are saved only in that person's browser and are never sent
to the room. The room only sends feature levels (0 to 100%) and the stroke range.

## Voice chat

(See also “Gamepad” and “YouTube, Spotify and the live feed” further down.)

Tap **🎙 Join voice** in a room to talk with everyone else who joined voice. Audio goes
directly between browsers over the same WebRTC connections the room already uses
(public STUN servers, no paid service).

- 🎤 button (or the **V** shortcut): mute or unmute your own microphone.
- People tab: 🔊/🔇 mutes one person's voice for you only, and the small fader sets
  their volume. Volumes are remembered per person in your browser.
- 💬 hides one person's chat messages.
- Whoever is talking gets a green outline.

Because everyone sends their voice to everyone (a "mesh"), voice works best with up
to about 8 to 10 people talking. Bigger rooms still work for toys and chat; for big
voice groups you would need a media server (SFU), which costs money to run.

## Pattern sources ("🌐 Browse" in the Patterns tab)

The Browse window lists patterns from one or more **sources** set in
`js/config.js` → `patternSources`. Anything you save goes into your local library.

- **Toy Rooms catalog** (works now): `patterns/catalog.json` plus the pattern files
  next to it. Add your own patterns by dropping a `.funscript` or Lovense pattern file
  in `patterns/` and adding an entry to `catalog.json`:
  ```json
  {"id": "my-file", "name": "My pattern", "description": "...", "author": "me",
   "format": "funscript", "tags": ["tease"], "url": "my-file.funscript"}
  ```
- **XToys public patterns**: not available yet. XToys does not offer a public API or
  a developer program for its pattern library, and its pages can't be read from
  another website. What does work today: download or export a pattern/script from
  XToys as a Funscript and use **📂 Import file**.
- **Lovense pattern library**: not available yet. Lovense's developer APIs
  (Standard API, Basic SDK, Game Mode) control toys but don't list the community
  patterns in Lovense Remote. Pattern files you export can be imported.

### XToys pattern site inside Toy Rooms (works now)

In **🌐 Browse**, pick **XToys pattern site (embedded)**. The real
[xtoys.app/patterns](https://xtoys.app/patterns) page opens inside Toy Rooms, so
you can browse its public patterns without leaving the room. XToys allows its site to
be embedded like this.

What a browser does not allow: one website reading another website's page. Toy Rooms
can show the XToys page, but it cannot see or download what is inside it, and XToys
doesn't offer a way to send patterns to other sites. So bringing a pattern over takes
one step from you:

1. On the XToys page, export, download or copy the pattern you like.
2. Bring it into Toy Rooms with any of these, right under the XToys page:
   - drag the downloaded file onto the **Drop a pattern file here** box,
   - **📂 Choose file**,
   - **📋 Paste from clipboard** after copying the pattern, or
   - paste the pattern data into the text box and press **＋ Save**.
3. Give it a name. It is saved in your library and plays like any other pattern.

Funscripts, Lovense pattern text, JSON (including a pattern nested inside a larger
JSON export) and number lists are all understood. XToys "generic output" exports (a bare list
of `{"at": ms, "pos": 0-100}` points without the surrounding `[ ]`) work too, and
patterns of several hours import in well under a second. Slow curves like these are
played as an intensity level over time; fast funscripts are played as strokes. A link to a pattern *page* can't be
used, because the page can't be read from here. Use the pattern's data or file.

If the embedded page ever stays blank (for example if XToys starts blocking
embedding), use **↗ Open in new tab** and bring the pattern back the same way. To
point the embed somewhere else, change the `xtoys-site` entry's `url` in
`js/config.js` → `patternSources`.

### Connecting XToys or Lovense later (if they give you access)

1. Ask for API access:
   - Lovense: sign in at the Lovense developer dashboard
     (lovense.com → Developer, "Developer Dashboard") with the account that holds your
     developer token, and contact Lovense developer support to ask for pattern library
     access.
   - XToys: contact the XToys developer (links on xtoys.app; XToys is run by one
     developer and supported through Patreon/Discord) and ask for pattern API access.
2. Never put a provider's secret key in `config.js`: this is a public website and
   anyone can read it. Instead, create a tiny free proxy (for example a Cloudflare
   Worker, like the Lovense token example below) that keeps the secret and answers
   `GET /?q=search&page=1` with:
   ```json
   {"patterns": [{"id": "123", "name": "Name", "description": "...", "author": "...",
                  "format": "funscript", "tags": [], "url": "https://.../file"}]}
   ```
   (`content` with the pattern text can be used instead of `url`.) The proxy must send
   `Access-Control-Allow-Origin` for your site.
3. In `js/config.js`, find the `xtoys` or `lovense` entry under `patternSources` and
   set `url` to your proxy's address. `apiKey` is optional and is only for protecting
   *your* proxy; it is sent as `Authorization: Bearer <key>`.
4. Reload the site. The source no longer says "(not connected)" in Browse.

## XToys webhook (any XToys toy follows the room)

1. In XToys, open your user info and copy your **Private Webhook** ID.
2. In XToys, make a custom script with a webhook trigger for the action `toyrooms`.
   Each message has `vibrate`, `rotate`, `thrust`, `suction`, `pump`, `stroke`, `lo` and
   `hi` (all 0 to 100). Map the ones you want to your toys in the script.
   Messages also have `mode` (`speed` or `position`) and `position` (0 to 100, with your
   own limits and the room range already applied), for strokers in position mode.
3. In Toy Rooms: My toys → "XToys (private webhook)" → paste the ID → Connect.

## Developer keys at a glance

| Service | Needed? | Where it goes |
|---|---|---|
| The Handy | No. The connection key from the Handy app is enough. | Entered by each user in My toys. Optional HSP Application ID: `config.js` → `handy.v3ApplicationId`. |
| Lovense Game Mode / Bluetooth | No | — |
| Lovense connect ID / QR | Yes, your developer token | `config.js` → `lovense.platform` + `lovense.authTokenEndpoint` (recommended) or `lovense.developerToken`. See below. |
| XToys webhook | No (each user's own webhook ID) | Entered by each user in My toys |
| XToys / Lovense pattern browsing | Needs access from them first | `config.js` → `patternSources` (see above) |

## How it works without a server

- Rooms are peer-to-peer WebRTC connections, using public STUN servers
  (Google, Cloudflare, Twilio) set in `js/config.js`.
- To find each other, browsers use free public **Nostr relays** through the
  [Trystero](https://github.com/dmotz/trystero) library (bundled in
  `js/vendor/trystero.js`, MIT licence). Add `?net=torrent` to the URL to use
  public WebTorrent trackers instead.
- The person who has been in a room longest is the **host**: they run the turn
  timer and announce public rooms to the lobby. If they leave, the next person
  takes over automatically.
- A room exists while at least one person is in it. When everyone leaves it is
  gone, but the same invite code can be reopened.

Limits worth knowing: a few strict networks (some mobile carriers, corporate Wi-Fi)
block direct peer-to-peer connections. For those, add a TURN server in
`CONFIG.turnServers`. Everyone in a room connects to everyone else, so rooms work
best up to about 15 to 20 people.

## Put it online with GitHub Pages (free)

1. Create a new GitHub repository and upload everything in this folder
   (`index.html`, `css/`, `js/`, `.nojekyll`, `README.md`).
2. In the repository: Settings > Pages > Build and deployment > Source:
   "Deploy from a branch", branch `main`, folder `/ (root)`. Save.
3. After a minute the site is live at `https://<your-username>.github.io/<repo>/`.

To try it locally, run `python3 -m http.server` in this folder and open
`http://localhost:8000`. Open `http://localhost:8000/?net=local` in several tabs of
the same browser to test rooms without the internet.

## Setting up Lovense connect ID (developer token)

Fill these in `js/config.js`:

```js
lovense: {
  platform: 'Your Website Name from the Lovense developer dashboard',
  developerToken: '',      // option A
  authTokenEndpoint: ''    // option B (recommended)
}
```

**Important:** GitHub Pages sites are public, and so is every file on them.
If you put the developer token in `config.js` (option A), any visitor can read it
and use your Lovense developer account. Option B keeps it secret: a tiny free
serverless function holds the token and gives the site short-lived auth tokens.
For example, a free Cloudflare Worker:

```js
export default {
  async fetch(req, env) {
    const uid = new URL(req.url).searchParams.get('uid')
    const r = await fetch('https://api.lovense-api.com/api/basicApi/getToken', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({token: env.LOVENSE_TOKEN, uid, uname: uid.slice(0, 8)})
    })
    const j = await r.json()
    return Response.json({authToken: j.data?.authToken}, {
      headers: {'Access-Control-Allow-Origin': 'https://<your-username>.github.io'}
    })
  }
}
```

Store the token as the Worker secret `LOVENSE_TOKEN`, then put the Worker URL in
`authTokenEndpoint`. In the Lovense developer dashboard, also allow your site's
domain.

## Gamepad

1. Connect the pad by USB or Bluetooth, then **press any button on it** (browsers only
   show a pad to a page after a button press). The 🎮 button gets a green dot.
2. Tap 🎮 to see or change the layout. Tap a box, then move the stick or press the
   button you want. Settings are saved in this browser.

Default layout (standard mapping, Xbox names / PlayStation names):

| Input | Does |
|---|---|
| RT / R2 (hold) | Main level = how far it is pressed |
| Left stick ↑↓ | Main level up / down |
| Right stick ←→ | Slide the stroke range |
| Right stick ↑↓ | Widen / narrow the stroke range |
| Left stick ←→ | Music: scrub back / forward |
| D-pad ↑ ↓ | Main level step up / down |
| D-pad ← → | Stroke range step down / up |
| A / ✕ | Next pattern |
| B / ○ | Main level off |
| X / □ | Stroker: speed + range / position |
| Y / △ | Main level max |
| LB / L1 | Next mode (Manual → Patterns → Music → Screen) |
| RB / R1 | Music play / pause |
| View / Share | Mute / unmute my mic |
| Menu / Options | Pause my toys |

Pattern speed can be put on a stick too. “Rumble my pad with my toy level” makes your
own pad vibrate with what your toys get (Chrome and Edge, Xbox and PlayStation pads).

## Screen mode (share a tab or screen with sound)

1. Take the controls, open the **Screen** tab and tap **🖥 Share screen with sound**.
2. In the browser's picker choose what to share. In Chrome or Edge, pick a **tab** and
   keep **“Share tab audio”** on: that is the most reliable way to get sound (play
   YouTube, Spotify's web player or anything else in that tab). Sharing the entire
   screen includes sound on Windows and ChromeOS; sharing a single window usually has
   no sound.
3. The people you control see and hear it in the live feed window, and their toys
   follow the sound (bass or the whole sound, with the sensitivity slider). Untick “Let
   them see the picture too” to share only the sound.
4. Stop with **⏹ Stop sharing** or the browser's own “Stop sharing” bar.

- It goes peer-to-peer, only to your own group, the same way the controls do. With
  several controllers, each group only gets its own controller's screen.
- Each viewer has a **🔇 mute** button and **their own volume slider** in the feed
  window (saved in their browser). Your own preview is muted so you don't hear an echo.
- Sharing a screen needs Chrome, Edge or Firefox on a computer. Phones and tablets
  can watch and listen but mostly can't share. Firefox shares the picture but usually
  not tab sound.
- Uploading takes your bandwidth: each person you control gets their own copy, so on
  home internet keep it to a handful of people per controller.

### Live feed sound moves the toys

- Embedded players (YouTube, Twitch, any web page) play inside each person's own
  browser, and no page is allowed to read their sound. So the toys follow the sound
  **as the controller hears it**: with “🎚 Toys follow the feed’s sound” on (the
  default), tapping “📺 Show them” asks the controller to share **this tab** with
  “Share tab audio” on. The levels are worked out on the controller's device and sent
  to their group, like every other control. The app switches to 🖥 Screen mode, which
  is where these levels are used.
- The tab's sound is everything this tab plays, so music, voice chat and the feed are
  all heard. Mute what you don't want to drive the toys.
- Video files shared as a feed need no extra step: the toys follow the file's sound
  directly.
- This needs Chrome or Edge on a computer. Firefox and Safari can show the feed but
  can't share tab sound, so the toys don't follow it there.
- Viewers: the 🔇 mute button and volume bar appear for screen shares and video files.
  Embedded sites (YouTube, Twitch, web pages) use their own sound controls, so the bar
  is hidden for them.

## Scrolller preview

- Controllers: paste a Scrolller category link in the Live feed card, for example
  `https://scrolller.com/these_tits_are_stunning_3cd07b46`, and tap **🖼 Show them**.
  Only `scrolller.com/<category>` links are accepted; anything else is refused.
- It opens in its own small window (separate from the video feed), which can be
  dragged, enlarged (⤢) or hidden (✕). **↗ Full** opens the category full screen on
  Scrolller in a new tab.
- 🃏 switches between the live page and a simple card with an “Open full screen”
  button. Use the card if the live page stays blank: Scrolller can refuse to be shown
  inside other sites, and that couldn't be checked from the build environment.
- Each person decides with “Open Scrolller previews automatically” whether it pops up
  by itself; when it's off, a small “🖼 Scrolller preview” button appears instead.

## YouTube, Spotify and the live feed

(YouTube links now play in the live feed. For music that should move the toys,
including YouTube and Spotify, use Screen mode above.)

- **Everyone plays their own copy.** YouTube, Spotify and Twitch players run on each
  person's device, so nobody streams those through the room. The controller's player
  leads: play, pause and seeking are sent to the group, and the other players follow
  within a second or two.
- **Tap to play.** Browsers block sound until you touch the page. If the music or the
  feed doesn't start, a “Tap to play” button appears.
- **Spotify**: people who aren't logged in to Spotify in that browser only hear
  30-second previews. Spotify's embedded player has no volume control, so the
  device volume is used.
- **Beat sync**: the page can't read the sound of an embedded player. To make toys
  follow YouTube or Spotify, use **Screen mode** and share the tab with its sound. In
  Music mode, **Pulse to a tempo** (set the BPM or tap along with 👆 Tap tempo) is
  also there. Songs from a file or the mic follow the beat as before.
- **Twitch** only plays inside sites served over HTTPS (or localhost), which GitHub
  Pages is. The site's address is passed to Twitch automatically.
- **Web pages**: many sites (Google, banks, most social networks) refuse to be shown
  inside another site. The feed then stays blank; use “↗ Open in new tab”.
- **Video files** are streamed straight from the controller's device to the people
  they control, nobody else. Chrome, Edge and Firefox can do this; Safari can't send
  a file this way yet, but can watch one.

## Files

- `index.html`, `css/app.css`: the page and styles
- `js/app.js`: user interface
- `js/room.js`: rooms, host election, max people, turn rotation, chat, public list
- `js/net.js`: peer-to-peer transport (Trystero) and the local test mode
- `js/toys.js`: toy adapters (add new brands here)
- `js/patterns.js`: built-in patterns (add your own here)
- `js/music.js`: music analysis for music mode
- `js/config.js`: STUN/TURN servers, relays, keys, pattern sources and limits
- `js/features.js`: the toy features (vibrate, rotate, ...) and wire format
- `js/controls.js`: drag-friendly faders and the stroke range bar
- `js/shortcuts.js`: keyboard shortcuts
- `js/profile.js`: local profile (ID, name, gender, ...)
- `js/library.js`: pattern import, recording and the local library
- `js/sources.js`: pattern sources for the Browse window
- `js/voice.js`: voice chat
- `js/media.js`: YouTube / Spotify / Twitch / video players and link parsing for music and the live feed
- `js/gamepad.js`: gamepad support and its configurable bindings
- `patterns/`: the built-in pattern catalog
- `tests/import-test.html`: pattern import tests; open it from the running site (for example `http://localhost:8000/tests/import-test.html`) and every line should say PASS

## Not yet tested on real hardware

The room logic, chat, turn rotation, multiple controllers, max-people limit, patterns,
pattern import/browse, shortcuts, dragging, the stroker position/speed toggle, host
picks, the gamepad (with a simulated pad), music and feed syncing between players and
the Handy v2 request flow (HAMP and HDSP) were tested in
a headless browser. Voice chat's controls were tested, but real audio between two
devices could not be, because it needs the live relays. The Lovense, Handy HSP, Intiface and
Bluetooth adapters follow the published APIs but have not been run against real toys
yet. Real YouTube and Spotify players, Twitch, and streaming a video or song file
between two devices could not be tried from the build environment either, and the public relays could not be reached from the build environment, so
please test with two real devices before inviting people.
