/**
 * C1: the branded <head> lives here, not in index.html.
 *
 * index.html ships a neutral shell (plain title, plain description, grey data: icon, no og/twitter
 * tags, no manifest, no brand preloads) because link-preview crawlers, curl and view-source never
 * run JS, and the first paint happens before public_site_status() returns. Once the gate knows this
 * viewer is NOT locked out, LockdownGate calls applyBrandHead(true): league title, description,
 * icons and the web manifest go in. When a lockdown starts while the page is open it calls
 * applyBrandHead(false) and the shell values come back.
 *
 * Link previews: functions/_middleware.js (Cloudflare Pages) reads public_site_status() at the
 * edge and injects the branded title, icons, manifest and og/twitter tags (marked data-brand-head)
 * when the site is open, and 404s brand assets during a lockdown. This module keeps the client in
 * sync when lockdown flips while a page is open.
 */

import { getBrandDesc, getBrandTitle, loadBrandCopy } from '../../lib/brand'

export const SHELL_TITLE = 'Members'
const SHELL_DESCRIPTION = 'Members only.'
export const PLAIN_ICON = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#71717a"/></svg>')

/** brand-only head links: added on apply(true), removed on apply(false) */
const BRAND_LINKS: ReadonlyArray<Record<string, string>> = [
  { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
  { rel: 'icon', type: 'image/svg+xml', href: '/favicon-mono.svg', media: '(forced-colors: active)' },
  { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon-180.png' },
  { rel: 'manifest', href: '/manifest.webmanifest' },
]

function shellTitle(): HTMLTitleElement | null {
  return document.head.querySelector<HTMLTitleElement>('title[data-shell]')
}

let applied: boolean | null = null

export function applyBrandHead(on: boolean): void {
  if (typeof document === 'undefined' || applied === on) return
  applied = on
  const head = document.head

  // the shell <title> is the fallback for routes that don't render their own <title>
  const t = shellTitle()
  if (t) t.text = on ? getBrandTitle() : SHELL_TITLE
  const desc = head.querySelector<HTMLMetaElement>('meta[name="description"]')
  if (desc) desc.content = on ? getBrandDesc() : SHELL_DESCRIPTION

  if (on) {
    void loadBrandCopy().then(c => {
      if (applied) {
        const curT = shellTitle()
        if (curT) curT.text = c.title
        const curD = head.querySelector<HTMLMetaElement>('meta[name="description"]')
        if (curD) curD.content = c.description
      }
    })
  }

  head.querySelectorAll('[data-brand-head]').forEach(el => el.remove())
  const shellIcon = head.querySelector<HTMLLinkElement>('link[rel="icon"][data-shell]')
  if (on) {
    // brand icons replace the grey shell icon (browsers use the last matching icon link)
    shellIcon?.remove()
    for (const attrs of BRAND_LINKS) {
      const l = document.createElement('link')
      for (const [k, v] of Object.entries(attrs)) l.setAttribute(k, v)
      l.setAttribute('data-brand-head', '')
      head.appendChild(l)
    }
  } else if (!shellIcon) {
    const l = document.createElement('link')
    l.rel = 'icon'; l.type = 'image/svg+xml'; l.href = PLAIN_ICON
    l.setAttribute('data-shell', '')
    head.appendChild(l)
  }
}
