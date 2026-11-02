#!/usr/bin/env bash
# LOCAL ONLY. Needs: supabase start, supabase db reset (seed accounts), supabase functions serve.
# Run: bash supabase/tests/http_auth_edge_test.sh
# curl tests: signup disabled + admin-create-user edge function (local stack)
API=http://127.0.0.1:54321
ANON=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0
DB=postgresql://postgres:postgres@127.0.0.1:54322/postgres
pass=0; fail=0
check() { if [[ "$2" == *"$3"* ]]; then echo "ok   - $1"; pass=$((pass+1)); else echo "FAIL - $1: got [$2] want [$3]"; fail=$((fail+1)); fi; }
token() { curl -s -X POST "$API/auth/v1/token?grant_type=password" -H "apikey: $ANON" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$1@members.uosfight.local\",\"password\":\"$2\"}" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("access_token",""))'; }
create() { curl -s -w ' HTTP%{http_code}' -X POST "$API/functions/v1/admin-create-user" -H "apikey: $ANON" \
  -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$2"; }

SUF=$RANDOM$RANDOM
# 1. public signup disabled
r=$(curl -s -w ' HTTP%{http_code}' -X POST "$API/auth/v1/signup" -H "apikey: $ANON" -H 'Content-Type: application/json' \
  -d "{\"email\":\"hack$SUF@members.uosfight.local\",\"password\":\"password123\",\"data\":{\"username\":\"hack$SUF\"}}")
check "POST /auth/v1/signup is rejected" "$r" "signup_disabled"
check "no auth user created by signup" "$(psql $DB -Atc "select count(*) from auth.users where email like 'hack$SUF%'")" "0"

ADMIN=$(token admin localadmin123); MEMBER=$(token member1 localmember123)
check "admin can log in" "${#ADMIN}" ""; [ -n "$ADMIN" ] || { echo "FAIL - admin login"; fail=$((fail+1)); }
# 2. as member -> NOT_ADMIN
r=$(create "$MEMBER" "{\"username\":\"m$SUF\",\"display_name\":\"Nope\",\"password\":\"password123\",\"role\":\"member\"}")
check "member cannot create users" "$r" "NOT_ADMIN"
r=$(create "garbage" "{}"); check "bad token rejected" "$r" "HTTP401"
# 3. validation
r=$(create "$ADMIN" "{\"username\":\"a!\",\"display_name\":\"X\",\"password\":\"password123\",\"role\":\"member\"}")
check "invalid username" "$r" "INVALID_USERNAME"
r=$(create "$ADMIN" "{\"username\":\"u$SUF\",\"display_name\":\"X\",\"password\":\"short\",\"role\":\"member\"}")
check "weak password" "$r" "WEAK_PASSWORD"
r=$(create "$ADMIN" "{\"username\":\"u$SUF\",\"display_name\":\"\",\"password\":\"password123\",\"role\":\"member\"}")
check "empty display name" "$r" "INVALID_DISPLAY_NAME"
r=$(create "$ADMIN" "{\"username\":\"u$SUF\",\"display_name\":\"X\",\"password\":\"password123\",\"role\":\"boss\"}")
check "invalid role" "$r" "INVALID_ROLE"
r=$(create "$ADMIN" "{\"username\":\"member1\",\"display_name\":\"Dup\",\"password\":\"password123\",\"role\":\"member\"}")
check "username taken" "$r" "USERNAME_TAKEN"
r=$(create "$ADMIN" "{\"username\":\"MEMBER1\",\"display_name\":\"Dup\",\"password\":\"password123\",\"role\":\"member\"}")
check "username taken (case-insensitive)" "$r" "USERNAME_TAKEN"
r=$(create "$ADMIN" "{\"username\":\"u$SUF\",\"display_name\":\"X\",\"password\":\"password123\",\"role\":\"member\",\"fighter_id\":\"11111111-1111-4111-8111-111111111111\"}")
check "fighter already linked" "$r" "FIGHTER_ALREADY_LINKED"
# 4. success: member with fighter link
FID=$(psql $DB -qAtc "insert into public.fighters (nickname) values ('Edge Test $SUF') returning id")
r=$(create "$ADMIN" "{\"username\":\"u$SUF\",\"display_name\":\"Edge Tester\",\"password\":\"password123\",\"role\":\"member\",\"fighter_id\":\"$FID\"}")
check "admin creates member" "$r" "\"username\":\"u$SUF\""
check "returns user_id" "$r" "user_id"
check "profile row" "$(psql $DB -Atc "select display_name||'|'||role||'|'||fighter_id||'|'||active from public.profiles where username='u$SUF'")" "Edge Tester|member|$FID|true"
check "signup points" "$(psql $DB -Atc "select sum(delta) from public.points_ledger l join public.profiles p on p.id=l.user_id where p.username='u$SUF'")" "1000"
check "admin_log member_create" "$(psql $DB -Atc "select count(*) from public.admin_log where action='member_create' and details->>'username'='u$SUF' and details->>'fighter_id'='$FID'")" "1"
check "no password in admin_log" "$(psql $DB -Atc "select count(*) from public.admin_log where details::text like '%password123%'")" "0"
NEWTOK=$(token "u$SUF" password123); [ -n "$NEWTOK" ] && check "new member can log in" "ok" "ok" || check "new member can log in" "" "ok"
r=$(create "$ADMIN" "{\"username\":\"u$SUF\",\"display_name\":\"Again\",\"password\":\"password123\",\"role\":\"member\"}")
check "second create same username" "$r" "USERNAME_TAKEN"
# 5. success: second admin
r=$(create "$ADMIN" "{\"username\":\"adm$SUF\",\"display_name\":\"Second Admin\",\"password\":\"password123\",\"role\":\"admin\",\"fighter_id\":null}")
check "admin creates second admin" "$r" "\"username\":\"adm$SUF\""
check "second admin role" "$(psql $DB -Atc "select role from public.profiles where username='adm$SUF'")" "admin"
ADM2=$(token "adm$SUF" password123)
r=$(create "$ADM2" "{\"username\":\"v$SUF\",\"display_name\":\"Via Admin Two\",\"password\":\"password123\",\"role\":\"member\"}")
check "second admin can create accounts" "$r" "\"username\":\"v$SUF\""
# 6. deactivated admin cannot
psql $DB -qAtc "update public.profiles set active=false where username='adm$SUF'"
r=$(create "$ADM2" "{\"username\":\"w$SUF\",\"display_name\":\"Nope\",\"password\":\"password123\",\"role\":\"member\"}")
check "deactivated admin rejected" "$r" "NOT_ADMIN"
# 7. CORS preflight
r=$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS "$API/functions/v1/admin-create-user" -H 'Origin: http://localhost:5173' -H 'Access-Control-Request-Method: POST')
check "CORS preflight" "$r" "200"
# cleanup test accounts
psql $DB -qAtc "delete from auth.users where email like '%$SUF@members.uosfight.local'; delete from public.fighters where id='$FID'"
echo "# pass=$pass fail=$fail"; [ $fail -eq 0 ]
