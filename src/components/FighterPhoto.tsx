import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const cache = new Map<string, { url: string; exp: number }>()

/** Signed URL (1h) for a private fighter-photos path, cached in memory. */
export async function signedPhotoUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null
  const hit = cache.get(path)
  if (hit && hit.exp > Date.now() + 60_000) return hit.url
  const { data, error } = await supabase.storage.from('fighter-photos').createSignedUrl(path, 3600)
  if (error || !data) return null
  cache.set(path, { url: data.signedUrl, exp: Date.now() + 3600_000 })
  return data.signedUrl
}

export function useSignedPhoto(path: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    signedPhotoUrl(path).then(u => { if (live) setUrl(u) })
    return () => { live = false }
  }, [path])
  return url
}
