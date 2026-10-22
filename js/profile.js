// Local profile: an ID and profile details that live only in this browser.
// No sign-in. People can export the profile to a file and import it on another device.

const KEY = 'tr-profile'

export const GENDERS = [
  'Prefer not to say', 'Woman', 'Man', 'Non-binary', 'Trans woman', 'Trans man',
  'Genderfluid', 'Genderqueer', 'Agender', 'Couple', 'Self-describe'
]
export const ROLES = {both: 'Gives & receives', give: 'Likes to control', receive: 'Likes to be controlled'}
export const AVATARS = ['😈', '💋', '🔥', '🍑', '🍆', '💜', '🦊', '🐺', '🌙', '⭐', '🎧', '🌶️']

const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n)

function newId() {
  return (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36))
}

export function loadProfile() {
  let p = {}
  try { p = JSON.parse(localStorage.getItem(KEY) || '{}') || {} } catch {}
  // carry over the name saved by the first version
  const oldName = (() => { try { return localStorage.getItem('tr-name') } catch { return null } })()
  const prof = {
    uid: p.uid || newId(),
    created: p.created || Date.now(),
    name: clean(p.name || oldName, 24) || 'Guest-' + Math.floor(1000 + Math.random() * 9000),
    gender: GENDERS.includes(p.gender) ? p.gender : 'Prefer not to say',
    genderCustom: clean(p.genderCustom, 24),
    role: ROLES[p.role] ? p.role : 'both',
    avatar: p.avatar || AVATARS[Math.floor(Math.random() * AVATARS.length)],
    color: /^#[0-9a-f]{6}$/i.test(p.color || '') ? p.color : '#ff4f9a',
    about: clean(p.about, 140),
    muted: Array.isArray(p.muted) ? p.muted.slice(0, 200) : [],
    recent: Array.isArray(p.recent) ? p.recent.slice(0, 8) : []
  }
  saveProfile(prof)
  return prof
}

export function saveProfile(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)) } catch {}
}

export function genderLabel(p) {
  if (!p?.gender || p.gender === 'Prefer not to say') return ''
  return p.gender === 'Self-describe' ? clean(p.genderCustom, 24) : p.gender
}

// What other people in a room get to see.
export function publicProfile(p) {
  return {uid: p.uid, gender: p.gender, genderCustom: p.genderCustom, role: p.role, avatar: p.avatar, color: p.color, about: p.about}
}

export function cleanPublicProfile(d = {}) {
  return {
    uid: clean(d.uid, 64),
    gender: GENDERS.includes(d.gender) ? d.gender : 'Prefer not to say',
    genderCustom: clean(d.genderCustom, 24),
    role: ROLES[d.role] ? d.role : 'both',
    avatar: clean(d.avatar, 8) || '🙂',
    color: /^#[0-9a-f]{6}$/i.test(d.color || '') ? d.color : '#ff4f9a',
    about: clean(d.about, 140)
  }
}

export function rememberRoom(p, code, name) {
  p.recent = [{code, name: clean(name, 40), at: Date.now()}, ...p.recent.filter(r => r.code !== code)].slice(0, 8)
  saveProfile(p)
}

export function exportProfile(p) {
  const blob = new Blob([JSON.stringify({type: 'toyrooms-profile', v: 1, profile: p}, null, 2)], {type: 'application/json'})
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `toyrooms-profile-${p.name.replace(/\W+/g, '_')}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export async function importProfile(file) {
  const d = JSON.parse(await file.text())
  if (d?.type !== 'toyrooms-profile' || !d.profile?.uid) throw new Error('Not a Toy Rooms profile file')
  localStorage.setItem(KEY, JSON.stringify(d.profile))
  return loadProfile()
}
