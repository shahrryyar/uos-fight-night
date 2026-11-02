-- UoS Fight Night — pg_cron jobs, realtime publication, storage bucket + policies.

-- ---------------------------------------------------------------------------
-- pg_cron (Supabase installs it into pg_catalog; jobs live in schema cron)
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;

-- cron.schedule(name, ...) upserts by job name, so re-running is safe.
select cron.schedule('auto-lock', '* * * * *', $$select private.auto_lock_fights();$$);
-- Mon 00:00 Asia/Baghdad (UTC+3, no DST) = Sun 21:00 UTC
select cron.schedule('weekly-points', '0 21 * * 0', $$select private.weekly_points();$$);

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'fights') then
    alter publication supabase_realtime add table public.fights;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'fight_pools') then
    alter publication supabase_realtime add table public.fight_pools;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reactions') then
    alter publication supabase_realtime add table public.reactions;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Storage: private bucket fighter-photos (5MB, images only)
-- Members read via signed URLs (createSignedUrl needs SELECT on the object).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fighter-photos', 'fighter-photos', false, 5242880,
        array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "fighter_photos_member_select" on storage.objects;
drop policy if exists "fighter_photos_admin_insert" on storage.objects;
drop policy if exists "fighter_photos_admin_update" on storage.objects;
drop policy if exists "fighter_photos_admin_delete" on storage.objects;

create policy "fighter_photos_member_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'fighter-photos' and (select public.is_member()));

create policy "fighter_photos_admin_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'fighter-photos'
    and (select public.is_admin())
    and (storage.foldername(name))[1] = 'fighters'
  );

create policy "fighter_photos_admin_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'fighter-photos' and (select public.is_admin()))
  with check (
    bucket_id = 'fighter-photos'
    and (select public.is_admin())
    and (storage.foldername(name))[1] = 'fighters'
  );

create policy "fighter_photos_admin_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'fighter-photos' and (select public.is_admin()));
