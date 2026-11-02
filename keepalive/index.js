// Daily ping so the free Supabase project never pauses for inactivity.
// Calls the only anon-callable RPC (returns nicknames of the next fight, nothing private).
export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(ping(env))
  },
  async fetch(_req, env) {
    const r = await ping(env)
    return new Response(`keepalive ${r}`, { status: 200 })
  },
}
async function ping(env) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/public_next_fight`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
    body: '{}',
  })
  return res.status
}
