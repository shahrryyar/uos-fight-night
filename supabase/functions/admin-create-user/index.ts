// admin-create-user — an active admin creates a member/admin account (CONTRACT C0).
// Public self-signup is disabled; this is the only way accounts are made.
//
// POST { username, display_name, password, role: 'member'|'admin', fighter_id?: uuid|null }
// with the caller's access token in `Authorization: Bearer <jwt>`.
// -> 200 { user_id, username }
// -> 4xx { error: 'NOT_ADMIN' | 'INVALID_BODY' | 'INVALID_USERNAME' | 'USERNAME_TAKEN'
//                | 'INVALID_DISPLAY_NAME' | 'WEAK_PASSWORD' | 'INVALID_ROLE'
//                | 'FIGHTER_NOT_FOUND' | 'FIGHTER_ALREADY_LINKED' | 'CREATE_FAILED', message? }
//
// Flow: verify caller JWT -> caller must be an active admin -> validate ->
// auth.admin.createUser (synthetic email, email_confirm) -> the
// on_auth_user_created trigger creates the profile (+1000 signup points) from
// user_metadata -> set role / fighter link with the service role -> admin_log.
// If the profile update fails, the new auth user is deleted again.
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const USERNAME_RE = /^[a-z0-9_]{3,20}$/
const EMAIL_DOMAIN = 'members.uosfight.local'

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
  let body: Record<string, unknown>
  try {
    const parsed = await req.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('bad body')
    body = parsed as Record<string, unknown>
  } catch {
    return json({ error: 'INVALID_BODY' }, 400)
  }

  const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : ''
  const displayName = typeof body.display_name === 'string' ? body.display_name.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const role = body.role === undefined || body.role === null ? 'member' : body.role
  const fighterId = body.fighter_id === undefined || body.fighter_id === null || body.fighter_id === ''
    ? null
    : body.fighter_id

  if (!USERNAME_RE.test(username)) {
    return json({ error: 'INVALID_USERNAME', message: 'Username must be 3-20 chars: a-z, 0-9, _' }, 400)
  }
  if (displayName.length < 1 || [...displayName].length > 24) {
    return json({ error: 'INVALID_DISPLAY_NAME', message: 'Display name must be 1-24 characters' }, 400)
  }
  if (password.length < 8 || password.length > 72) {
    return json({ error: 'WEAK_PASSWORD', message: 'Password must be 8-72 characters' }, 400)
  }
  if (role !== 'member' && role !== 'admin') return json({ error: 'INVALID_ROLE' }, 400)
  if (fighterId !== null && (typeof fighterId !== 'string' || !UUID_RE.test(fighterId))) {
    return json({ error: 'FIGHTER_NOT_FOUND' }, 400)
  }

  // username is citext unique; check first for a clean error code
  const { data: taken, error: takenErr } = await admin
    .from('profiles')
    .select('id')
    .eq('username', username)
    .maybeSingle()
  if (takenErr) return json({ error: 'SERVER_ERROR' }, 500)
  if (taken) return json({ error: 'USERNAME_TAKEN' }, 409)

  if (fighterId) {
    const { data: fighter, error: fErr } = await admin
      .from('fighters').select('id').eq('id', fighterId).maybeSingle()
    if (fErr) return json({ error: 'SERVER_ERROR' }, 500)
    if (!fighter) return json({ error: 'FIGHTER_NOT_FOUND' }, 404)
    const { data: linked, error: lErr } = await admin
      .from('profiles').select('id').eq('fighter_id', fighterId).maybeSingle()
    if (lErr) return json({ error: 'SERVER_ERROR' }, 500)
    if (linked) return json({ error: 'FIGHTER_ALREADY_LINKED' }, 409)
  }

  // 4. Create the auth user. The trigger creates the profile + signup points.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: `${username}@${EMAIL_DOMAIN}`,
    password,
    email_confirm: true,
    user_metadata: { username, display_name: displayName },
  })
  if (createErr || !created?.user) {
    const code = (createErr as { code?: string } | null)?.code ?? ''
    const msg = createErr?.message ?? ''
    if (code === 'email_exists' || code === 'user_already_exists' || /already (been )?registered|USERNAME_TAKEN/i.test(msg)) {
      return json({ error: 'USERNAME_TAKEN' }, 409)
    }
    if (code === 'weak_password' || /password/i.test(msg)) {
      return json({ error: 'WEAK_PASSWORD', message: msg }, 400)
    }
    if (/INVALID_USERNAME/.test(msg)) return json({ error: 'INVALID_USERNAME' }, 400)
    console.error('createUser failed', code, msg)
    return json({ error: 'CREATE_FAILED', message: msg }, 400)
  }
  const userId = created.user.id

  // 5. Role, fighter link, display name (service role bypasses RLS).
  const { error: updErr } = await admin
    .from('profiles')
    .update({ role, fighter_id: fighterId, display_name: displayName })
    .eq('id', userId)
  if (updErr) {
    // undo: deleting the auth user cascades to the profile + ledger rows
    await admin.auth.admin.deleteUser(userId)
    if (updErr.code === '23505') return json({ error: 'FIGHTER_ALREADY_LINKED' }, 409)
    console.error('profile update failed', updErr.message)
    return json({ error: 'CREATE_FAILED', message: updErr.message }, 400)
  }

  // 6. Audit log (never the password). fighter_id here also feeds the
  //    participant-history check (private.is_or_was_linked).
  const { error: logErr } = await admin.from('admin_log').insert({
    actor: callerId,
    action: 'member_create',
    target_id: userId,
    details: { username, display_name: displayName, role, fighter_id: fighterId },
  })
  if (logErr) console.error('admin_log insert failed', logErr.message)

  return json({ user_id: userId, username })
})
