// Pattern sources for the "Browse patterns" window. Each source lists patterns that can
// be saved into the local library (library.js parses them).
//
// Source types (configured in config.js -> patternSources):
//   catalog: a static JSON file {patterns: [{id, name, description, author, format, tags, url}]}
//            where url is relative to the catalog file. Works anywhere, no key needed.
//   api:     any HTTPS endpoint that answers  GET <url>?q=<search>&page=<n>  with the same
//            {patterns: [...]} shape (each item has `url` or inline `content`). Optional
//            `apiKey` is sent as "Authorization: Bearer <key>". This is the slot for XToys
//            or Lovense pattern access: a small proxy holding your developer key talks to the
//            provider and answers in this shape (see README).

import {CONFIG} from './config.js'

export function sources() {
  return (CONFIG.patternSources || []).map(s => ({...s, ready: s.enabled !== false && !!s.url}))
}

// Patterns brought over from an embedded site arrive as text (dropped file, paste or
// clipboard). Pull the pattern out of whatever was copied: raw pattern data, a JSON
// blob with the pattern nested inside, or a data: link.
export function extractPatternText(text) {
  const t = String(text || '').trim()
  if (t.startsWith('data:')) {
    const [, meta, body] = t.match(/^data:([^,]*),(.*)$/s) || []
    if (body != null) return meta.includes('base64') ? atob(body) : decodeURIComponent(body)
  }
  if (/^https?:\/\//.test(t) && !/\s/.test(t)) {
    throw new Error('That is a link to the pattern page. Websites can\'t read each other\'s pages, so download or copy the pattern itself instead.')
  }
  if (t.startsWith('{')) {
    try {
      const j = JSON.parse(t)
      // look one or two levels down for something pattern-shaped
      const looks = v => v && typeof v === 'object' && (Array.isArray(v.actions) || Array.isArray(v.data) || Array.isArray(v.points) || Array.isArray(v.pattern) || Array.isArray(v.values))
      if (looks(j)) return t
      for (const v of Object.values(j)) {
        if (looks(v)) return JSON.stringify(v)
        if (v && typeof v === 'object') for (const w of Object.values(v)) if (looks(w)) return JSON.stringify(w)
      }
    } catch {}
  }
  return t
}

const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n)

function normalise(list, base) {
  return (Array.isArray(list) ? list : []).slice(0, 500).map((p, i) => ({
    id: clean(p.id ?? i, 80),
    name: clean(p.name, 60) || 'Untitled pattern',
    description: clean(p.description, 160),
    author: clean(p.author, 40),
    format: clean(p.format, 20),
    tags: Array.isArray(p.tags) ? p.tags.slice(0, 6).map(t => clean(t, 20)) : [],
    url: p.url ? new URL(p.url, base).href : null,
    content: typeof p.content === 'string' ? p.content : (p.content ? JSON.stringify(p.content) : null)
  }))
}

export async function listPatterns(src, query = '', page = 1) {
  if (!src.ready) throw new Error(src.setupHint || 'This source is not set up yet. See README.')
  if (src.type === 'catalog') {
    const url = new URL(src.url, location.href)
    const r = await fetch(url)
    if (!r.ok) throw new Error('Could not load catalog (HTTP ' + r.status + ')')
    const all = normalise((await r.json()).patterns, url)
    const q = query.trim().toLowerCase()
    return q ? all.filter(p => (p.name + ' ' + p.description + ' ' + p.tags.join(' ') + ' ' + p.author).toLowerCase().includes(q)) : all
  }
  const url = new URL(src.url, location.href)
  if (query) url.searchParams.set('q', query)
  url.searchParams.set('page', page)
  const r = await fetch(url, {headers: src.apiKey ? {Authorization: 'Bearer ' + src.apiKey} : {}})
  if (r.status === 401 || r.status === 403) throw new Error('The key for this source was refused')
  if (!r.ok) throw new Error('Source answered HTTP ' + r.status)
  return normalise((await r.json()).patterns, url)
}

export async function downloadPattern(src, p) {
  if (p.content) return p.content
  if (!p.url) throw new Error('This pattern has no file')
  const r = await fetch(p.url, {headers: src.type === 'api' && src.apiKey ? {Authorization: 'Bearer ' + src.apiKey} : {}})
  if (!r.ok) throw new Error('Download failed (HTTP ' + r.status + ')')
  return r.text()
}
