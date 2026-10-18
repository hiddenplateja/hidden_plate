begin;
-- Queue keys come only from removed database references or the uploader's own
-- DELETE request. Processing/done rows are tombstones against key reuse.
create table public.media_cleanup (
 key text primary key check(key ~ '^(rest|rev|usr|post)/[0-9a-fA-F-]{36}/[a-zA-Z0-9._-]+\.(jpg|png|webp)$'),
 state text not null default 'queued' check(state in ('queued','processing','done')),
 lease_id uuid,lease_owner uuid,lease_until timestamptz,attempts integer not null default 0,
 created_at timestamptz not null default now(),finished_at timestamptz
);
alter table public.media_cleanup enable row level security;
revoke all on public.media_cleanup from public,anon,authenticated;
grant all on public.media_cleanup to service_role;

create or replace function public.row_media_keys(row_value jsonb)
returns text[] language sql immutable set search_path='' as $$
 select coalesce(array_agg(distinct key order by key),'{}') from (select case
   when raw_key like 'https://hidden-plate-pay.hiddenplate-ja.workers.dev/media/%' then
     split_part(split_part(substr(raw_key,length('https://hidden-plate-pay.hiddenplate-ja.workers.dev/media/')+1),'?',1),'#',1) else raw_key end key from (
   select value raw_key from jsonb_array_elements_text(case when jsonb_typeof(row_value->'image_paths')='array'
     then row_value->'image_paths' else '[]'::jsonb end)
   union select row_value->>'cover_image_path' union select row_value->>'plate_image_path' union select row_value->>'avatar_path'
 ) values_to_normalize) x where key ~ '^(rest|rev|usr|post)/[0-9a-fA-F-]{36}/[a-zA-Z0-9._-]+\.(jpg|png|webp)$';
$$;
create or replace function public.media_is_referenced(object_key text)
returns boolean language sql volatile security definer set search_path='' as $$
 select exists(select 1 from public.restaurants where object_key=any(image_paths) or cover_image_path=object_key or plate_image_path=object_key)
 or exists(select 1 from public.reviews where object_key=any(image_paths))
 or exists(select 1 from public.posts where object_key=any(image_paths))
 or exists(select 1 from public.profiles p where object_key=any(public.row_media_keys(jsonb_build_object('avatar_path',p.avatar_path))))
 or exists(select 1 from public.app_config where plate_image_path=object_key);
$$;

create or replace function public.guard_media_reference()
returns trigger language plpgsql security definer set search_path='' as $$
declare object_key text; old_keys text[]:='{}'; begin
 if tg_op='UPDATE' then old_keys:=public.row_media_keys(to_jsonb(old)); end if;
 foreach object_key in array public.row_media_keys(to_jsonb(new)) loop
   if not object_key=any(old_keys) then
     perform pg_advisory_xact_lock(hashtextextended(object_key,17017));
     if exists(select 1 from public.media_cleanup where key=object_key) then raise exception 'This image is being removed. Upload a new image.'; end if;
   end if;
 end loop;
 return new;
end $$;
create or replace function public.enqueue_removed_media()
returns trigger language plpgsql security definer set search_path='' as $$
declare object_key text; new_keys text[]:='{}'; begin
 if tg_op='UPDATE' then new_keys:=public.row_media_keys(to_jsonb(new)); end if;
 foreach object_key in array public.row_media_keys(to_jsonb(old)) loop
   if not object_key=any(new_keys) then
     perform pg_advisory_xact_lock(hashtextextended(object_key,17017));
     insert into public.media_cleanup(key) values(object_key) on conflict(key) do nothing;
   end if;
 end loop;
 return null;
end $$;
do $$ declare tab text; begin
 foreach tab in array array['restaurants','reviews','posts','profiles','app_config'] loop
   execute format('create trigger media_reference_guard before insert or update on public.%I for each row execute function public.guard_media_reference()',tab);
   execute format('create trigger media_removed_queue after update or delete on public.%I for each row execute function public.enqueue_removed_media()',tab);
 end loop;
end $$;

create or replace function public.media_upload_allowed(object_key text)
returns boolean language plpgsql security definer set search_path='' as $$
declare caller uuid:=public.require_active_account(); begin
 return object_key ~ '^(rest|rev|usr|post)/[0-9a-fA-F-]{36}/[a-zA-Z0-9._-]+\.(jpg|png|webp)$'
   and split_part(object_key,'/',2)=caller::text and not exists(select 1 from public.media_cleanup where key=object_key);
end $$;
-- This post-upload check remains available to a recently banned uploader: it
-- reveals only whether their own key is retired, not another user's media.
create or replace function public.media_upload_retired(object_key text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or split_part(object_key,'/',2) is distinct from auth.uid()::text then raise exception 'Only your own image can be checked.'; end if;
 return exists(select 1 from public.media_cleanup where key=object_key);
end $$;
create or replace function public.claim_my_media_cleanup(object_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare caller uuid:=public.require_active_account(); job public.media_cleanup; begin
 if object_key is null or object_key !~ '^(rest|rev|usr|post)/[0-9a-fA-F-]{36}/[a-zA-Z0-9._-]+\.(jpg|png|webp)$'
   or split_part(object_key,'/',2)<>caller::text then raise exception 'Only your own image can be removed.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(object_key,17017));
 if public.media_is_referenced(object_key) then raise exception 'This image is still in use.'; end if;
 insert into public.media_cleanup(key) values(object_key) on conflict(key) do nothing;
 select * into job from public.media_cleanup where key=object_key for update;
 if job.state='done' then return jsonb_build_object('done',true); end if;
 if job.state='processing' and job.lease_until>now() then raise exception 'This image is already being removed.'; end if;
 update public.media_cleanup set state='processing',lease_id=gen_random_uuid(),lease_owner=caller,lease_until=now()+interval '5 minutes',attempts=attempts+1
   where key=object_key returning * into job;
 return jsonb_build_object('key',job.key,'lease_id',job.lease_id);
end $$;
create or replace function public.claim_admin_media_cleanup()
returns jsonb language plpgsql security definer set search_path='' as $$
declare job public.media_cleanup; result jsonb:='[]'; begin
 if not public.is_admin() then raise exception 'Admin access required.'; end if;
 -- Key ordering matches reference/enqueue lock ordering, avoiding queue/key
 -- lock inversion. Contention skips a job; it is not lost.
 for job in select * from public.media_cleanup where state='queued' or (state='processing' and lease_until<=now()) order by key limit 20 loop
   if not pg_try_advisory_xact_lock(hashtextextended(job.key,17017)) then continue; end if;
   select * into job from public.media_cleanup where key=job.key and (state='queued' or (state='processing' and lease_until<=now())) for update skip locked;
   if not found then continue; end if;
   if public.media_is_referenced(job.key) then delete from public.media_cleanup where key=job.key; continue; end if;
   update public.media_cleanup set state='processing',lease_id=gen_random_uuid(),lease_owner=auth.uid(),lease_until=now()+interval '5 minutes',attempts=attempts+1
     where key=job.key returning * into job;
   result:=result||jsonb_build_array(jsonb_build_object('key',job.key,'lease_id',job.lease_id));
 end loop;
 return result;
end $$;
create or replace function public.finish_media_cleanup(object_key text,job_lease uuid)
returns void language plpgsql security definer set search_path='' as $$
declare caller uuid:=public.require_active_account(); begin
 update public.media_cleanup set state='done',finished_at=now(),lease_until=null
   where key=object_key and state='processing' and lease_id=job_lease and lease_owner=caller;
 if not found then raise exception 'Invalid cleanup lease.'; end if;
end $$;
revoke all on function public.row_media_keys(jsonb),public.media_is_referenced(text),public.guard_media_reference(),public.enqueue_removed_media() from public,anon,authenticated;
revoke all on function public.media_upload_allowed(text),public.media_upload_retired(text),public.claim_my_media_cleanup(text),public.claim_admin_media_cleanup(),public.finish_media_cleanup(text,uuid) from public,anon;
grant execute on function public.media_upload_allowed(text),public.media_upload_retired(text),public.claim_my_media_cleanup(text),public.claim_admin_media_cleanup(),public.finish_media_cleanup(text,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
