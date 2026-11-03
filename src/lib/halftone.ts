/**
 * Canvas halftone: the port of design/final/_src/gen_assets.py::halftone() (DESIGN.md section 8).
 * Chest-up crop, per-photo auto-levels (2% cut), 1.1px blur, 45deg AM dot screen, shadow crush, toner dropout.
 *
 * CORS: getImageData throws on a tainted canvas (photo served without Access-Control-Allow-Origin).
 * `halftoneUrl` rejects in that case; `tryHalftoneUrl` resolves null so callers keep the plain <img>.
 */
export interface HalftoneOpts {
  /** output canvas side in device px (square) */
  px: number
  /** dot cell in device px (CSS 7px on paper, 5px bone on ink, times devicePixelRatio) */
  cell: number
  /** true = encode lightness (bone dots on ink); false = encode darkness (toner dots on paper) */
  light?: boolean
  /** dot colour: toner [26,25,23] or bone [244,241,234] */
  rgb: [number, number, number]
  /** crop to the chest-up square (default true). false = keep the whole frame, centred square */
  crop?: boolean
}

export const TONER_RGB: [number, number, number] = [26, 25, 23]
export const BONE_RGB: [number, number, number] = [244, 241, 234]

export function initialsOf(name: string) {
  const p = name.replace(/["'“”‘’]/g, '').trim().split(/\s+/).filter(Boolean)
  if (!p.length) return '?'
  return (p.length === 1 ? p[0].slice(0, 2) : p[0][0] + p[p.length - 1][0]).toUpperCase()
}

const cache = new Map<string, string>() // key -> object URL (kept for the session)
const inflight = new Map<string, Promise<string>>()

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('halftone: image failed to load'))
    img.src = src
  })
}

/** Renders the halftone into a canvas. Throws SecurityError if the image taints the canvas. */
export function halftoneCanvas(img: CanvasImageSource & { naturalWidth?: number; naturalHeight?: number; width: number; height: number }, o: HalftoneOpts): HTMLCanvasElement {
  const N = Math.max(16, Math.round(o.px))
  const cv = document.createElement('canvas')
  cv.width = cv.height = N
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('halftone: no 2d context')
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height
  const crop = o.crop !== false
  // chest-up crop: zoom 1.12, top at 6%
  const side = Math.min(iw, ih) / (crop ? 1.12 : 1)
  const sx = (iw - side) / 2
  const sy = crop ? Math.min(ih - side, ih * 0.06) : (ih - side) / 2
  if ('filter' in ctx) ctx.filter = `blur(${(1.1 * N) / 360}px)`
  ctx.drawImage(img, sx, sy, side, side, 0, 0, N, N)
  if ('filter' in ctx) ctx.filter = 'none'
  const d = ctx.getImageData(0, 0, N, N).data // throws if CORS-tainted
  const g = new Float32Array(N * N), hist = new Uint32Array(256)
  for (let i = 0; i < N * N; i++) {
    const v = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) | 0
    g[i] = v; hist[v]++
  }
  const cut = N * N * 0.02
  let lo = 0, hi = 255, acc = 0
  while (acc + hist[lo] <= cut && lo < 254) acc += hist[lo++]
  acc = 0
  while (acc + hist[hi] <= cut && hi > lo + 1) acc += hist[hi--]
  const dark = new Float32Array(N * N)
  for (let i = 0; i < N * N; i++) {
    const t = Math.min(1, Math.max(0, (g[i] - lo) / (hi - lo)))
    dark[i] = o.light ? t ** 1.1 : (1 - t) ** 0.9
  }
  const out = ctx.createImageData(N, N)
  const c = Math.SQRT1_2, s = Math.SQRT1_2, cell = o.cell
  // deterministic dropout so re-renders match (mulberry32)
  let seed = 0x9e3779b9
  const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = (x * c + y * s) / cell, v = (-x * s + y * c) / cell
    const du = u - Math.floor(u) - 0.5, dv = v - Math.floor(v) - 0.5
    const cu = Math.floor(u) + 0.5, cw = Math.floor(v) + 0.5
    const cx = Math.min(N - 1, Math.max(0, ((cu * c - cw * s) * cell) | 0))
    const cy = Math.min(N - 1, Math.max(0, ((cu * s + cw * c) * cell) | 0))
    let ink = Math.min(1, Math.max(0, (Math.sqrt(dark[cy * N + cx]) * 0.64 - Math.hypot(du, dv)) * cell * 1.6 + 0.5))
    const i = y * N + x
    if (!o.light && dark[i] > 0.84) ink = 1 // photocopy crush
    if (rnd() > 0.993) ink = 0 // toner dropout
    out.data[i * 4] = o.rgb[0]; out.data[i * 4 + 1] = o.rgb[1]; out.data[i * 4 + 2] = o.rgb[2]; out.data[i * 4 + 3] = ink * 255
  }
  ctx.putImageData(out, 0, 0)
  return cv
}

/** Object URL of the halftoned PNG, cached per `key` for the session. Rejects on load or CORS failure. */
export async function halftoneUrl(src: string, key: string, o: HalftoneOpts): Promise<string> {
  const hit = cache.get(key)
  if (hit) return hit
  const running = inflight.get(key)
  if (running) return running
  const job = (async () => {
    const img = await loadImage(src)
    const cv = halftoneCanvas(img, o)
    const blob = await new Promise<Blob>((res, rej) => cv.toBlob(b => (b ? res(b) : rej(new Error('halftone: toBlob failed'))), 'image/png'))
    const url = URL.createObjectURL(blob)
    cache.set(key, url)
    return url
  })()
  inflight.set(key, job)
  try { return await job } finally { inflight.delete(key) }
}

/** Same as halftoneUrl but resolves null instead of throwing (CORS-safe fallback path). */
export async function tryHalftoneUrl(src: string, key: string, o: HalftoneOpts): Promise<string | null> {
  try { return await halftoneUrl(src, key, o) } catch { return null }
}

/** Runs `fn` when the main thread is idle, so halftoning never blocks first paint. Returns a cancel function. */
export function whenIdle(fn: () => void): () => void {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void }
  if (w.requestIdleCallback) {
    const h = w.requestIdleCallback(fn, { timeout: 600 })
    return () => w.cancelIdleCallback?.(h)
  }
  const t = window.setTimeout(fn, 0)
  return () => window.clearTimeout(t)
}
