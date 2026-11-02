// admin-reset-password — lets an active admin set a new password for a member.
// POST { user_id: string, new_password: string } with the caller's access token
// in `Authorization: Bearer <jwt>`. Uses the service role server-side only.
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function serviceKey(): string | undefined {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (legacy) return legacy
  // newer projects expose secret keys as a JSON map
  const secrets = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (secrets) {
    try {
      const parsed = JSON.parse(secrets) as Record<string, string>
      return parsed.default ?? Object.values(parsed)[0]
    } catch { /* ignore */ }
  }
  return undefined
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  const url = Deno.env.get('SUPABASE_URL')
  const key = serviceKey()
  if (!url || !key) return json({ error: 'SERVER_MISCONFIGURED' }, 500)

  const authHeader = req.headers.get('Authorization') ?? ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!jwt) return json({ error: 'NOT_ADMIN' }, 401)

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // 1. Verify the caller's JWT with the auth server.
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt)
  if (userErr || !userData?.user) return json({ error: 'NOT_ADMIN' }, 401)
  const callerId = userData.user.id

  // 2. Caller must be an active admin.
  const { data: caller, error: callerErr } = await admin
    .from('profiles')
    .select('id, role, active')
    .eq('id', callerId)
    .maybeSingle()
  if (callerErr) return json({ error: 'SERVER_ERROR' }, 500)
  if (!caller || caller.role !== 'admin' || !caller.active) return json({ error: 'NOT_ADMIN' }, 403)

  // 3. Validate input.
  let body: { user_id?: unknown; new_password?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'INVALID_BODY' }, 400)
  }
  const userId = typeof body.user_id === 'string' ? body.user_id : ''
  const newPassword = typeof body.new_password === 'string' ? body.new_password : ''
  if (!UUID_RE.test(userId)) return json({ error: 'INVALID_USER' }, 400)
  if (newPassword.length < 8 || newPassword.length > 72) {
    return json({ error: 'WEAK_PASSWORD', message: 'Password must be 8-72 characters' }, 400)
  }

  const { data: target, error: targetErr } = await admin
    .from('profiles')
    .select('id, username')
    .eq('id', userId)
    .maybeSingle()
  if (targetErr) return json({ error: 'SERVER_ERROR' }, 500)
  if (!target) return json({ error: 'MEMBER_NOT_FOUND' }, 404)

  // 4. Update password.
  const { error: updErr } = await admin.auth.admin.updateUserById(userId, { password: newPassword })
  if (updErr) return json({ error: 'UPDATE_FAILED', message: updErr.message }, 400)

  // 5. Audit log (never log the password).
  const { error: logErr } = await admin.from('admin_log').insert({
    actor: callerId,
    action: 'password_reset',
    target_id: userId,
    details: { username: target.username },
  })
  if (logErr) console.error('admin_log insert failed', logErr.message)

  return json({ ok: true })
})
