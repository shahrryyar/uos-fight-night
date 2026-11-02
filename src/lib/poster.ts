/**
 * Share poster: 1080x1350 canvas "VS" fight poster.
 * Red corner top-left, blue corner bottom-right, gold VS on the diagonal.
 * Fun points only — no cash value. No external deps.
 */

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

/** 72.5 → "72.5 KG", 70 → "70 KG"; null/invalid → null. */
function kgLabel(v: number | null | undefined): string | null {
  if (v === null || v === undefined) return null
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return null
  return `${Number.isInteger(n) ? n : n.toFixed(1)} KG`
}

const W = 1080
const H = 1350
const C = {
  ink: '#0b0b0d',
  red: '#d7192a',
  redDark: '#8f0f1b',
  blue: '#2a6fdb',
  blueDark: '#173f80',
  gold: '#e3b341',
  bone: '#f4f1ea',
  muted: '#9a968e',
}
const DISPLAY = '"Bebas Neue", Impact, "Arial Narrow", sans-serif'
const SANS = 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif'

/** Diagonal through the poster center, rising to the right. */
const diagY = (x: number) => 675 + (540 - x) * 0.3

async function ensureFonts() {
  if (typeof document === 'undefined' || !document.fonts) return
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load('120px "Bebas Neue"'),
        document.fonts.load('600 30px Inter'),
      ]),
      new Promise(r => setTimeout(r, 3000)),
    ])
  } catch { /* fall back to system fonts */ }
}

function loadImage(src: string, timeoutMs = 8000): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    const t = setTimeout(() => resolve(null), timeoutMs)
    img.onload = () => { clearTimeout(t); resolve(img) }
    img.onerror = () => { clearTimeout(t); resolve(null) }
    img.src = src
  })
}

function initials(name: string): string {
  const parts = name.replace(/["'“”]/g, '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Largest font size (<= max) that fits `text` in `maxW`, never below `min`. */
function fitFont(ctx: CanvasRenderingContext2D, text: string, family: string, max: number, min: number, maxW: number): number {
  let size = max
  while (size > min) {
    ctx.font = `${size}px ${family}`
    if (ctx.measureText(text).width <= maxW) break
    size -= 4
  }
  return size
}

/** Splits a long nickname into up to 2 balanced lines. `cap` limits the largest font size. */
function splitName(ctx: CanvasRenderingContext2D, name: string, maxW: number, cap = 150): { lines: string[]; size: number } {
  const text = name.toUpperCase().trim() || '?'
  const single = fitFont(ctx, text, DISPLAY, Math.min(150, cap), 40, maxW)
  const words = text.split(/\s+/)
  if (single >= Math.min(96, cap) || words.length < 2) return { lines: [text], size: single }
  let best: { lines: string[]; size: number } = { lines: [text], size: single }
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ')
    const sa = fitFont(ctx, a, DISPLAY, Math.min(120, cap), 40, maxW)
    const sb = fitFont(ctx, b, DISPLAY, Math.min(120, cap), 40, maxW)
    const s = Math.min(sa, sb)
    if (s > best.size) best = { lines: [a, b], size: s }
  }
  return best
}

function formatWhen(when: string): { day: string; time: string } {
  const d = new Date(when)
  if (Number.isNaN(d.getTime())) return { day: when.toUpperCase(), time: '' }
  const day = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Baghdad', weekday: 'short', day: 'numeric', month: 'short',
  }).format(d).replace(',', '')
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Baghdad', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d)
  return { day: day.toUpperCase(), time: time.toUpperCase() }
}

function drawPanels(ctx: CanvasRenderingContext2D) {
  const gap = 16
  // Red corner (top-left)
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(0, 0); ctx.lineTo(W, 0); ctx.lineTo(W, diagY(W) - gap); ctx.lineTo(0, diagY(0) - gap)
  ctx.closePath()
  let g = ctx.createLinearGradient(0, 0, W, diagY(0))
  g.addColorStop(0, C.redDark); g.addColorStop(0.55, C.red); g.addColorStop(1, '#a4121f')
  ctx.fillStyle = g
  ctx.fill()
  ctx.clip()
  drawStripes(ctx, 'rgba(0,0,0,0.10)')
  ctx.restore()

  // Blue corner (bottom-right)
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(0, diagY(0) + gap); ctx.lineTo(W, diagY(W) + gap); ctx.lineTo(W, H); ctx.lineTo(0, H)
  ctx.closePath()
  g = ctx.createLinearGradient(W, H, 0, diagY(W))
  g.addColorStop(0, C.blueDark); g.addColorStop(0.5, C.blue); g.addColorStop(1, '#1f55ad')
  ctx.fillStyle = g
  ctx.fill()
  ctx.clip()
  drawStripes(ctx, 'rgba(0,0,0,0.10)')
  ctx.restore()

  // Gold hairline along the diagonal
  ctx.save()
  ctx.strokeStyle = C.gold
  ctx.lineWidth = 4
  ctx.globalAlpha = 0.9
  ctx.beginPath(); ctx.moveTo(0, diagY(0)); ctx.lineTo(W, diagY(W)); ctx.stroke()
  ctx.restore()
}

function drawStripes(ctx: CanvasRenderingContext2D, color: string) {
  ctx.strokeStyle = color
  ctx.lineWidth = 10
  for (let x = -H; x < W + H; x += 36) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + H * 0.6, H); ctx.stroke()
  }
}

function drawVignette(ctx: CanvasRenderingContext2D) {
  // spotlight from top center
  let g = ctx.createRadialGradient(W / 2, -120, 40, W / 2, -120, 900)
  g.addColorStop(0, 'rgba(255,240,210,0.28)'); g.addColorStop(1, 'rgba(255,240,210,0)')
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  // top fade for header
  g = ctx.createLinearGradient(0, 0, 0, 260)
  g.addColorStop(0, 'rgba(11,11,13,0.92)'); g.addColorStop(1, 'rgba(11,11,13,0)')
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, 260)
  // bottom fade for date + footer
  g = ctx.createLinearGradient(0, 1060, 0, H)
  g.addColorStop(0, 'rgba(11,11,13,0)'); g.addColorStop(0.45, 'rgba(11,11,13,0.85)'); g.addColorStop(1, 'rgba(11,11,13,1)')
  ctx.fillStyle = g; ctx.fillRect(0, 1060, W, H - 1060)
  // edge vignette
  g = ctx.createRadialGradient(W / 2, H / 2, 420, W / 2, H / 2, 980)
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.55)')
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
}

function drawPortrait(ctx: CanvasRenderingContext2D, img: HTMLImageElement | null, name: string, cx: number, cy: number, r: number, base: string) {
  ctx.save()
  // drop shadow ring
  ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 12
  ctx.beginPath(); ctx.arc(cx, cy, r + 10, 0, Math.PI * 2)
  ctx.fillStyle = C.ink; ctx.fill()
  ctx.restore()

  ctx.save()
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip()
  if (img && img.naturalWidth > 0) {
    const s = Math.max((2 * r) / img.naturalWidth, (2 * r) / img.naturalHeight)
    const w = img.naturalWidth * s, h = img.naturalHeight * s
    ctx.drawImage(img, cx - w / 2, cy - h / 2.4, w, h) // bias toward the top (faces)
  } else {
    const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.4, 10, cx, cy, r)
    g.addColorStop(0, base); g.addColorStop(1, C.ink)
    ctx.fillStyle = g; ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r)
    ctx.fillStyle = C.bone
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.font = `${Math.round(r * 1.05)}px ${DISPLAY}`
    ctx.fillText(initials(name), cx, cy + r * 0.06)
  }
  ctx.restore()

  ctx.save()
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.lineWidth = 10; ctx.strokeStyle = C.gold; ctx.stroke()
  ctx.restore()
}

const SUB_SIZE = 50
const SUB_GAP = 58 // last name baseline → kg baseline

/**
 * Red names grow upward from `y` (last line — or the kg line if given — sits on y, hugging the diagonal from above).
 * Blue names grow downward from `y` (corner label sits on y, just below the diagonal), kg line under the name.
 * `bound` keeps the block clear of the header (up: min label baseline) or the footer (down: max kg baseline).
 */
function drawName(
  ctx: CanvasRenderingContext2D, corner: string, name: string, x: number, y: number, maxW: number,
  align: CanvasTextAlign, grow: 'up' | 'down', sub: string | null = null, bound?: number,
) {
  let cap = 150
  let layout = splitName(ctx, name, maxW, cap)
  const place = (lines: string[], size: number) => {
    const lineH = size * 0.92
    const capH = size * 0.72
    if (grow === 'up') {
      const lastBaseline = sub ? y - SUB_GAP : y
      const firstBaseline = lastBaseline - lineH * (lines.length - 1)
      return { lineH, firstBaseline, labelY: firstBaseline - capH - 18, subY: y, edge: firstBaseline - capH - 18 }
    }
    const firstBaseline = y + 18 + capH
    const lastBaseline = firstBaseline + lineH * (lines.length - 1)
    return { lineH, firstBaseline, labelY: y, subY: lastBaseline + SUB_GAP, edge: sub ? lastBaseline + SUB_GAP : lastBaseline }
  }
  let pos = place(layout.lines, layout.size)
  // Only shrink when a kg line was added (keeps the original layout byte-for-byte otherwise).
  if (sub && bound !== undefined) {
    const overflow = () => (grow === 'up' ? pos.edge < bound : pos.edge > bound)
    while (overflow() && cap > 56) {
      cap -= 6
      layout = splitName(ctx, name, maxW, cap)
      pos = place(layout.lines, layout.size)
    }
  }
  const { lines, size } = layout
  const { lineH, firstBaseline, labelY, subY } = pos
  ctx.save()
  ctx.textAlign = align
  ctx.textBaseline = 'alphabetic'
  ctx.font = `600 26px ${SANS}`
  ctx.fillStyle = 'rgba(244,241,234,0.85)'
  ctx.letterSpacing = '6px'
  ctx.fillText(corner, x, labelY)
  ctx.letterSpacing = '1px'
  ctx.font = `${size}px ${DISPLAY}`
  ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6
  ctx.fillStyle = C.bone
  lines.forEach((l, i) => ctx.fillText(l, x, firstBaseline + i * lineH))
  if (sub) {
    ctx.font = `${SUB_SIZE}px ${DISPLAY}`
    ctx.letterSpacing = '4px'
    ctx.fillStyle = C.gold
    ctx.fillText(sub, x, subY)
  }
  ctx.restore()
}

function drawVS(ctx: CanvasRenderingContext2D) {
  const cx = 540, cy = diagY(540)
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(-Math.atan(0.3))
  // dark badge behind VS
  ctx.beginPath(); ctx.arc(0, 0, 118, 0, Math.PI * 2)
  ctx.fillStyle = C.ink; ctx.fill()
  ctx.lineWidth = 6; ctx.strokeStyle = C.gold; ctx.stroke()
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.font = `200px ${DISPLAY}`
  const g = ctx.createLinearGradient(0, -80, 0, 80)
  g.addColorStop(0, '#fbe3a0'); g.addColorStop(0.5, C.gold); g.addColorStop(1, '#a87a1c')
  ctx.fillStyle = g
  ctx.shadowColor = 'rgba(227,179,65,0.45)'; ctx.shadowBlur = 30
  ctx.fillText('VS', 4, 12)
  ctx.restore()
}

function drawHeader(ctx: CanvasRenderingContext2D, title: string | null | undefined) {
  ctx.save()
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'
  ctx.font = `600 24px ${SANS}`
  ctx.letterSpacing = '10px'
  ctx.fillStyle = C.gold
  ctx.fillText('MEMBERS ONLY · DORM LEAGUE', W / 2 + 5, 74)
  ctx.letterSpacing = '4px'
  ctx.font = `96px ${DISPLAY}`
  ctx.fillStyle = C.bone
  ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 16
  const a = 'UOS ', b = 'FIGHT ', c = 'NIGHT'
  const wa = ctx.measureText(a).width, wb = ctx.measureText(b).width, wc = ctx.measureText(c).width
  let x = W / 2 - (wa + wb + wc) / 2
  ctx.textAlign = 'left'
  ctx.fillText(a, x, 160); x += wa
  ctx.fillStyle = C.bone; ctx.fillText(b, x, 160); x += wb
  ctx.fillStyle = C.gold; ctx.fillText(c, x, 160)
  if (title && title.trim()) {
    ctx.textAlign = 'center'
    ctx.letterSpacing = '3px'
    const t = title.trim().toUpperCase()
    const size = fitFont(ctx, t, DISPLAY, 54, 30, W - 160)
    ctx.font = `${size}px ${DISPLAY}`
    ctx.fillStyle = 'rgba(244,241,234,0.9)'
    ctx.fillText(t, W / 2, 222)
  }
  ctx.restore()
}

function drawFooter(ctx: CanvasRenderingContext2D, when: string, url: string) {
  const { day, time } = formatWhen(when)
  ctx.save()
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'
  ctx.letterSpacing = '4px'
  ctx.font = `84px ${DISPLAY}`
  ctx.fillStyle = C.gold
  ctx.fillText(time ? `${day} · ${time}` : day, W / 2, 1192)
  ctx.font = `600 22px ${SANS}`
  ctx.letterSpacing = '8px'
  ctx.fillStyle = C.muted
  if (time) ctx.fillText('BAGHDAD TIME', W / 2 + 4, 1230)
  // rule
  ctx.fillStyle = 'rgba(227,179,65,0.5)'
  ctx.fillRect(W / 2 - 220, 1262, 440, 2)
  ctx.letterSpacing = '6px'
  ctx.font = `34px ${DISPLAY}`
  ctx.fillStyle = C.bone
  ctx.fillText('UOS FIGHT NIGHT · PICK YOUR FIGHTER', W / 2 + 3, 1302)
  ctx.letterSpacing = '1px'
  ctx.font = `500 22px ${SANS}`
  ctx.fillStyle = C.muted
  ctx.fillText(url.replace(/^https?:\/\//, '').replace(/\/$/, ''), W / 2, 1334)
  ctx.restore()
}

function drawGrain(ctx: CanvasRenderingContext2D) {
  // cheap deterministic speckle — keeps it poster-like without a noise texture
  ctx.save()
  let seed = 1337
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 3500; i++) {
    ctx.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.12)'
    ctx.fillRect(rnd() * W, rnd() * H, 2, 2)
  }
  ctx.restore()
}

export async function renderPoster(opts: PosterOpts): Promise<Blob> {
  const [redImg, blueImg] = await Promise.all([
    opts.redPhotoUrl ? loadImage(opts.redPhotoUrl) : Promise.resolve(null),
    opts.bluePhotoUrl ? loadImage(opts.bluePhotoUrl) : Promise.resolve(null),
    ensureFonts(),
  ])
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not supported on this device')

  ctx.fillStyle = C.ink
  ctx.fillRect(0, 0, W, H)
  drawPanels(ctx)
  drawVignette(ctx)
  drawHeader(ctx, opts.title)

  // Red corner: portrait left, name right
  drawPortrait(ctx, redImg, opts.redName, 270, 470, 175, C.red)
  drawName(ctx, 'RED CORNER', opts.redName, 1020, 488, 520, 'right', 'up', kgLabel(opts.redKg), 262)
  // Blue corner: name left, portrait right
  drawPortrait(ctx, blueImg, opts.blueName, 810, 900, 175, C.blue)
  drawName(ctx, 'BLUE CORNER', opts.blueName, 60, 880, 520, 'left', 'down', kgLabel(opts.blueKg), 1110)

  drawVS(ctx)
  drawFooter(ctx, opts.when, opts.url)
  drawGrain(ctx)

  return toBlob(canvas)
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not create poster image'))), 'image/png')
    } catch (e) {
      // SecurityError if a photo tainted the canvas (CORS) — caller can retry without photos
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
 * If a photo taints the canvas, it retries without photos (initials instead).
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
