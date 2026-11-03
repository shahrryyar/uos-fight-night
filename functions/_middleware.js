// Cloudflare Pages middleware: branded link previews when the site is open,
// neutral shell + hidden brand assets during a C1 lockdown.
// Crawlers (WhatsApp/Telegram previews) never run JS, so this has to happen at the edge.

const BRAND_TITLE = 'UoS Fight Night'
const BRAND_DESC = 'Dorm wrestling nights at the University of Sulaimani. Records, picks and fun points. Members only.'
const OG_DESC = 'Who wins tonight? Pick your fighter. Members only. Fun points only.'
const OG_ALT = 'UoS Wrestling Fight Night logo beside two wrestlers locked up: who wins tonight? Members only.'
const BRAND_ASSET = /^\/(manifest\.webmanifest|favicon(-mono)?\.svg|og\.png|apple-touch-icon-180\.png|icon-(192|512)\.png|maskable-512\.png|brand\/|art\/)/

let cached = { at: 0, lockdown: false }

async function isLockdown(env) {
  const now = Date.now()
  if (now - cached.at < 30_000) return cached.lockdown
  try {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/public_site_status`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
      body: '{}',
    })
    const j = await r.json()
    const row = Array.isArray(j) ? j[0] : j
    // fail closed only on a definite "true"; on errors keep the last known state
    cached = { at: now, lockdown: !!row?.lockdown }
  } catch {
    cached = { ...cached, at: now - 20_000 } // retry in ~10s
  }
  return cached.lockdown
}

const esc = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

function brandHead(origin) {
  const og = `${origin}/og.png`
  const m = (attr, k, v) => `<meta ${attr}="${k}" content="${esc(v)}" data-brand-head>`
  return [
    `<link rel="icon" type="image/svg+xml" href="/favicon.svg" data-brand-head>`,
    `<link rel="icon" type="image/svg+xml" href="/favicon-mono.svg" media="(forced-colors: active)" data-brand-head>`,
    `<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon-180.png" data-brand-head>`,
    `<link rel="manifest" href="/manifest.webmanifest" data-brand-head>`,
    m('property', 'og:type', 'website'),
    m('property', 'og:title', BRAND_TITLE),
    m('property', 'og:description', OG_DESC),
    m('property', 'og:site_name', BRAND_TITLE),
    m('property', 'og:url', `${origin}/`),
    m('property', 'og:image', og),
    m('property', 'og:image:secure_url', og),
    m('property', 'og:image:type', 'image/png'),
    m('property', 'og:image:width', '1200'),
    m('property', 'og:image:height', '630'),
    m('property', 'og:image:alt', OG_ALT),
    m('name', 'twitter:card', 'summary_large_image'),
    m('name', 'twitter:title', BRAND_TITLE),
    m('name', 'twitter:description', OG_DESC),
    m('name', 'twitter:image', og),
  ].join('')
}

export async function onRequest(ctx) {
  const { request, env, next } = ctx
  const url = new URL(request.url)
  if (request.method !== 'GET' && request.method !== 'HEAD') return next()

  const isAsset = BRAND_ASSET.test(url.pathname)
  const res = await next()
  const type = res.headers.get('content-type') || ''
  if (!isAsset && !type.includes('text/html')) return res

  const locked = await isLockdown(env)
  if (isAsset) {
    if (!locked) return res
    return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } })
  }

  const headers = new Headers(res.headers)
  headers.set('cache-control', 'no-cache')
  if (locked) return new Response(res.body, { status: res.status, headers })

  const rewritten = new HTMLRewriter()
    .on('title[data-shell]', { element(e) { e.setInnerContent(BRAND_TITLE) } })
    .on('meta[name="description"]', { element(e) { e.setAttribute('content', BRAND_DESC) } })
    .on('link[rel="icon"][data-shell]', { element(e) { e.remove() } })
    .on('head', { element(e) { e.append(brandHead(url.origin), { html: true }) } })
    .transform(new Response(res.body, { status: res.status, headers }))
  return rewritten
}
