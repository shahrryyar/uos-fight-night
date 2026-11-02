/**
 * Share poster: 1080x1350 xerox fight flyer (DESIGN.md "Underground fight flyer").
 * A bone paper sheet taped to the toner wall: lockup, red date snipe, halftone corner photos with
 * corner bands, a red VS rubber stamp at the seam, names in corner inks, kg in Courier, the mat
 * divider (red line | ring | blue line), then the call to action. Fun points only, no money words.
 * No external deps. Same-origin textures from /textures and /brand. Photos are halftoned on a
 * scratch canvas; if a photo blocks CORS it is skipped (initials), so the poster canvas never taints.
 */
import { halftoneCanvas, TONER_RGB } from './halftone'

export interface PosterOpts {
  title?: string | null
  redName: string
  blueName: string
  redPhotoUrl?: string | null
  bluePhotoUrl?: string | null
  /** ISO timestamp (or any Date-parsable string) of the fight */
  when: string
  url: string
  /** Optional weight snapshot (kg) drawn under each name. Omit/null to hide. */
  redKg?: number | null
  blueKg?: number | null
}

/** 72.5 -> "72.5 kg", 70 -> "70 kg"; null/invalid -> null. */
function kgLabel(v: number | null | undefined): string | null {
  if (v === null || v === undefined) return null
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return null
  return `${Number.isInteger(n) ? n : n.toFixed(1)} kg`
}

const W = 1080
const H = 1350
const C = {
  ink: '#0b0b0d',
  toner: '#1a1917',
  tonerMute: '#5c5850',
  bone: '#f4f1ea',
  bone2: '#b9b4a9',
  red: '#d7192a',
  blue: '#2a6fdb',
  blueInk: '#1f5bc4',
}
const DISPLAY = '"Big Shoulders", "Arial Narrow", sans-serif'
const BODY = 'Archivo, system-ui, sans-serif'
const DATA = '"Courier Prime", "Courier New", monospace'

// sheet geometry (the paper layer tilts, content does not)
const SX = 44, SY = 70, SW = 992, SB = 1300
const X0 = 96, X1 = 984, CW = X1 - X0
const GAP = 28, COL = (CW - GAP) / 2
const PHOTO_Y = 360, BAND_H = 46, PHOTO_H = Math.round(COL * 3 / 4)

async function ensureFonts() {
  if (typeof document === 'undefined' || !document.fonts) return
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load(`900 120px ${DISPLAY}`),
        document.fonts.load(`800 48px ${DISPLAY}`),
        document.fonts.load(`700 30px ${BODY}`),
        document.fonts.load(`400 26px ${BODY}`),
        document.fonts.load(`700 34px ${DATA}`),
      ]),
      new Promise(r => setTimeout(r, 3000)),
    ])
  } catch { /* fall back to system fonts */ }
}

function loadImage(src: string, cors: boolean, timeoutMs = 8000): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image()
    if (cors) img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    const t = setTimeout(() => resolve(null), timeoutMs)
    img.onload = () => { clearTimeout(t); resolve(img) }
    img.onerror = () => { clearTimeout(t); resolve(null) }
    img.src = src
  })
}

function initials(name: string): string {
  const parts = name.replace(/["'“”‘’]/g, '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Largest font size (<= max) that fits `text` in `maxW`, never below `min`. */
function fitFont(ctx: CanvasRenderingContext2D, text: string, font: (s: number) => string, max: number, min: number, maxW: number): number {
  let size = max
  while (size > min) {
    ctx.font = font(size)
    if (ctx.measureText(text).width <= maxW) break
    size -= 2
  }
  return size
}

const nameFont = (s: number) => `900 ${s}px ${DISPLAY}`

/** Splits a nickname into at most 2 balanced lines at the largest size that fits `maxW`. */
function splitName(ctx: CanvasRenderingContext2D, name: string, maxW: number, cap: number): { lines: string[]; size: number } {
  const text = name.toUpperCase().trim() || '?'
  const single = fitFont(ctx, text, nameFont, cap, 40, maxW)
  const words = text.split(/\s+/)
  let best = { lines: [text], size: single }
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ')
    const s = Math.min(fitFont(ctx, a, nameFont, cap, 40, maxW), fitFont(ctx, b, nameFont, cap, 40, maxW))
    if (s > best.size * 1.12) best = { lines: [a, b], size: s }
  }
  return best
}

function formatWhen(when: string): { day: string; time: string } {
  const d = new Date(when)
  if (Number.isNaN(d.getTime())) return { day: when, time: '' }
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Baghdad', weekday: 'short', day: 'numeric', month: 'short' }).format(d).replace(',', '')
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Baghdad', hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
  return { day, time }
}

/** deterministic PRNG so every share of the same fight tears the same way */
function prng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

function drawWall(ctx: CanvasRenderingContext2D, toner: HTMLImageElement | null) {
  ctx.fillStyle = C.ink
  ctx.fillRect(0, 0, W, H)
  if (toner) {
    const p = ctx.createPattern(toner, 'repeat')
    if (p) { p.setTransform(new DOMMatrix().scale(1.4)); ctx.fillStyle = p; ctx.fillRect(0, 0, W, H) }
  }
}

function drawSheet(ctx: CanvasRenderingContext2D, grain: HTMLImageElement | null) {
  const rnd = prng(1337)
  ctx.save()
  ctx.translate(W / 2, (SY + SB) / 2)
  ctx.rotate((-0.7 * Math.PI) / 180)
  ctx.translate(-W / 2, -(SY + SB) / 2)
  ctx.beginPath()
  ctx.moveTo(SX, SY)
  ctx.lineTo(SX + SW, SY)
  ctx.lineTo(SX + SW, SB - 10)
  // torn bottom edge, right to left
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

function drawSnipe(ctx: CanvasRenderingContext2D, when: string) {
  const { day, time } = formatWhen(when)
  ctx.save()
  ctx.font = `800 44px ${DISPLAY}`
  const dayTxt = day.toUpperCase()
  const wDay = ctx.measureText(dayTxt).width
  ctx.font = `700 38px ${DATA}`
  const sep = time ? ' · ' : ''
  const wTime = time ? ctx.measureText(sep + time).width : 0
  const w = wDay + wTime + 56, h = 70
  ctx.translate(W - 14, 118)
  ctx.rotate((3 * Math.PI) / 180)
  ctx.fillStyle = C.red
  ctx.fillRect(-w, 0, w, h)
  ctx.fillStyle = C.bone
  ctx.textBaseline = 'alphabetic'
  ctx.font = `800 44px ${DISPLAY}`
  ctx.fillText(dayTxt, -w + 24, 51)
  if (time) { ctx.font = `700 38px ${DATA}`; ctx.fillText(sep + time, -w + 24 + wDay, 50) }
  ctx.restore()
}

/** Card title (optional) under the snipe, right-aligned, display 800 in toner. */
function drawTitle(ctx: CanvasRenderingContext2D, title: string | null | undefined) {
  const t = title?.trim().toUpperCase()
  if (!t) return
  ctx.save()
  ctx.textAlign = 'right'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = C.toner
  const size = fitFont(ctx, t, s => `800 ${s}px ${DISPLAY}`, 48, 28, 400)
  ctx.font = `800 ${size}px ${DISPLAY}`
  ctx.fillText(fitText(ctx, t, 400), X1, 268)
  ctx.restore()
}

/** Halftone a photo into a scratch canvas; null on CORS/decode failure (never taints the poster). */
function screenPhoto(img: HTMLImageElement | null): HTMLCanvasElement | null {
  if (!img || !img.naturalWidth) return null
  try { return halftoneCanvas(img, { px: 640, cell: 15, rgb: TONER_RGB }) } catch { return null }
}

function drawCorner(ctx: CanvasRenderingContext2D, x: number, side: 'red' | 'blue', photo: HTMLCanvasElement | null, name: string) {
  // corner band
  ctx.fillStyle = side === 'red' ? C.red : C.blueInk
  ctx.fillRect(x, PHOTO_Y, COL, BAND_H)
  ctx.fillStyle = C.bone
  ctx.font = `700 24px ${BODY}`
  ctx.letterSpacing = '1.5px'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillText(side === 'red' ? 'RED CORNER' : 'BLUE CORNER', x + 16, PHOTO_Y + BAND_H / 2 + 1)
  ctx.letterSpacing = '0px'
  // photo (cover crop of the square screen into 4:3, biased to the top: faces)
  const y = PHOTO_Y + BAND_H
  ctx.save()
  ctx.beginPath(); ctx.rect(x, y, COL, PHOTO_H); ctx.clip()
  if (photo) {
    const s = COL / photo.width
    const ph = photo.height * s
    ctx.drawImage(photo, x, y - (ph - PHOTO_H) * 0.25, COL, ph)
  } else {
    ctx.fillStyle = C.tonerMute
    ctx.font = `900 ${fitFont(ctx, initials(name), nameFont, 150, 60, COL * 0.5)}px ${DISPLAY}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(initials(name), x + COL / 2, y + PHOTO_H / 2 + 10)
  }
  ctx.restore()
  // frame
  ctx.strokeStyle = C.toner
  ctx.lineWidth = 4
  ctx.strokeRect(x + 2, PHOTO_Y + 2, COL - 4, BAND_H + PHOTO_H - 4)
}

/** The VS rubber stamp at the seam, distressed with the stamp mask. */
function drawVS(ctx: CanvasRenderingContext2D, mask: HTMLImageElement | null) {
  const sw = 168, sh = 118, pad = 24
  const off = document.createElement('canvas')
  off.width = sw + pad * 2; off.height = sh + pad * 2
  const o = off.getContext('2d')
  if (!o) return
  o.fillStyle = C.bone
  o.beginPath(); o.roundRect(pad, pad, sw, sh, 8); o.fill()
  o.strokeStyle = C.red; o.lineWidth = 9
  o.beginPath(); o.roundRect(pad + 4.5, pad + 4.5, sw - 9, sh - 9, 6); o.stroke()
  o.fillStyle = C.red
  o.font = `900 100px ${DISPLAY}`
  o.textAlign = 'center'; o.textBaseline = 'middle'
  o.fillText('VS', pad + sw / 2, pad + sh / 2 + 6)
  if (mask) {
    const p = o.createPattern(mask, 'repeat')
    if (p) { p.setTransform(new DOMMatrix().scale(2.2)); o.globalCompositeOperation = 'destination-in'; o.fillStyle = p; o.fillRect(0, 0, off.width, off.height) }
  }
  ctx.save()
  ctx.translate(W / 2, PHOTO_Y + BAND_H + PHOTO_H * 0.42)
  ctx.rotate((-8 * Math.PI) / 180)
  ctx.drawImage(off, -off.width / 2, -off.height / 2)
  ctx.restore()
}

/** Names in corner inks + kg in Courier. Returns the y of the lowest baseline drawn. */
function drawNames(ctx: CanvasRenderingContext2D, o: PosterOpts): number {
  const top = PHOTO_Y + BAND_H + PHOTO_H + 30
  const redKg = kgLabel(o.redKg), blueKg = kgLabel(o.blueKg)
  let cap = 96
  let r = splitName(ctx, o.redName, COL, cap), b = splitName(ctx, o.blueName, COL, cap)
  // keep both names at the same size (one poster, one voice) and inside the budget
  const lay = () => {
    const size = Math.min(r.size, b.size)
    const lines = Math.max(r.lines.length, b.lines.length)
    const capH = size * 0.74, lineH = size * 0.9
    const last = top + capH + lineH * (lines - 1)
    return { size, capH, lineH, last, kgY: last + 52 }
  }
  let L = lay()
  while ((redKg || blueKg ? L.kgY : L.last) > 1010 && cap > 50) {
    cap -= 6
    r = splitName(ctx, o.redName, COL, cap); b = splitName(ctx, o.blueName, COL, cap)
    L = lay()
  }
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.letterSpacing = '-0.5px'
  const draw = (x: number, lines: string[], color: string, kg: string | null) => {
    ctx.font = nameFont(L.size)
    ctx.fillStyle = color
    lines.forEach((l, i) => ctx.fillText(l, x, top + L.capH + i * L.lineH))
    if (kg) {
      ctx.font = `700 34px ${DATA}`
      ctx.fillStyle = C.toner
      ctx.fillText(kg, x, L.kgY)
    }
  }
  draw(X0, r.lines, C.red, redKg)
  draw(X0 + COL + GAP, b.lines, C.blueInk, blueKg)
  ctx.letterSpacing = '0px'
  return redKg || blueKg ? L.kgY : L.last
}

/** MatDivider: red start line | mat ring | blue start line. */
function drawMatDivider(ctx: CanvasRenderingContext2D, y: number) {
  const ring = 22, gap = 18, h = 12
  ctx.fillStyle = C.red
  ctx.fillRect(X0, y - h / 2, W / 2 - ring - gap - X0, h)
  ctx.fillStyle = C.blue
  ctx.fillRect(W / 2 + ring + gap, y - h / 2, X1 - (W / 2 + ring + gap), h)
  ctx.strokeStyle = C.red
  ctx.lineWidth = 8
  ctx.beginPath(); ctx.arc(W / 2, y, ring - 4, 0, Math.PI * 2); ctx.stroke()
}

function drawFooter(ctx: CanvasRenderingContext2D, url: string) {
  const host = url.replace(/^https?:\/\//, '').replace(/\/$/, '')
  // the call: toner block like .yours
  const by = 1088, bh = 132
  ctx.fillStyle = C.toner
  ctx.fillRect(X0, by, CW, bh)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = C.bone
  ctx.font = `900 64px ${DISPLAY}`
  ctx.fillText('WHO WINS?', X0 + 28, by + 70)
  ctx.font = `700 28px ${BODY}`
  const pick = 'Make your pick on UoS Fight Night.'
  ctx.fillText(fitText(ctx, pick, CW - 56), X0 + 28, by + 112)
  ctx.fillStyle = C.bone2
  ctx.font = `700 26px ${DATA}`
  ctx.textAlign = 'right'
  ctx.fillText(fitText(ctx, host, CW - 380), X1 - 28, by + 68)
  // small print on paper
  ctx.textAlign = 'left'
  ctx.fillStyle = C.tonerMute
  ctx.font = `400 24px ${BODY}`
  ctx.fillText('Members only. Fun points only.', X0, by + bh + 46)
}

function fitText(ctx: CanvasRenderingContext2D, t: string, maxW: number): string {
  if (ctx.measureText(t).width <= maxW) return t
  let s = t
  while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1)
  return s + '…'
}

export async function renderPoster(opts: PosterOpts): Promise<Blob> {
  const [redImg, blueImg, toner, grain, tapeA, tapeB, mask, lockup] = await Promise.all([
    opts.redPhotoUrl ? loadImage(opts.redPhotoUrl, true) : Promise.resolve(null),
    opts.bluePhotoUrl ? loadImage(opts.bluePhotoUrl, true) : Promise.resolve(null),
    loadImage('/textures/toner-dark.png', false),
    loadImage('/textures/paper-grain.png', false),
    loadImage('/textures/tape-a.png', false),
    loadImage('/textures/tape-b.png', false),
    loadImage('/textures/stamp-mask.png', false),
    loadImage('/brand/lockup-light.svg', false),
    ensureFonts(),
  ])
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not supported on this device')

  drawWall(ctx, toner)
  drawSheet(ctx, grain)
  if (lockup) ctx.drawImage(lockup, X0, 112, Math.round(176 * 755 / 308), 176)
  drawSnipe(ctx, opts.when)
  drawTitle(ctx, opts.title)
  drawCorner(ctx, X0, 'red', screenPhoto(redImg), opts.redName)
  drawCorner(ctx, X0 + COL + GAP, 'blue', screenPhoto(blueImg), opts.blueName)
  drawVS(ctx, mask)
  const bottom = drawNames(ctx, opts)
  drawMatDivider(ctx, Math.min(1050, bottom + 40))
  drawFooter(ctx, opts.url)
  drawTape(ctx, tapeA, SX + 40, SY + 6, 300, -24)
  drawTape(ctx, tapeB, SX + SW - 30, SY + 14, 240, 21)

  return toBlob(canvas)
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not create poster image'))), 'image/png')
    } catch (e) {
      reject(e)
    }
  })
}

function shareText(o: PosterOpts): string {
  const vs = `${o.redName} vs ${o.blueName}`
  return `${o.title ? `${o.title}: ` : ''}${vs}. Who you got? Pick your fighter on UoS Fight Night (fun points only).`
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch { return false }
  }
}

function isAbort(e: unknown) {
  return (e as { name?: string })?.name === 'AbortError'
}

/**
 * Renders the poster and shares it (Web Share API with file) or falls back to
 * downloading the PNG + copying text and link to the clipboard.
 * If anything still taints the canvas, it retries without photos (initials instead).
 */
export async function sharePoster(opts: PosterOpts): Promise<void> {
  let blob: Blob
  try {
    blob = await renderPoster(opts)
  } catch (e) {
    if ((e as { name?: string })?.name !== 'SecurityError') throw e
    blob = await renderPoster({ ...opts, redPhotoUrl: null, bluePhotoUrl: null })
  }
  const slug = `${opts.redName}-vs-${opts.blueName}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const file = new File([blob], `uos-fight-night-${slug || 'poster'}.png`, { type: 'image/png' })
  const text = shareText(opts)
  const title = opts.title || 'UoS Fight Night'

  if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title, text: `${text} ${opts.url}`, url: opts.url })
      return
    } catch (e) {
      if (isAbort(e)) return
      // fall through to download
    }
  }

  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = file.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 10_000)
  await copyText(`${text} ${opts.url}`)
}
