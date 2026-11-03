/**
 * Make everything outside `el` inert (no focus, no clicks, hidden from screen readers) while it is
 * mounted. The referee board covers the app chrome visually (fixed, z 35) but lives inside
 * AppLayout's <main>, so without this Tab walks into the hidden header, tab bar and credit, and the
 * bottom sheet's aria-modal would not keep focus either.
 *
 * Walks from `el` up to <body> and sets `inert` on every sibling at each level. aria-live regions
 * (the toast host, the board's score announcer) are left alone so they still show and are read out.
 * Only the elements this call made inert are restored, so nested calls (board, then a sheet on
 * top of it) unwind cleanly. Siblings added later (a Suspense fallback swapping in) are caught by a
 * childList observer on each ancestor.
 */
import { useEffect } from 'react'

const keep = (n: Element) => n.matches('[aria-live], script, style, template')

export function useInertOutside(el: HTMLElement | null, on = true) {
  useEffect(() => {
    if (!el || !on) return
    const mine = new Set<Element>()
    const ancestors: Element[] = []
    for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
      if (n.parentElement) ancestors.push(n.parentElement)
    }
    const apply = () => {
      let child: Element = el
      for (const parent of ancestors) {
        for (const sib of Array.from(parent.children)) {
          if (sib === child || sib.contains(el) || keep(sib) || sib.hasAttribute('inert')) continue
          sib.setAttribute('inert', '')
          mine.add(sib)
        }
        child = parent
      }
    }
    apply()
    const mo = new MutationObserver(apply)
    ancestors.forEach(a => mo.observe(a, { childList: true }))
    return () => {
      mo.disconnect()
      mine.forEach(n => n.removeAttribute('inert'))
    }
  }, [el, on])
}
