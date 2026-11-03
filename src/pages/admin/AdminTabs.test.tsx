import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import AdminTabs from './AdminTabs'
import { adminTabs } from './adminNav'

// Mirrors App.tsx: AdminHome (and so AdminTabs) lives under the `/admin/*` splat route.
const hrefsAt = (url: string) => {
  const html = renderToStaticMarkup(
    <MemoryRouter initialEntries={[url]}>
      <Routes><Route path="/admin/*" element={<AdminTabs />} /></Routes>
    </MemoryRouter>,
  )
  return [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1])
}

describe('admin tabs', () => {
  const expected = ['/admin/fights', '/admin/fighters', '/admin/members', '/admin/points', '/admin/log', '/admin/season', '/admin/shop']

  it('every tab targets an absolute /admin/<section> path', () => {
    expect(adminTabs.map(t => t.to)).toEqual(expected)
  })

  it.each(['/admin', '/admin/fights', '/admin/members', '/admin/fights/members/fights'])(
    'hrefs do not stack onto the current URL when at %s', url => {
      expect(hrefsAt(url)).toEqual(expected)
    })

  it('marks only the current section active', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/admin/members']}>
        <Routes><Route path="/admin/*" element={<AdminTabs />} /></Routes>
      </MemoryRouter>,
    )
    const active = [...html.matchAll(/<a[^>]*aria-current="page"[^>]*href="([^"]+)"|<a[^>]*href="([^"]+)"[^>]*aria-current="page"/g)]
      .map(m => m[1] ?? m[2])
    expect(active).toEqual(['/admin/members'])
  })
})
