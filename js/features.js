// Toy features ("channels") the controller can drive. Every toy uses the ones it has.
// Intensity channels are 0..1. The stroke range (lo..hi) is 0..1 of each person's own
// allowed stroke length, so nobody's personal limits are ever exceeded.

export const CHANNELS = [
  {k: 'vibrate', short: 'v', label: 'Vibrate', icon: '〰️'},
  {k: 'rotate', short: 'r', label: 'Rotate', icon: '🔄'},
  {k: 'thrust', short: 't', label: 'Thrust / oscillate', icon: '↕️'},
  {k: 'suction', short: 'su', label: 'Suction', icon: '💋'},
  {k: 'pump', short: 'pu', label: 'Pump / constrict', icon: '🎈'},
  {k: 'stroke', short: 'st', label: 'Stroke speed', icon: '🔁'}
]
export const CHANNEL_KEYS = CHANNELS.map(c => c.k)
// Strokers run in one of two modes, chosen by the controller:
//  - speed mode (pm 0): "stroke" is the stroke speed and the toy moves back and forth
//    inside the stroke range on its own.
//  - position mode (pm 1): "pos" (0..1) is where the stroker should be right now,
//    inside the stroke range. Manual, patterns and music then move it directly.
// "range" is not an intensity: it's the stroke window for strokers / depth toys.
export const FEATURE_LABELS = Object.fromEntries([...CHANNELS.map(c => [c.k, c.label]), ['range', 'Stroke range']])

const clamp01 = v => Math.max(0, Math.min(1, +v || 0))

export function zeroOutputs() {
  return {vibrate: 0, rotate: 0, thrust: 0, suction: 0, pump: 0, stroke: 0, lo: 0, hi: 1, pos: 0, pm: 0}
}

// Compact wire format: integers 0..100 with short keys.
export function packOutputs(o) {
  const p = {}
  for (const c of CHANNELS) p[c.short] = Math.round(clamp01(o[c.k]) * 100)
  p.lo = Math.round(clamp01(o.lo) * 100)
  p.hi = Math.round(clamp01(o.hi) * 100)
  if (o.pm) { p.pm = 1; p.p = Math.round(clamp01(o.pos) * 100) }
  return p
}
export function unpackOutputs(p) {
  const o = zeroOutputs()
  if (!p || typeof p !== 'object') return o
  for (const c of CHANNELS) o[c.k] = clamp01((+p[c.short] || 0) / 100)
  o.lo = clamp01((+p.lo || 0) / 100)
  o.hi = clamp01((p.hi == null ? 100 : +p.hi) / 100)
  if (o.hi - o.lo < 0.05) o.hi = Math.min(1, o.lo + 0.05)
  o.pm = p.pm ? 1 : 0
  o.pos = clamp01((+p.p || 0) / 100)
  return o
}
export const peakOf = o => Math.max(...CHANNEL_KEYS.map(k => o[k] || 0))
