// Gamepad support (PS4, PS5, Xbox One / Series and most generic pads) through the
// browser's Gamepad API. No drivers or add-ons: plug in by USB or pair by Bluetooth,
// then press any button on the pad so the browser shows it to the page.
//
// Two kinds of bindings, both configurable and saved in this browser:
//  - analog controls (sticks and triggers) drive values smoothly: the main level, the
//    stroke range, pattern speed and the music position
//  - buttons run the same actions as the keyboard shortcuts

import {ACTIONS} from './shortcuts.js'

const KEY = 'tr-pad'

// Analog controls. "set" uses the input as the value itself (a trigger held halfway =
// 50%); "rate" moves the value while the stick is pushed.
export const ANALOG = [
  {id: 'mainSet', label: 'Main level (held = level)', kind: 'set', def: 'b7'},
  {id: 'mainRate', label: 'Main level up / down', kind: 'rate', def: 'a1-'},
  {id: 'rangeMove', label: 'Slide the stroke range', kind: 'rate', def: 'a2'},
  {id: 'rangeSize', label: 'Widen / narrow the stroke range', kind: 'rate', def: 'a3-'},
  {id: 'patternSpeed', label: 'Pattern speed', kind: 'rate', def: ''},
  {id: 'musicSeek', label: 'Music: scrub back / forward', kind: 'rate', def: 'a0'}
]

// Default button layout (standard mapping numbers)
const BUTTON_DEFAULTS = {
  12: 'mainUp', 13: 'mainDown', 14: 'rangeDown', 15: 'rangeUp',
  0: 'nextPattern', 1: 'mainZero', 2: 'strokerMode', 3: 'mainMax',
  4: 'cycleMode', 5: 'musicPlay', 8: 'toggleMic', 9: 'pause'
}

// Button names per family, by standard-mapping index
const NAMES = {
  xbox: ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'L-stick press', 'R-stick press', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →', 'Xbox'],
  ps: ['✕ Cross', '○ Circle', '□ Square', '△ Triangle', 'L1', 'R1', 'L2', 'R2', 'Share / Create', 'Options', 'L3', 'R3', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →', 'PS', 'Touchpad'],
  generic: ['Button 1', 'Button 2', 'Button 3', 'Button 4', 'L shoulder', 'R shoulder', 'L trigger', 'R trigger', 'Select', 'Start', 'L-stick press', 'R-stick press', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →', 'Home']
}
const AXES = ['Left stick ←→', 'Left stick ↑↓', 'Right stick ←→', 'Right stick ↑↓']

export function familyOf(pad) {
  const id = (pad?.id || '').toLowerCase()
  if (/045e|xbox|xinput|x-box/.test(id)) return 'xbox'
  if (/054c|dualsense|dualshock|wireless controller|playstation|ps4|ps5/.test(id)) return 'ps'
  return 'generic'
}
export function padName(pad) {
  const f = familyOf(pad)
  const id = pad?.id || ''
  if (/dualsense|0ce6|0df2/i.test(id)) return 'PS5 DualSense'
  if (f === 'ps') return 'PS4 DualShock 4'
  if (f === 'xbox') return 'Xbox controller'
  return id.replace(/\(.*?\)/g, '').trim() || 'Gamepad'
}

// Input codes: "b7" = button 7 (analog triggers give 0..1), "a1" = axis 1, "a1-" = axis 1 reversed
export function inputLabel(code, family = 'generic') {
  if (!code) return '—'
  const m = code.match(/^([ab])(\d+)(-?)$/)
  if (!m) return code
  if (m[1] === 'b') return NAMES[family][+m[2]] || `Button ${+m[2] + 1}`
  return (AXES[+m[2]] || `Axis ${+m[2] + 1}`) + (m[3] ? ' (reversed)' : '')
}

export function defaultPad() {
  const buttons = {}
  for (const [b, id] of Object.entries(BUTTON_DEFAULTS)) buttons[id] = 'b' + b
  return {
    enabled: true,
    deadzone: 0.15,
    speed: 1, // how fast "rate" controls move (1 = full range in about a second)
    analog: Object.fromEntries(ANALOG.map(a => [a.id, a.def])),
    buttons,
    rumble: true
  }
}
export function loadPad() {
  const d = defaultPad()
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}') || {}
    return {...d, ...s, analog: {...d.analog, ...(s.analog || {})}, buttons: s.buttons ? s.buttons : d.buttons}
  } catch { return d }
}
export function savePad(p) { try { localStorage.setItem(KEY, JSON.stringify(p)) } catch {} }

export const PAD_ACTIONS = [
  ...ACTIONS.filter(a => !/Link$/.test(a.id)),
  {id: 'cycleMode', label: 'Next mode (Manual → Patterns → Music → Screen)'},
  {id: 'musicPlay', label: 'Music: play / pause'},
  {id: 'musicBack', label: 'Music: back 10 s'},
  {id: 'musicFwd', label: 'Music: forward 10 s'}
].filter((a, i, all) => all.findIndex(b => b.id === a.id) === i)

// Polls the first connected pad and calls the handlers.
//  onButton(actionId) - a bound button was pressed (and repeats while held, for the
//                       actions listed in `repeat`)
//  onAnalog(id, value, dt) - "set" controls: value 0..1 when it changes;
//                            "rate" controls: value -1..1 every frame while pushed
export class GamepadInput {
  constructor({onButton, onAnalog, onChange}) {
    this.cfg = loadPad()
    this.onButton = onButton
    this.onAnalog = onAnalog
    this.onChange = onChange || (() => {})
    this.prev = {}
    this.held = {}
    this.lastSet = {}
    this.capture = null // when binding: fn(code)
    this.repeat = new Set(['mainUp', 'mainDown', 'rangeUp', 'rangeDown', 'rangeWiden', 'rangeNarrow', 'musicBack', 'musicFwd'])
    addEventListener('gamepadconnected', () => { this.onChange(); this.start() })
    addEventListener('gamepaddisconnected', () => this.onChange())
    if (this.pad) this.start()
  }
  get pad() {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : []
    return pads.find(p => p.mapping === 'standard') || pads[0] || null
  }
  get supported() { return !!navigator.getGamepads }
  save() { savePad(this.cfg) }
  start() {
    if (this.running) return
    this.running = true
    this.t = performance.now()
    const loop = () => {
      const pad = this.pad
      if (!pad) { this.running = false; return }
      const now = performance.now(), dt = Math.min(0.1, (now - this.t) / 1000)
      this.t = now
      this.read(pad, dt, now)
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  }
  value(pad, code) {
    const m = code?.match(/^([ab])(\d+)(-?)$/)
    if (!m) return 0
    let v = m[1] === 'b' ? (pad.buttons[+m[2]]?.value ?? 0) : (pad.axes[+m[2]] ?? 0)
    if (m[3]) v = -v
    return v
  }
  read(pad, dt, now) {
    const dz = this.cfg.deadzone
    // binding mode: report the first input that moves clearly
    if (this.capture) {
      for (let i = 0; i < pad.buttons.length; i++) {
        if (pad.buttons[i].value > 0.5 && !this.prev['b' + i]) { const f = this.capture; this.capture = null; f('b' + i); break }
      }
      for (let i = 0; i < pad.axes.length && this.capture; i++) {
        const v = pad.axes[i]
        if (Math.abs(v) > 0.6) { const f = this.capture; this.capture = null; f('a' + i + (v < 0 ? '-' : '')) }
      }
      for (let i = 0; i < pad.buttons.length; i++) this.prev['b' + i] = pad.buttons[i].value > 0.5
      return
    }
    if (!this.cfg.enabled) return
    // buttons (a trigger bound to an analog control isn't also a button)
    const analogCodes = new Set(Object.values(this.cfg.analog).filter(Boolean).map(c => c.replace('-', '')))
    for (const [id, code] of Object.entries(this.cfg.buttons)) {
      if (!code || analogCodes.has(code)) continue
      const down = this.value(pad, code) > 0.5
      if (down && !this.prev[code]) { this.onButton(id); this.held[code] = now + 380 }
      else if (down && this.repeat.has(id) && now > (this.held[code] || Infinity)) { this.onButton(id); this.held[code] = now + 110 }
      if (!down) delete this.held[code]
      this.prev[code] = down
    }
    for (let i = 0; i < pad.buttons.length; i++) this.prev['b' + i] = pad.buttons[i].value > 0.5
    // analog controls
    for (const a of ANALOG) {
      const code = this.cfg.analog[a.id]
      if (!code) continue
      let v = this.value(pad, code)
      if (a.kind === 'set') {
        v = Math.max(0, v)
        const tdz = Math.min(dz, 0.05) // triggers rest at 0: a small dead zone keeps 60% pressed = 60%
        v = v < tdz ? 0 : (v - tdz) / (1 - tdz)
        const last = this.lastSet[a.id]
        // only take over while it is being used (so the slider still works when the trigger rests)
        if (last === undefined ? v > 0 : Math.abs(v - last) > 0.01) { this.lastSet[a.id] = v; this.onAnalog(a.id, v, dt) }
      } else if (Math.abs(v) > dz) {
        v = Math.sign(v) * (Math.abs(v) - dz) / (1 - dz)
        this.onAnalog(a.id, v * this.cfg.speed, dt)
      }
    }
  }
  // the pad rumbles with my own toy level (Xbox and PlayStation pads in Chrome / Edge)
  rumble(level) {
    const act = this.pad?.vibrationActuator
    if (!act || !this.cfg.rumble) return
    const now = performance.now()
    if (level < 0.02) { if (this.rumbling) { this.rumbling = false; act.reset?.() } return }
    if (now - (this.lastRumble || 0) < 180) return
    this.lastRumble = now
    this.rumbling = true
    act.playEffect?.('dual-rumble', {duration: 250, strongMagnitude: level, weakMagnitude: Math.min(1, level * 0.8)}).catch(() => {})
  }
}
