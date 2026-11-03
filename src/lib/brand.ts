export interface BrandCopy {
  title: string
  description: string
  shareText: string
  posterPick: string
  posterShare: string
  recapShare: string
  loginInvite: string
}

const FALLBACK_COPY: BrandCopy = {
  title: 'Fight Night',
  description: 'Dorm wrestling nights. Records, picks and fun points. Members only.',
  shareText: 'Fight Night: dorm wrestling nights, real records, fun points. Members only.',
  posterPick: 'Make your pick on Fight Night.',
  posterShare: 'Who you got? Pick your fighter on Fight Night (fun points only).',
  recapShare: 'See every result on Fight Night (fun points only).',
  loginInvite: 'Your Fight Night login.',
}

let loadedCopy: BrandCopy = { ...FALLBACK_COPY }
let copyPromise: Promise<BrandCopy> | null = null

export function getBrandCopy(): BrandCopy {
  return loadedCopy
}

export function getBrandTitle(): string {
  return loadedCopy.title
}

export function getBrandDesc(): string {
  return loadedCopy.description
}

export async function loadBrandCopy(): Promise<BrandCopy> {
  if (copyPromise) return copyPromise
  copyPromise = (async () => {
    try {
      const res = await fetch('/brand/copy.json')
      if (res.ok) {
        const json = await res.json() as Partial<BrandCopy>
        loadedCopy = { ...FALLBACK_COPY, ...json }
      }
    } catch {
      // offline or 404 during lockdown
    }
    return loadedCopy
  })()
  return copyPromise
}

if (typeof window !== 'undefined') {
  void loadBrandCopy()
}
