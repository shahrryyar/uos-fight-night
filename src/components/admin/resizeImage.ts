/**
 * Client-side resize: longest side ≤ maxSide, encode WebP (fallback JPEG) at `quality`.
 * Returns the blob plus the file extension/content type actually produced.
 */
export async function resizeImage(file: File, maxSide = 800, quality = 0.85): Promise<{ blob: Blob; ext: 'webp' | 'jpg'; type: string }> {
  const src = await loadSource(file)
  const scale = Math.min(1, maxSide / Math.max(src.width, src.height))
  const w = Math.max(1, Math.round(src.width * scale))
  const h = Math.max(1, Math.round(src.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas not supported on this device')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src.img, 0, 0, w, h)
  src.close()

  const webp = await toBlob(canvas, 'image/webp', quality)
  if (webp && webp.type === 'image/webp') return { blob: webp, ext: 'webp', type: 'image/webp' }
  const jpeg = await toBlob(canvas, 'image/jpeg', quality)
  if (!jpeg) throw new Error('Could not encode image')
  return { blob: jpeg, ext: 'jpg', type: 'image/jpeg' }
}

function toBlob(c: HTMLCanvasElement, type: string, q: number) {
  return new Promise<Blob | null>(res => c.toBlob(res, type, q))
}

async function loadSource(file: File): Promise<{ img: CanvasImageSource; width: number; height: number; close: () => void }> {
  if ('createImageBitmap' in window) {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { img: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() }
    } catch { /* fall through to <img> (e.g. HEIC on some browsers) */ }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    await img.decode()
    return { img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) }
  } catch {
    URL.revokeObjectURL(url)
    throw new Error("Couldn't read that image. Try a JPG or PNG.")
  }
}
