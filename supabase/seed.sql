-- LOCAL DEV SEED ONLY (applied by `supabase db reset`; never by `supabase db push`).
-- Gives you an invite code and a fight card to look at.
--   Sign up at http://localhost:5173/join?code=LOCALDEV
--   Then make yourself admin:  update public.profiles set role = 'admin' where username = 'yourname';

insert into public.invites (code, max_uses, expires_at)
values ('LOCALDEV', 100, now() + interval '30 days')
on conflict (code) do nothing;

insert into public.fighters (id, nickname, weight_kg, catchphrase) values
  ('11111111-1111-4111-8111-111111111111', 'The Hallway Hurricane', 78.5, 'Lights out, quiet hours.'),
  ('22222222-2222-4222-8222-222222222222', 'Mattress Mauler',       84.0, 'I sleep on the mat.'),
  ('33333333-3333-4333-8333-333333333333', 'Laundry Day',           71.2, 'Spin cycle incoming.'),
  ('44444444-4444-4444-8444-444444444444', 'Ramen Ronin',           69.8, 'Two minutes. That is all I need.')
on conflict (id) do nothing;

insert into public.fights (id, title, red_fighter_id, blue_fighter_id, scheduled_at, lock_at, status)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Main Event',
        '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
        now() + interval '2 days', now() + interval '2 days' - interval '15 minutes', 'open')
on conflict (id) do nothing;

insert into public.fight_pools (fight_id)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
on conflict do nothing;
