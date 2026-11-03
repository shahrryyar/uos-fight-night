-- WAVE B privacy fixes (on top of 20261103000005_wave_b.sql).
--
-- 1. user_badges are private to their owner (and admins). perfect_night and
--    sharp_eye are earned from votes, and votes are private (base contract), so
--    letting any member read another user's badges revealed how they voted.
--    Applies to direct SELECT (RLS) and to list_badges('user', ...).
-- 2. Badges and belt reigns of hidden fighters are hidden from non-admins on
--    direct SELECT too, matching fighters_select and list_badges('fighter', ...).

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
drop policy if exists user_badges_select on public.user_badges;
create policy user_badges_select on public.user_badges for select to authenticated
  using ((select public.is_member())
         and (user_id = (select auth.uid()) or (select public.is_admin())));

drop policy if exists fighter_badges_select on public.fighter_badges;
create policy fighter_badges_select on public.fighter_badges for select to authenticated
  using ((select public.is_member())
         and ((select public.is_admin())
              or exists (select 1 from public.fighters f where f.id = fighter_id and not f.hidden)));

drop policy if exists belt_reigns_select on public.belt_reigns;
create policy belt_reigns_select on public.belt_reigns for select to authenticated
  using ((select public.is_member())
         and ((select public.is_admin())
              or exists (select 1 from public.fighters f where f.id = fighter_id and not f.hidden)));

-- ---------------------------------------------------------------------------
-- list_badges: 'user' only for yourself (or an admin); anyone else -> empty.
-- Same signature, return type and grants as wave_b.
-- ---------------------------------------------------------------------------
create or replace function public.list_badges(p_kind text, p_id uuid)
returns table (code text, label text, description text, icon text, times int,
               first_awarded_at timestamptz, last_awarded_at timestamptz, last_fight_id uuid)
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid;
begin
  v_uid := private.require_member();
  if p_kind is null or p_kind not in ('fighter', 'user') then raise exception 'INVALID_KIND'; end if;

  if p_kind = 'fighter' then
    if not public.is_admin() and exists (select 1 from public.fighters f where f.id = p_id and f.hidden) then
      return;
    end if;
    return query
      select c.code, c.label, c.description, c.icon, count(*)::int,
             min(b.awarded_at), max(b.awarded_at),
             (array_agg(b.fight_id order by b.awarded_at desc, b.id desc))[1]
        from public.fighter_badges b
        join public.badge_catalog c on c.code = b.code
       where b.fighter_id = p_id
       group by c.code, c.label, c.description, c.icon, c.sort
       order by c.sort, c.code;
  else
    if p_id is distinct from auth.uid() and not public.is_admin() then
      return;
    end if;
    return query
      select c.code, c.label, c.description, c.icon, count(*)::int,
             min(b.awarded_at), max(b.awarded_at),
             (array_agg(b.fight_id order by b.awarded_at desc, b.id desc))[1]
        from public.user_badges b
        join public.badge_catalog c on c.code = b.code
       where b.user_id = p_id
       group by c.code, c.label, c.description, c.icon, c.sort
       order by c.sort, c.code;
  end if;
end;
$$;

revoke all on function public.list_badges(text, uuid) from public, anon;
grant execute on function public.list_badges(text, uuid) to authenticated;
