/**
 * Card recap poster (CONTRACT C3): the results of one fight night as the same xerox flyer as poster.ts.
 * A bone sheet taped to the toner wall: light lockup, red date snipe, "Results", then one row per bout
 * (label + belt for a title bout, names in corner inks, score, kg, the winner's result stamp, how it
 * ended), a FIGHT OF THE NIGHT stamp on the voted bout, the champion line (the belt holder after that
 * night, omitted when none), the toner call block.
 * 1080x1350 for up to 4 bouts when every row fits at the type floors below (fitRows), else 1080x1920
 * (7 rows max, fewer when they would not fit, then "+N more").
 * Legibility floor (the poster is mostly seen as a ~360px chat preview, a third of the canvas): result
 * stamps >= 32px with light distress, how-it-ended line and footer copy >= 28px on the 1080 canvas.
 * Fun points only, no money words. Same-origin textures only (no photos), so the canvas never taints.
 * Shares through the same Web Share / download + copy fallback as sharePoster.
 */
import type { CardRecap, CardRecapFight } from './types'

export interface RecapFight {
  red: string
  blue: string
  winner: 'red' | 'blue' | null
  method?: string | null
  move?: string | null
  /** [red, blue] points scored */
  score?: [number | null, number | null] | null
  rounds?: number | null
  /** [red, blue] weigh-in kg */
  kg?: [number | null, number | null] | null
  /** title bout (draws the belt plate) */
  title?: boolean
  /** "Main event", "Bout 2" */
  label?: string
  status?: string
  cancelKind?: string | null
  /** this bout won Fight of the Night */
  fotn?: boolean
}

export interface RecapOpts {
  /** YYYY-MM-DD */
  cardDate: string
  fights: RecapFight[]
  /** belt holder at the end of THIS card (get_card_recap, migration 20261103000014), never today's by default */
  champion?: string | null
  /** index into fights of the Fight of the Night (alternative to fights[i].fotn) */
  fightOfNight?: number | null
  url: string
}

const W = 1080
const C = {
  ink: '#0b0b0d', toner: '#1a1917', tonerMute: '#5c5850', bone: '#f4f1ea', bone2: '#b9b4a9',
  red: '#d7192a', blue: '#2a6fdb', blueInk: '#1f5bc4',
}
const DISPLAY = '"Big Shoulders", "Arial Narrow", sans-serif'
const BODY = 'Archivo, system-ui, sans-serif'
const DATA = '"Courier Prime", "Courier New", monospace'
const SX = 44, SY = 70, SW = 992
const X0 = 96, X1 = 984, CW = X1 - X0
const MAX_ROWS = 7
/** Type floors on the 1080 canvas (x1/3 in a 360px chat preview). */
const STAMP_MIN = 32, DETAIL_MIN = 28, KG_MIN = 24, LABEL_MIN = 21, FOTN_MIN = 26
/** Air between a row's last line and the next rule. */
const ROW_PAD = 12
const METHOD: Record<string, string> = { pin: 'Pin', submission: 'Submission', decision: 'Decision' }

const nameFont = (s: number) => `900 ${s}px ${DISPLAY}`

async function ensureFonts() {
  if (typeof document === 'undefined' || !document.fonts) return
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load(`900 120px ${DISPLAY}`), document.fonts.load(`800 48px ${DISPLAY}`),
        document.fonts.load(`700 30px ${BODY}`), document.fonts.load(`400 26px ${BODY}`),
        document.fonts.load(`700 34px ${DATA}`), document.fonts.load(`400 24px ${DATA}`),
      ]),
      new Promise(r => setTimeout(r, 3000)),
    ])
  } catch { /* system fonts */ }
}

function loadImage(src: string, timeoutMs = 8000): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image()
    img.decoding = 'async'
    const t = setTimeout(() => resolve(null), timeoutMs)
    img.onload = () => { clearTimeout(t); resolve(img) }
    img.onerror = () => { clearTimeout(t); resolve(null) }
    img.src = src
  })
}

function prng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

function fitFont(ctx: CanvasRenderingContext2D, text: string, font: (s: number) => string, max: number, min: number, maxW: number): number {
  let size = Math.round(max)
  while (size > min) {
    ctx.font = font(size)
    if (ctx.measureText(text).width <= maxW) break
    size -= 2
  }
  return Math.max(size, Math.round(min))
}

function fitText(ctx: CanvasRenderingContext2D, t: string, maxW: number): string {
  if (ctx.measureText(t).width <= maxW) return t
  let s = t
  while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1)
  return s + '…'
}

/** "SUN 2 NOV" for a YYYY-MM-DD card date (calendar date, no timezone shift). */
export function recapDay(d: string): string {
  const [y, m, day] = d.split('-').map(Number)
  if (!y || !m || !day) return d
  const dt = new Date(Date.UTC(y, m - 1, day, 12))
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })
    .formatToParts(dt).map(x => [x.type, x.value])) as Record<string, string>
  return `${p.weekday} ${p.day} ${p.month}`
}

function kgLabel(v: number | null | undefined): string | null {
  if (v === null || v === undefined) return null
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return null
  return `${Number.isInteger(n) ? n : n.toFixed(1)} kg`
}

function drawWall(ctx: CanvasRenderingContext2D, H: number, toner: HTMLImageElement | null) {
  ctx.fillStyle = C.ink
  ctx.fillRect(0, 0, W, H)
  if (toner) {
    const p = ctx.createPattern(toner, 'repeat')
    if (p) { p.setTransform(new DOMMatrix().scale(1.4)); ctx.fillStyle = p; ctx.fillRect(0, 0, W, H) }
  }
}

function drawSheet(ctx: CanvasRenderingContext2D, H: number, grain: HTMLImageElement | null) {
  const SB = H - 50
  const rnd = prng(2468)
  ctx.save()
  ctx.translate(W / 2, (SY + SB) / 2)
  ctx.rotate((-0.6 * Math.PI) / 180)
  ctx.translate(-W / 2, -(SY + SB) / 2)
  ctx.beginPath()
  ctx.moveTo(SX, SY)
  ctx.lineTo(SX + SW, SY)
  ctx.lineTo(SX + SW, SB - 10)
  for (let x = SX + SW; x > SX; x -= 5 + rnd() * 9) ctx.lineTo(x, SB - 10 + rnd() * 16 + (rnd() > 0.92 ? 8 : 0))
  ctx.lineTo(SX, SB)
  ctx.closePath()
  ctx.clip()
  ctx.fillStyle = C.bone
  ctx.fillRect(0, 0, W, H)
  if (grain) {
    const p = ctx.createPattern(grain, 'repeat')
    if (p) {
      p.setTransform(new DOMMatrix().scale(1.5))
      ctx.globalCompositeOperation = 'multiply'
      ctx.fillStyle = p
      ctx.fillRect(0, 0, W, H)
      ctx.globalCompositeOperation = 'source-over'
    }
  }
  ctx.restore()
}

function drawTape(ctx: CanvasRenderingContext2D, img: HTMLImageElement | null, cx: number, cy: number, w: number, deg: number) {
  if (!img) return
  const h = w * (img.naturalHeight / img.naturalWidth)
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate((deg * Math.PI) / 180)
  ctx.drawImage(img, -w / 2, -h / 2, w, h)
  ctx.restore()
}

function drawSnipe(ctx: CanvasRenderingContext2D, cardDate: string) {
  const txt = recapDay(cardDate).toUpperCase()
  ctx.save()
  ctx.font = `800 44px ${DISPLAY}`
  const w = ctx.measureText(txt).width + 56, h = 70
  ctx.translate(W - 14, 118)
  ctx.rotate((3 * Math.PI) / 180)
  ctx.fillStyle = C.red
  ctx.fillRect(-w, 0, w, h)
  ctx.fillStyle = C.bone
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.fillText(txt, -w + 28, 51)
  ctx.restore()
}

/**
 * A rubber stamp drawn on a scratch canvas and distressed with the stamp mask, then placed rotated.
 * anchor: 'left' | 'right' | 'center' of the stamp box at x; y = vertical centre.
 */
const stampFont = (s: number) => `900 ${s}px ${DISPLAY}`

/** Outer box of a stamp at `size` (before rotation), for layout. */
function stampBox(ctx: CanvasRenderingContext2D, text: string, size: number): { w: number; h: number } {
  ctx.font = stampFont(size)
  ctx.letterSpacing = `${(size * 0.04).toFixed(1)}px`
  const tw = ctx.measureText(text.toUpperCase()).width
  ctx.letterSpacing = '0px'
  return { w: Math.ceil(tw + size * 0.9), h: Math.ceil(size * 1.32) }
}

/** Half the extra height a box of width w gains when rotated by deg. */
const rotExt = (w: number, deg: number) => Math.abs(Math.sin((deg * Math.PI) / 180)) * w / 2

/**
 * A rubber stamp drawn on a scratch canvas and distressed with the stamp mask, then placed rotated.
 * anchor: 'left' | 'right' | 'center' of the stamp box at x; y = vertical centre.
 * min: smallest size a maxW fit may shrink to. distress: 1 = full stamp-mask wear, 0 = clean ink
 * (small stamps read better with less wear).
 */
function drawStamp(ctx: CanvasRenderingContext2D, mask: HTMLImageElement | null, text: string, x: number, y: number,
  o: { size: number; color: string; rot: number; anchor: 'left' | 'right' | 'center'; maxW?: number; min?: number; distress?: number }) {
  const t = text.toUpperCase()
  const pad = 16
  const font = stampFont
  const size = o.maxW ? fitFont(ctx, t, font, o.size, o.min ?? Math.max(14, o.size * 0.6), o.maxW - o.size * 1.1) : o.size
  const { w: sw, h: sh } = stampBox(ctx, t, size)
  const bw = Math.ceil(size * 0.12) + 1
  const off = document.createElement('canvas')
  off.width = sw + pad * 2; off.height = sh + pad * 2
  const g = off.getContext('2d')
  if (!g) return
  const ink = () => {
    g.strokeStyle = o.color; g.lineWidth = bw
    g.beginPath(); g.roundRect(pad + bw / 2, pad + bw / 2, sw - bw, sh - bw, 4); g.stroke()
    g.fillStyle = o.color
    g.font = font(size)
    g.letterSpacing = `${(size * 0.04).toFixed(1)}px`
    g.textAlign = 'center'; g.textBaseline = 'middle'
    g.fillText(t, pad + sw / 2, pad + sh / 2 + size * 0.06)
  }
  ink()
  const distress = Math.max(0, Math.min(1, o.distress ?? 1))
  if (mask && distress > 0) {
    const p = g.createPattern(mask, 'repeat')
    if (p) {
      p.setTransform(new DOMMatrix().scale(1.6)); g.globalCompositeOperation = 'destination-in'; g.fillStyle = p; g.fillRect(0, 0, off.width, off.height)
      // lighter wear: re-ink the worn spots at (1 - distress) under the masked stamp
      if (distress < 1) { g.globalCompositeOperation = 'destination-over'; g.globalAlpha = 1 - distress; ink(); g.globalAlpha = 1 }
      g.globalCompositeOperation = 'source-over'
    }
  }
  const cx = o.anchor === 'left' ? x + sw / 2 : o.anchor === 'right' ? x - sw / 2 : x
  ctx.save()
  ctx.translate(cx, y)
  ctx.rotate((o.rot * Math.PI) / 180)
  ctx.drawImage(off, -off.width / 2, -off.height / 2)
  ctx.restore()
}

/** One name inside `maxW`: one line down to `min`, else two balanced lines, else ellipsis. */
function layName(ctx: CanvasRenderingContext2D, name: string, maxW: number, cap: number, min: number, twoCap: number): { lines: string[]; size: number } {
  const text = name.toUpperCase().trim() || 'FIGHTER'
  const one = fitFont(ctx, text, nameFont, cap, min, maxW)
  ctx.font = nameFont(one)
  const fitsOne = ctx.measureText(text).width <= maxW
  if (fitsOne && one >= cap * 0.72) return { lines: [text], size: one }
  const words = text.split(/\s+/)
  let best: { lines: string[]; size: number } | null = null
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ')
    const s = Math.min(fitFont(ctx, a, nameFont, twoCap, min * 0.85, maxW), fitFont(ctx, b, nameFont, twoCap, min * 0.85, maxW))
    ctx.font = nameFont(s)
    if (ctx.measureText(a).width > maxW || ctx.measureText(b).width > maxW) continue
    if (!best || s > best.size) best = { lines: [a, b], size: s }
  }
  if (fitsOne && (!best || one >= best.size * 1.05)) return { lines: [text], size: one }
  if (best) return best
  ctx.font = nameFont(min)
  return { lines: [fitText(ctx, text, maxW)], size: min }
}

/** Draws one bout row; returns how tall its content ran (rule to the how-it-ended descenders). */
function drawRow(ctx: CanvasRenderingContext2D, f: RecapFight, fotn: boolean, y: number, s: number,
  belt: HTMLImageElement | null, mask: HTMLImageElement | null): number {
  // section rule on paper
  ctx.fillStyle = C.toner
  ctx.fillRect(X0, y, CW, 3)

  // label line: MAIN EVENT / BOUT n, belt + TITLE FIGHT
  const labelSize = Math.round(Math.max(LABEL_MIN, 20 * s))
  const labelY = y + Math.max(labelSize + 12, 36 * s)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.font = `700 ${labelSize}px ${BODY}`
  ctx.letterSpacing = '1.5px'
  ctx.fillStyle = C.tonerMute
  const label = (f.label || 'Bout').toUpperCase()
  ctx.fillText(label, X0, labelY)
  let lx = X0 + ctx.measureText(label).width + 18 * s
  if (f.title) {
    const bs = Math.round(34 * s)
    if (belt) ctx.drawImage(belt, lx, labelY - bs * 0.72, bs, bs)
    lx += bs + 6 * s
    ctx.fillStyle = C.toner
    ctx.fillText('TITLE FIGHT', lx, labelY)
  }
  ctx.letterSpacing = '0px'
  if (fotn) drawStamp(ctx, mask, 'Fight of the Night', X1, labelY - labelSize * 0.36, { size: Math.round(Math.max(FOTN_MIN, 24 * s)), color: C.red, rot: 2, anchor: 'right', distress: 0.55 })

  const settled = f.status !== 'cancelled' && (f.winner === 'red' || f.winner === 'blue')
  const cancelled = f.status === 'cancelled'

  // centre: score (corner-ink digits, toner en dash) or "vs"
  const [rs, bsc] = f.score ?? [null, null]
  const hasScore = settled && rs != null && bsc != null
  const scoreSize = Math.round(70 * s)
  const namesTop = labelY + 14 * s
  const capLine = namesTop + scoreSize * 0.74
  let centerW: number
  if (hasScore) {
    ctx.font = nameFont(scoreSize)
    const a = String(rs), b = String(bsc)
    const wa = ctx.measureText(a).width, wb = ctx.measureText(b).width
    ctx.font = nameFont(Math.round(scoreSize * 0.6))
    const wd = ctx.measureText('–').width + 10 * s
    centerW = wa + wd + wb
    let x = W / 2 - centerW / 2
    ctx.font = nameFont(scoreSize); ctx.fillStyle = C.red; ctx.fillText(a, x, capLine); x += wa + 5 * s
    ctx.font = nameFont(Math.round(scoreSize * 0.6)); ctx.fillStyle = C.toner; ctx.fillText('–', x, capLine - scoreSize * 0.14); x += wd - 5 * s
    ctx.font = nameFont(scoreSize); ctx.fillStyle = C.blueInk; ctx.fillText(b, x, capLine)
  } else {
    ctx.font = `800 ${Math.round(34 * s)}px ${DISPLAY}`
    ctx.fillStyle = C.tonerMute
    ctx.textAlign = 'center'
    ctx.fillText('VS', W / 2, capLine - 6 * s)
    ctx.textAlign = 'left'
    centerW = ctx.measureText('VS').width
  }

  // names in corner inks, same size both sides (one row, one voice)
  const colW = (CW - centerW) / 2 - 22 * s
  const cap = 56 * s, min = 30 * s, twoCap = 36 * s
  let r = layName(ctx, f.red, colW, cap, min, twoCap)
  let b = layName(ctx, f.blue, colW, cap, min, twoCap)
  const size = Math.min(r.size, b.size)
  r = { ...r, size }; b = { ...b, size }
  const lines = Math.max(r.lines.length, b.lines.length)
  const nameCap = size * 0.74, lineH = size * 0.92
  const nameBase = lines === 1 ? capLine : namesTop + nameCap
  ctx.letterSpacing = '-0.5px'
  ctx.font = nameFont(size)
  ctx.fillStyle = C.red
  ctx.textAlign = 'left'
  r.lines.forEach((l, i) => ctx.fillText(l, X0, nameBase + i * lineH))
  ctx.fillStyle = C.blueInk
  ctx.textAlign = 'right'
  b.lines.forEach((l, i) => ctx.fillText(l, X1, nameBase + i * lineH))
  ctx.letterSpacing = '0px'
  const namesBottom = nameBase + (lines - 1) * lineH

  // kg (Courier) + the winner's result stamp beside it, placed from the real stamp height so it clears
  // the names above and the how-it-ended line below at any row height
  const bottom = Math.max(namesBottom, capLine)
  const stampSize = Math.round(Math.max(STAMP_MIN, 28 * s))
  const kgSize = Math.round(Math.max(KG_MIN, 24 * s))
  const detailSize = Math.round(Math.max(DETAIL_MIN, 26 * s))
  const gap = Math.max(6, 8 * s)
  const [rk, bk] = f.kg ?? [null, null]
  const rkg = kgLabel(rk), bkg = kgLabel(bk)
  ctx.font = `700 ${kgSize}px ${DATA}`
  const rkW = rkg ? ctx.measureText(rkg).width : 0
  const bkW = bkg ? ctx.measureText(bkg).width : 0

  let stamp: { txt: string; x: number; color: string; rot: number; anchor: 'left' | 'right' | 'center'; maxW?: number } | null = null
  if (settled) {
    const red = f.winner === 'red'
    const own = red ? rkW : bkW, other = red ? bkW : rkW
    // from the winner's kg to just short of the loser's kg (the kg line has nothing under the score)
    const maxW = CW - (own ? own + 16 * s : 0) - (other ? other + 32 * s : 0)
    let txt = f.method ? `Win by ${(METHOD[f.method] ?? f.method).toLowerCase()}` : 'Winner'
    if (stampBox(ctx, txt, STAMP_MIN).w > maxW) txt = 'Winner'
    stamp = red
      ? { txt, x: X0 + (own ? own + 16 * s : 0), color: C.red, rot: -2, anchor: 'left', maxW }
      : { txt, x: X1 - (own ? own + 16 * s : 0), color: C.blueInk, rot: 2, anchor: 'right', maxW }
  } else if (cancelled) {
    stamp = { txt: f.cancelKind === 'no_contest' ? 'No contest' : 'Called off', x: W / 2, color: C.toner, rot: -1.5, anchor: 'center' }
  }
  const box = stamp ? stampBox(ctx, stamp.txt, stampSize) : { w: 0, h: kgSize }
  const half = box.h / 2 + (stamp ? rotExt(box.w, stamp.rot) : 0)
  const stampY = bottom + gap + half
  const kgY = stampY + kgSize * 0.34

  ctx.font = `700 ${kgSize}px ${DATA}`
  ctx.fillStyle = C.toner
  ctx.textAlign = 'left'
  if (rkg) ctx.fillText(rkg, X0, kgY)
  ctx.textAlign = 'right'
  if (bkg) ctx.fillText(bkg, X1, kgY)
  ctx.textAlign = 'left'
  if (stamp) drawStamp(ctx, mask, stamp.txt, stamp.x, stampY, {
    size: stampSize, color: stamp.color, rot: stamp.rot, anchor: stamp.anchor, maxW: stamp.maxW, min: STAMP_MIN, distress: 0.45,
  })

  // how it ended: finish move + rounds (sentence case, one middle dot at most)
  const parts: string[] = []
  if (settled) {
    const mv = f.move?.trim()
    if (mv) parts.push(mv[0].toUpperCase() + mv.slice(1).toLowerCase())
    if (f.rounds != null) parts.push(`${f.rounds} round${f.rounds === 1 ? '' : 's'}`)
  } else if (cancelled) parts.push('No record change')
  const detailY = stampY + half + gap + detailSize * 0.62
  if (parts.length) {
    ctx.font = `400 ${detailSize}px ${DATA}`
    ctx.fillStyle = C.toner
    ctx.textAlign = 'center'
    ctx.fillText(fitText(ctx, parts.join(' · '), CW), W / 2, detailY)
    ctx.textAlign = 'left'
  }
  return (parts.length ? detailY + detailSize * 0.22 : stampY + half) - y
}

const S_MIN = 0.8, S_MAX = 1.5
const rowScale = (RH: number) => Math.max(S_MIN, Math.min(S_MAX, RH / 206))

/**
 * How many rows fit `avail` (<= cap) and at what scale: rows are laid out on a scratch canvas and the
 * scale steps down until the tallest one (two-line names run taller) leaves ROW_PAD before the next rule.
 * Only when even S_MIN can't fit (the type floors don't shrink) does it drop a row to "+N more".
 */
function fitRows(rows: { f: RecapFight; fotn: boolean }[], avail: number, cap: number,
  mask: HTMLImageElement | null): { n: number; s: number; RH: number; fits: boolean } {
  const scratch = document.createElement('canvas').getContext('2d')
  let n = Math.max(1, Math.min(cap, rows.length))
  if (!scratch) return { n, s: rowScale(avail / n), RH: Math.min(300, avail / n), fits: true }
  for (; ; n--) {
    const RH = Math.min(300, avail / n)
    const top = rowScale(RH)
    const steps = Math.ceil((top - S_MIN) / 0.04)
    for (let k = 0; k <= steps; k++) {
      const s = Math.max(S_MIN, top - k * 0.04)
      const need = Math.max(...rows.slice(0, n).map(r => drawRow(scratch, r.f, r.fotn, 0, s, null, mask)))
      if (need + ROW_PAD <= RH) return { n, s, RH, fits: true }
    }
    if (n === 1) return { n, s: S_MIN, RH, fits: false }
  }
}

function drawChampion(ctx: CanvasRenderingContext2D, name: string, y: number, belt: HTMLImageElement | null) {
  const bs = 64
  ctx.fillStyle = C.toner
  ctx.fillRect(X0, y - 46, CW, 3)
  if (belt) ctx.drawImage(belt, X0, y - bs / 2 + 4, bs, bs)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.font = `700 26px ${BODY}`
  ctx.letterSpacing = '1.5px'
  ctx.fillStyle = C.tonerMute
  const lab = 'CHAMPION'
  const lx = X0 + bs + 16
  ctx.fillText(lab, lx, y + 14)
  const lw = ctx.measureText(lab).width
  ctx.letterSpacing = '0px'
  const nx = lx + lw + 18
  const t = name.toUpperCase()
  const size = fitFont(ctx, t, s => `900 ${s}px ${DISPLAY}`, 52, 28, X1 - nx)
  ctx.font = `900 ${size}px ${DISPLAY}`
  ctx.fillStyle = C.toner
  ctx.fillText(fitText(ctx, t, X1 - nx), nx, y + 20)
}

function drawFooter(ctx: CanvasRenderingContext2D, by: number, url: string, more: number) {
  const host = url.replace(/^https?:\/\//, '').replace(/\/$/, '')
  const bh = 132
  ctx.fillStyle = C.toner
  ctx.fillRect(X0, by, CW, bh)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = C.bone
  ctx.font = `900 64px ${DISPLAY}`
  ctx.fillText('THAT’S THE CARD.', X0 + 28, by + 70)
  // the link gets the full line under the headline: beside it there was only room for ~19 Courier
  // characters at 28px, which cut dormschampion.pages.dev
  ctx.font = `700 28px ${BODY}`
  const lead = 'Every result at '
  ctx.fillText(lead, X0 + 28, by + 112)
  const lw = ctx.measureText(lead).width
  ctx.fillStyle = C.bone2
  ctx.font = `700 28px ${DATA}`
  ctx.fillText(fitText(ctx, host, CW - 56 - lw), X0 + 28 + lw, by + 112)
  ctx.fillStyle = C.tonerMute
  ctx.font = `400 28px ${BODY}`
  ctx.fillText('Members only. Fun points only.', X0, by + bh + 46)
  if (more > 0) {
    ctx.textAlign = 'right'
    ctx.font = `700 28px ${DATA}`
    ctx.fillText(`+${more} more bout${more === 1 ? '' : 's'} in the app`, X1, by + bh + 46)
    ctx.textAlign = 'left'
  }
}

/** Main event first (the headliner), then the rest in bout order. */
function order(opts: RecapOpts): { f: RecapFight; fotn: boolean }[] {
  const list = opts.fights.map((f, i) => ({ f, fotn: !!f.fotn || opts.fightOfNight === i, i }))
  const main = (f: RecapFight) => (f.label ?? '').toLowerCase() === 'main event'
  return list.sort((a, b) => Number(main(b.f)) - Number(main(a.f)) || a.i - b.i)
}

export async function renderRecap(opts: RecapOpts): Promise<Blob> {
  const rows = order(opts)
  const champ = opts.champion?.trim()
  const rowsTop = 300
  // rows area for a canvas height: header above 300, champion line + toner footer below
  const availFor = (h: number) => (h - 262 - (champ ? 118 : 34)) - rowsTop
  const [toner, grain, tapeA, tapeB, mask, lockup, belt] = await Promise.all([
    loadImage('/textures/toner-dark.png'), loadImage('/textures/paper-grain.png'),
    loadImage('/textures/tape-a.png'), loadImage('/textures/tape-b.png'),
    loadImage('/textures/stamp-mask.png'), loadImage('/brand/lockup-light.svg'), loadImage('/brand/belt.svg'),
    ensureFonts(),
  ])
  // measured after the fonts load: names that wrap to two lines need a taller row
  const short = rows.length <= 4 ? fitRows(rows, availFor(1350), 4, mask) : null
  const H = short && short.fits && short.n === rows.length ? 1350 : 1920
  const fit = H === 1350 && short ? short : fitRows(rows, availFor(1920), MAX_ROWS, mask)
  const shown = rows.slice(0, fit.n)
  const more = rows.length - shown.length
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not supported on this device')

  drawWall(ctx, H, toner)
  drawSheet(ctx, H, grain)
  if (lockup) ctx.drawImage(lockup, X0, 108, Math.round(150 * 755 / 308), 150)
  drawSnipe(ctx, opts.cardDate)
  // headline under the snipe
  ctx.textAlign = 'right'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = C.toner
  ctx.font = `900 84px ${DISPLAY}`
  ctx.fillText('RESULTS', X1, 268)
  ctx.textAlign = 'left'

  const by = H - 262
  const avail = availFor(H)
  const RH = fit.RH
  const start = rowsTop + Math.max(0, (avail - RH * shown.length) / 2.4)
  shown.forEach((r, i) => drawRow(ctx, r.f, r.fotn, start + i * RH, fit.s, belt, mask))
  if (champ) drawChampion(ctx, champ, by - 56, belt)
  drawFooter(ctx, by, opts.url, more)
  drawTape(ctx, tapeA, SX + 40, SY + 6, 300, -24)
  drawTape(ctx, tapeB, SX + SW - 30, SY + 14, 240, 21)

  return new Promise((resolve, reject) => {
    try { canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not create the recap image'))), 'image/png') } catch (e) { reject(e) }
  })
}

const nick = (n: string | null | undefined) => n?.trim() || 'Fighter'

/** get_card_recap() → renderRecap options. Only settled and called-off bouts are drawn. */
export function recapOptsFrom(recap: CardRecap, url: string): RecapOpts {
  const label = (f: CardRecapFight) => (f.is_main_event ? 'Main event' : `Bout ${f.bout_order}`)
  const fights = recap.fights.filter(f => f.status === 'settled' || f.status === 'cancelled')
  return {
    cardDate: recap.card_date,
    url,
    champion: recap.champion?.nickname ?? null,   // holder after THAT card, not today's
    fights: fights.map(f => ({
      red: nick(f.red.nickname), blue: nick(f.blue.nickname),
      winner: f.status === 'settled' ? f.winner_side : null,
      method: f.method, move: f.finish_move, rounds: f.rounds,
      score: [f.red.score, f.blue.score], kg: [f.red.kg, f.blue.kg],
      title: f.is_title_fight, label: label(f), status: f.status, cancelKind: f.cancel_kind,
      fotn: f.is_fotn || (!!recap.fotn.winner_fight_id && recap.fotn.winner_fight_id === f.fight_id),
    })),
  }
}

function shareText(o: RecapOpts): string {
  const day = recapDay(o.cardDate)
  const n = o.fights.filter(f => f.status !== 'cancelled').length
  const fotn = o.fights.find((f, i) => f.fotn || o.fightOfNight === i)
  return `Fight night results, ${day}: ${n} bout${n === 1 ? '' : 's'} in the books.`
    + (fotn ? ` Fight of the Night: ${fotn.red} vs ${fotn.blue}.` : '')
    + ' See every result on UoS Fight Night (fun points only).'
}

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text; ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch { return false }
  }
}

/**
 * Renders the recap and shares it (Web Share with the PNG), else downloads it and copies the text + link.
 * Resolves 'shared' | 'downloaded' | 'cancelled' so the caller can confirm the fallback with a toast.
 */
export async function shareRecap(opts: RecapOpts): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const blob = await renderRecap(opts)
  const file = new File([blob], `uos-fight-night-results-${opts.cardDate}.png`, { type: 'image/png' })
  const text = shareText(opts)
  const title = `Results, ${recapDay(opts.cardDate)}`
  if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title, text: `${text} ${opts.url}`, url: opts.url })
      return 'shared'
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') return 'cancelled'
    }
  }
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href; a.download = file.name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 10_000)
  await copyText(`${text} ${opts.url}`)
  return 'downloaded'
}
