// Built-in patterns. Each maps time in seconds (already scaled by speed) to a level 0..1.

const TAU = Math.PI * 2
const frac = x => x - Math.floor(x)

export const PATTERNS = {
  pulse:     {label: 'Pulse',      fn: t => (frac(t) < 0.5 ? 1 : 0.15)},
  wave:      {label: 'Wave',       fn: t => 0.5 + 0.5 * Math.sin(t * TAU / 2)},
  ramp:      {label: 'Ramp up',    fn: t => frac(t / 6)},
  heartbeat: {label: 'Heartbeat',  fn: t => { const p = frac(t / 1.2); return p < 0.1 ? 1 : p < 0.2 ? 0.25 : p < 0.3 ? 0.85 : 0.1 }},
  tease:     {label: 'Tease',      fn: t => { const p = frac(t / 8); return p < 0.7 ? 0.2 + 0.25 * Math.sin(p * TAU * 6) ** 2 : 1 }},
  stairs:    {label: 'Stairs',     fn: t => Math.floor(frac(t / 10) * 5) / 4},
  quake:     {label: 'Earthquake', fn: t => Math.min(1, 0.6 + 0.4 * Math.sin(t * 23) * Math.sin(t * 7.3))},
  random:    {label: 'Surprise',   fn: t => { const k = Math.floor(t * 1.5); return frac(Math.sin(k * 12.9898) * 43758.5453) }}
}

export function patternLevel(name, seconds, speed = 1) {
  const p = PATTERNS[name]
  return p ? Math.max(0, Math.min(1, p.fn(seconds * speed))) : 0
}
