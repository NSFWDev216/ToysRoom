// Drag-friendly controls built on pointer events, so they behave the same with a mouse,
// a finger or a pen: press anywhere on the track and drag, the control follows smoothly.
//
//   new Fader({value, vertical, label, onInput})  -> .el, .value, .set(v, emit)
//   new RangeBar({lo, hi, minGap, onInput})        -> .el, .lo, .hi, .set(lo, hi, emit), .shift(d), .resize(d)

const clamp01 = v => Math.max(0, Math.min(1, v))
const round = v => Math.round(v * 100) / 100

function track(el, onDown, onMove, onUp) {
  el.addEventListener('pointerdown', e => {
    if (e.button > 0) return
    e.preventDefault()
    el.setPointerCapture(e.pointerId)
    el.classList.add('dragging')
    onDown(e)
    const move = ev => onMove(ev)
    const up = ev => {
      el.classList.remove('dragging')
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      onUp?.(ev)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  })
}

export class Fader {
  constructor({value = 0, vertical = true, label = '', onInput = () => {}, className = ''}) {
    this.vertical = vertical
    this.onInput = onInput
    this.value = clamp01(value)
    this.el = document.createElement('div')
    this.el.className = `fader ${vertical ? 'v' : 'h'} ${className}`
    this.el.tabIndex = 0
    this.el.setAttribute('role', 'slider')
    this.el.setAttribute('aria-label', label)
    this.el.setAttribute('aria-orientation', vertical ? 'vertical' : 'horizontal')
    this.el.innerHTML = '<div class="f-track"><div class="f-fill"></div></div><div class="f-thumb"></div>'
    this.fill = this.el.querySelector('.f-fill')
    this.thumb = this.el.querySelector('.f-thumb')
    const fromEvent = e => {
      const r = this.el.getBoundingClientRect()
      const pad = vertical ? this.thumb.offsetHeight / 2 : this.thumb.offsetWidth / 2
      return vertical
        ? 1 - (e.clientY - r.top - pad) / Math.max(1, r.height - pad * 2)
        : (e.clientX - r.left - pad) / Math.max(1, r.width - pad * 2)
    }
    track(this.el, e => { this.el.focus({preventScroll: true}); this.set(fromEvent(e), true) }, e => this.set(fromEvent(e), true))
    this.el.addEventListener('keydown', e => {
      const step = e.shiftKey ? 0.1 : 0.01
      const map = {ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step, PageUp: 0.1, PageDown: -0.1}
      if (e.key in map) { this.set(this.value + map[e.key], true); e.preventDefault(); e.stopPropagation() }
      else if (e.key === 'Home') { this.set(0, true); e.preventDefault() }
      else if (e.key === 'End') { this.set(1, true); e.preventDefault() }
    })
    this.render()
  }
  set(v, emit) {
    const nv = round(clamp01(v))
    if (nv === this.value && !emit) return
    const changed = nv !== this.value
    this.value = nv
    this.render()
    if (emit && changed) this.onInput(nv)
  }
  render() {
    const p = this.value * 100
    if (this.vertical) {
      this.fill.style.height = p + '%'
      this.thumb.style.bottom = `calc(${p}% - ${p / 100} * var(--thumb))`
    } else {
      this.fill.style.width = p + '%'
      this.thumb.style.left = `calc(${p}% - ${p / 100} * var(--thumb))`
    }
    this.el.setAttribute('aria-valuenow', Math.round(p))
    this.el.setAttribute('aria-valuetext', Math.round(p) + '%')
  }
  set disabled(d) { this.el.classList.toggle('disabled', d) }
}

// A stroke-range bar: drag the bottom handle, the top handle, or the window between them.
export class RangeBar {
  constructor({lo = 0, hi = 1, minGap = 0.05, onInput = () => {}}) {
    this.lo = lo; this.hi = hi; this.minGap = minGap; this.onInput = onInput
    this.el = document.createElement('div')
    this.el.className = 'rangebar'
    this.el.tabIndex = 0
    this.el.setAttribute('role', 'group')
    this.el.setAttribute('aria-label', 'Stroke range')
    this.el.innerHTML = `
      <div class="r-track"></div>
      <div class="r-win"><span class="r-grip">⟷</span></div>
      <div class="r-h lo" aria-label="Bottom"></div>
      <div class="r-h hi" aria-label="Top"></div>
      <div class="r-ticks">${'<i></i>'.repeat(9)}</div>`
    this.win = this.el.querySelector('.r-win')
    this.hLo = this.el.querySelector('.r-h.lo')
    this.hHi = this.el.querySelector('.r-h.hi')
    let mode = null, startX = 0, start = null
    const pos = e => { const r = this.el.getBoundingClientRect(); return clamp01((e.clientX - r.left) / r.width) }
    track(this.el, e => {
      this.el.focus({preventScroll: true})
      const x = pos(e)
      const w = this.el.getBoundingClientRect().width
      const grab = 26 / w // handles are easy to hit: ~26px either side
      const dLo = Math.abs(x - this.lo), dHi = Math.abs(x - this.hi)
      if (Math.min(dLo, dHi) <= grab) mode = dLo < dHi || (dLo === dHi && x < this.lo) ? 'lo' : 'hi'
      else if (x > this.lo && x < this.hi) mode = 'win'
      else mode = x < this.lo ? 'lo' : 'hi'
      startX = x; start = {lo: this.lo, hi: this.hi}
      this.el.dataset.drag = mode
      if (mode !== 'win') this.dragTo(mode, x)
    }, e => {
      const x = pos(e)
      if (mode === 'win') {
        const width = start.hi - start.lo
        const lo = Math.max(0, Math.min(1 - width, start.lo + (x - startX)))
        this.set(lo, lo + width, true)
      } else this.dragTo(mode, x)
    }, () => { delete this.el.dataset.drag })
    this.el.addEventListener('keydown', e => {
      const step = 0.01
      const k = e.key
      if (k === 'ArrowRight' || k === 'ArrowUp') { e.shiftKey ? this.resize(step) : this.shift(step) } else if (k === 'ArrowLeft' || k === 'ArrowDown') { e.shiftKey ? this.resize(-step) : this.shift(-step) } else return
      e.preventDefault(); e.stopPropagation()
    })
    this.render()
  }
  dragTo(which, x) {
    if (which === 'lo') this.set(Math.min(x, this.hi - this.minGap), this.hi, true)
    else this.set(this.lo, Math.max(x, this.lo + this.minGap), true)
  }
  set(lo, hi, emit) {
    lo = round(clamp01(lo)); hi = round(clamp01(hi))
    if (hi - lo < this.minGap - 1e-9) return
    const changed = lo !== this.lo || hi !== this.hi
    this.lo = lo; this.hi = hi
    this.render()
    if (emit && changed) this.onInput(lo, hi)
  }
  // move the whole window, keeping its size (25–50% -> 26–51%)
  shift(d) {
    const w = this.hi - this.lo
    const lo = Math.max(0, Math.min(1 - w, this.lo + d))
    this.set(lo, lo + w, true)
  }
  // grow/shrink the window around its centre
  resize(d) {
    const lo = Math.max(0, this.lo - d / 2), hi = Math.min(1, this.hi + d / 2)
    if (hi - lo >= this.minGap) this.set(lo, hi, true)
  }
  render() {
    this.win.style.left = this.lo * 100 + '%'
    this.win.style.width = (this.hi - this.lo) * 100 + '%'
    this.hLo.style.left = this.lo * 100 + '%'
    this.hHi.style.left = this.hi * 100 + '%'
    this.el.setAttribute('aria-valuetext', `${Math.round(this.lo * 100)} to ${Math.round(this.hi * 100)}%`)
  }
}
