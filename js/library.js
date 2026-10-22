// Pattern library: import patterns made on other platforms, record your own, and keep
// them in this browser.
//
// Supported imports:
//  - Funscript (.funscript / JSON with "actions":[{at, pos}]), the open format used by
//    The Handy, XToys, EroScripts and most stroker sites. Converted to stroke speed +
//    stroke range, and to intensity for vibrating toys. The raw positions are kept too,
//    for strokers in position mode.
//  - Lovense pattern text, e.g. "V:1;F:v,r;S:100#" followed by "10,5;12,6;..." values
//    (0-20), which is what Lovense Remote exports and what the Lovense Pattern API uses.
//  - Generic: JSON number arrays, {"data":[...]}, or CSV lines "time_ms,value".
//    Values may be 0-1, 0-20 or 0-100 and are scaled automatically.

import {CHANNEL_KEYS, zeroOutputs} from './features.js'

const KEY = 'tr-patterns'
const STEP = 100 // ms per frame for stored patterns
const MAX_FRAMES = 36000 // frames kept per pattern; long patterns use a coarser step
const MAX_MS = 12 * 3600 * 1000 // longest pattern we import (12 hours)
// 100 ms steps up to one hour, then coarser so a long pattern stays small in storage
const stepFor = endMs => Math.max(STEP, Math.ceil(Math.min(endMs, MAX_MS) / MAX_FRAMES / STEP) * STEP)

const clamp01 = v => Math.max(0, Math.min(1, v))

export function loadLibrary() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
}
export function saveLibrary(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
    return true
  } catch {
    return false // storage full
  }
}

// Stored pattern: {id, name, source, step, frames: {m:[0..100], vibrate?:[], ..., lo?:[], hi?:[]}}
export function patternOutputs(p, ms, speed = 1, strength = 1) {
  const n = p.frames.m.length
  if (!n) return null
  const i = Math.floor((ms * speed) / p.step) % n
  const o = zeroOutputs()
  const m = (p.frames.m[i] / 100) * strength
  for (const k of CHANNEL_KEYS) o[k] = p.frames[k] ? (p.frames[k][i] / 100) * strength : m
  if (p.frames.lo) { o.lo = p.frames.lo[i] / 100; o.hi = p.frames.hi[i] / 100 }
  // the raw stroke position for position mode (funscripts); otherwise the level is used
  o.pos = p.frames.pos ? p.frames.pos[i] / 100 : m
  o.hasPos = !!p.frames.pos
  o.m = m
  o.hasRange = !!p.frames.lo
  return o
}
export const durationOf = p => (p.frames.m.length * p.step) / 1000

// ---------------- parsers ----------------
export function parsePattern(text, filename = '') {
  const t = text.trim()
  if (!t) throw new Error('The file is empty')
  if (t[0] === '{' || t[0] === '[') {
    const j = parseLooseJson(t)
    if (Array.isArray(j?.actions)) return fromFunscript(j)
    // a bare list of funscript actions, e.g. XToys "generic output" exports
    if (Array.isArray(j) && j.length && typeof j[0] === 'object' && j[0] && 'at' in j[0] && 'pos' in j[0]) return fromFunscript({actions: j})
    if (Array.isArray(j) && j.length && typeof j[0] === 'object' && j[0]) return fromSeries(j.map(p => [p.t ?? p.time ?? p.at, p.v ?? p.value ?? p.pos]))
    if (Array.isArray(j)) return fromSeries(j.map((v, i) => [i * STEP, v]))
    const arr = j.data || j.values || j.pattern || j.points
    if (Array.isArray(arr)) {
      if (typeof arr[0] === 'number') return fromSeries(arr.map((v, i) => [i * (j.interval || j.step || STEP), v]))
      return fromSeries(arr.map(p => [p.t ?? p.time ?? p.at, p.v ?? p.value ?? p.pos]))
    }
    throw new Error('Unrecognised JSON pattern')
  }
  if (/^V:\d|;F:|#/.test(t) || /\.(lovense|pattern)$/i.test(filename)) return fromLovense(t)
  if (/^[\d.]+\s*[,;\t]\s*[\d.]+/m.test(t)) {
    return fromSeries(t.split(/\r?\n/).map(l => l.split(/[,;\t]/).map(Number)).filter(r => r.length >= 2 && r.every(Number.isFinite)))
  }
  const nums = t.split(/[\s,;]+/).map(Number).filter(Number.isFinite)
  if (nums.length > 1) return fromSeries(nums.map((v, i) => [i * STEP, v]))
  throw new Error('Could not read this pattern format')
}

// JSON.parse, but also accepts a bare comma-separated list of objects ({..},{..}) and
// trailing commas, which is what several apps put on the clipboard.
function parseLooseJson(t) {
  try { return JSON.parse(t) } catch (first) {
    const body = t.replace(/,\s*([\]}])/g, '$1').replace(/,\s*$/, '')
    for (const attempt of [body, '[' + body + ']']) {
      try { return JSON.parse(attempt) } catch {}
    }
    throw new Error('This looks like JSON but could not be read (' + first.message + ')')
  }
}

function autoScale(values) {
  let max = 0
  for (const v of values) if (v > max) max = v
  const div = max <= 1 ? 1 : max <= 20 ? 20 : 100
  return v => Math.round(clamp01(v / div) * 100)
}

function resample(points, toVal, step) {
  // points: [[ms, value]] sorted; step-hold resample
  const end = Math.min(points[points.length - 1][0], MAX_MS)
  const out = []
  let j = 0
  for (let ms = 0; ms <= end; ms += step) {
    while (j + 1 < points.length && points[j + 1][0] <= ms) j++
    out.push(toVal(points[j][1]))
  }
  return out
}

function fromSeries(rows) {
  const pts = rows.filter(r => Number.isFinite(+r[0]) && Number.isFinite(+r[1])).map(r => [+r[0], +r[1]]).sort((a, b) => a[0] - b[0])
  if (pts.length < 2) throw new Error('Not enough points in the pattern')
  const sc = autoScale(pts.map(p => p[1]))
  const step = stepFor(pts[pts.length - 1][0])
  return {source: 'Imported', step, frames: {m: resample(pts, sc, step)}}
}

function fromLovense(t) {
  const [head, body = ''] = t.includes('#') ? t.split('#') : ['', t]
  const meta = Object.fromEntries(head.split(';').map(s => s.split(':')).filter(p => p.length >= 2).map(([k, ...v]) => [k.trim().toUpperCase(), v.join(':').trim()]))
  const step = Math.max(50, Math.min(5000, +meta.S || STEP))
  const feats = (meta.F || 'v').split(',').map(s => s.trim().toLowerCase())
  const MAP = {v: 'vibrate', r: 'rotate', p: 'pump', t: 'thrust', f: 'thrust', s: 'suction', st: 'stroke'}
  const rows = body.split(/[;\r\n]+/).map(s => s.trim()).filter(Boolean).map(r => r.split(',').map(Number))
  if (!rows.length) throw new Error('No values found in the Lovense pattern')
  const frames = {m: []}
  feats.forEach(f => { if (MAP[f] && !frames[MAP[f]]) frames[MAP[f]] = [] })
  const per = Math.max(1, Math.round(step / STEP))
  for (const r of rows.slice(0, MAX_FRAMES)) {
    const vals = feats.map((_, i) => Math.round(clamp01((r[i] ?? r[0] ?? 0) / 20) * 100))
    for (let k = 0; k < per; k++) {
      frames.m.push(Math.max(...vals))
      feats.forEach((f, i) => { if (MAP[f]) frames[MAP[f]].push(vals[i]) })
    }
  }
  return {source: meta.T ? `Lovense (${meta.T})` : 'Lovense', frames}
}

function fromFunscript(j) {
  const acts = j.actions.filter(a => a && Number.isFinite(+a.at) && Number.isFinite(+a.pos)).map(a => ({at: +a.at, pos: +a.pos})).sort((a, b) => a.at - b.at)
  if (acts.length < 2) throw new Error('This funscript has no movements')
  const inv = !!j.inverted
  const pos = a => Math.max(0, Math.min(100, inv ? 100 - a.pos : a.pos))
  const end = Math.min(acts[acts.length - 1].at, MAX_MS)
  const step = stepFor(end)
  // Slow scripts (moves longer than ~1 s, like XToys "generic output" level curves)
  // describe an intensity over time, not strokes: use the position as the level.
  const gaps = []
  for (let k = 1; k < acts.length; k++) gaps.push(acts[k].at - acts[k - 1].at)
  gaps.sort((a, b) => a - b)
  const levelMode = gaps[Math.floor(gaps.length / 2)] > 1000
  const m = [], lo = [], hi = [], at = []
  let i = 0
  for (let ms = 0; ms <= end; ms += step) {
    while (i + 1 < acts.length && acts[i + 1].at <= ms) i++
    const a = acts[i], b = acts[Math.min(i + 1, acts.length - 1)]
    const dt = Math.max(1, b.at - a.at)
    const f = b.at <= ms ? 1 : Math.max(0, (ms - a.at) / dt)
    const x = Math.round(pos(a) + (pos(b) - pos(a)) * f)
    if (levelMode) { m.push(x); continue }
    at.push(x)
    // speed of the current movement: 100% of the travel in ~250 ms is full speed
    const speed = Math.abs(pos(b) - pos(a)) / dt
    m.push(b.at <= ms ? 0 : Math.round(Math.max(0, Math.min(1, speed / 0.4)) * 100))
    // stroke window: the extremes of the movements around now
    let mn = 100, mx = 0
    for (let k = Math.max(0, i - 2); k <= Math.min(acts.length - 1, i + 3); k++) { mn = Math.min(mn, pos(acts[k])); mx = Math.max(mx, pos(acts[k])) }
    lo.push(Math.round(mn)); hi.push(Math.round(Math.max(mx, mn + 5)))
  }
  if (levelMode) return {source: 'Funscript (levels)', step, frames: {m}}
  return {source: 'Funscript', step, frames: {m, stroke: m, lo, hi, pos: at}}
}

export function makePattern(parsed, name) {
  return {
    id: Math.random().toString(36).slice(2, 10),
    name: String(name || 'Imported pattern').slice(0, 40),
    source: parsed.source,
    step: parsed.step || STEP,
    frames: parsed.frames,
    added: Date.now()
  }
}

// ---------------- recorder ----------------
export class Recorder {
  constructor() { this.frames = null }
  get active() { return !!this.frames }
  start() { this.frames = {m: [], lo: [], hi: [], pos: [], ...Object.fromEntries(CHANNEL_KEYS.map(k => [k, []]))}; this.startedAt = Date.now() }
  // called every control tick (100 ms)
  add(o, m) {
    if (!this.frames || this.frames.m.length >= MAX_FRAMES) return
    this.frames.m.push(Math.round(clamp01(m) * 100))
    for (const k of CHANNEL_KEYS) this.frames[k].push(Math.round(clamp01(o[k]) * 100))
    this.frames.lo.push(Math.round(o.lo * 100)); this.frames.hi.push(Math.round(o.hi * 100))
    this.frames.pos.push(Math.round(clamp01(o.pm ? o.pos : m) * 100))
  }
  stop() {
    const f = this.frames
    this.frames = null
    if (!f || f.m.length < 5) return null
    // drop channels that simply followed the main level, to keep storage small
    for (const k of CHANNEL_KEYS) if (f[k].every((v, i) => v === f.m[i])) delete f[k]
    if (f.lo.every(v => v === 0) && f.hi.every(v => v === 100)) { delete f.lo; delete f.hi }
    if (f.pos.every((v, i) => v === f.m[i])) delete f.pos
    return {source: 'Recorded', frames: f}
  }
}
