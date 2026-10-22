// Configurable keyboard shortcuts, saved in this browser.

import {CHANNELS} from './features.js'

const KEY = 'tr-keys'

export const ACTIONS = [
  {id: 'mainUp', label: 'Main level up', def: 'ArrowUp'},
  {id: 'mainDown', label: 'Main level down', def: 'ArrowDown'},
  {id: 'mainZero', label: 'Main level off', def: '0'},
  {id: 'mainMax', label: 'Main level max', def: 'm'},
  {id: 'rangeUp', label: 'Move stroke range up', def: 'Shift+ArrowRight'},
  {id: 'rangeDown', label: 'Move stroke range down', def: 'Shift+ArrowLeft'},
  {id: 'rangeWiden', label: 'Widen stroke range', def: 'Shift+ArrowUp'},
  {id: 'rangeNarrow', label: 'Narrow stroke range', def: 'Shift+ArrowDown'},
  {id: 'modeManual', label: 'Manual mode', def: 'q'},
  {id: 'modePattern', label: 'Patterns mode', def: 'w'},
  {id: 'modeMusic', label: 'Music mode', def: 'e'},
  {id: 'modeScreen', label: 'Screen share mode', def: 'r'},
  {id: 'nextPattern', label: 'Next pattern', def: 'n'},
  {id: 'strokerMode', label: 'Stroker: switch speed + range / position', def: 'p'},
  {id: 'pass', label: 'Pass my controls', def: ''},
  {id: 'pause', label: 'Pause / resume my toys', def: 'Escape'},
  {id: 'toggleMic', label: 'Mute / unmute my mic (voice chat)', def: 'v'},
  ...CHANNELS.flatMap(c => [
    {id: c.k + 'Up', label: `${c.label} up`, def: ''},
    {id: c.k + 'Down', label: `${c.label} down`, def: ''},
    {id: c.k + 'Link', label: `${c.label}: link / unlink`, def: ''}
  ])
]

export const DEFAULT_STEPS = {main: 5, range: 1, feature: 5}

// "Shift+ArrowRight", "Ctrl+k", "m" ...
export function comboOf(e) {
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return ''
  const k = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toLowerCase() : e.key
  return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.metaKey && 'Meta', e.shiftKey && 'Shift', k].filter(Boolean).join('+')
}

export function prettyCombo(c) {
  if (!c) return '—'
  return c.replace('ArrowRight', '→').replace('ArrowLeft', '←').replace('ArrowUp', '↑').replace('ArrowDown', '↓')
    .split('+').map(p => (p.length === 1 ? p.toUpperCase() : p)).join(' + ')
}

export function loadKeys() {
  let saved = {}
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {} } catch {}
  const binds = {}
  for (const a of ACTIONS) binds[a.id] = typeof saved.binds?.[a.id] === 'string' ? saved.binds[a.id] : a.def
  return {binds, steps: {...DEFAULT_STEPS, ...(saved.steps || {})}, enabled: saved.enabled !== false}
}
export function saveKeys(k) {
  try { localStorage.setItem(KEY, JSON.stringify(k)) } catch {}
}
export function defaultKeys() {
  return {binds: Object.fromEntries(ACTIONS.map(a => [a.id, a.def])), steps: {...DEFAULT_STEPS}, enabled: true}
}
// combo -> action id
export function lookup(keys) {
  const m = new Map()
  for (const [id, c] of Object.entries(keys.binds)) if (c) m.set(c, id)
  return m
}
