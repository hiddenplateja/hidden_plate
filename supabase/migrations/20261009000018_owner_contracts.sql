begin;

-- Replies are displayed only while their author is the current active owner.
-- Former owners retain deletion rights, but cannot edit a restaurant's replies.
create table public.review_responses (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  text text not null check (length(btrim(text)) between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (review_id,author_id)
);
create index review_responses_restaurant_idx on public.review_responses(restaurant_id);
create index review_responses_author_idx on public.review_responses(author_id);
alter table public.review_responses enable row level security;
revoke all on public.review_responses from public,anon,authenticated;
grant select on public.review_responses to anon,authenticated;
grant all on public.review_responses to service_role;
create policy "current owner replies readable" on public.review_responses for select to anon,authenticated
  using (exists (select 1 from public.reviews r where r.id=review_id
    and r.restaurant_id=review_responses.restaurant_id and not r.is_hidden)
    and exists (select 1 from public.restaurants r where r.id=restaurant_id and r.owner_id=author_id)
    and exists (select 1 from public.public_profiles p where p.id=author_id and not p.is_banned));

create function public.write_owner_response(target_review uuid default null,
  target_restaurant uuid default null,response_text text default null,response_id uuid default null)
returns public.review_responses language plpgsql security definer set search_path='' as $$
declare caller uuid:=public.require_active_account(); parent uuid; restaurant uuid;
  existing public.review_responses; result public.review_responses; body text:=btrim(response_text);
begin
  if body is null or length(body) not between 1 and 1000 then raise exception 'Replies must be 1–1000 characters.'; end if;
  if response_id is not null then
    select * into existing from public.review_responses where id=response_id;
    if not found or existing.author_id<>caller then raise exception 'Reply not found or not yours.'; end if;
    if (target_review is not null and target_review<>existing.review_id)
      or (target_restaurant is not null and target_restaurant<>existing.restaurant_id) then
      raise exception 'A reply cannot be moved.';
    end if;
    parent:=existing.review_id;
  else parent:=target_review; end if;
  select r.restaurant_id into restaurant from public.reviews r where r.id=parent and not r.is_hidden;
  if not found or (target_restaurant is not null and target_restaurant<>restaurant) then
    raise exception 'Review not found.';
  end if;
  -- Shares the ownership-transfer lock; a stale client cannot reply as an old owner.
  perform 1 from public.restaurants r where r.id=restaurant and r.owner_id=caller for update;
  if not found then raise exception 'Only the current restaurant owner can reply.'; end if;
  if not exists(select 1 from public.reviews r where r.id=parent and r.restaurant_id=restaurant and not r.is_hidden) then
    raise exception 'Review not found.';
  end if;
  if response_id is null then
    insert into public.review_responses(review_id,restaurant_id,author_id,text)
      values(parent,restaurant,caller,body) returning * into result;
  else
    update public.review_responses set text=body,updated_at=now()
      where id=response_id and author_id=caller returning * into result;
    if not found then raise exception 'Reply not found or not yours.'; end if;
  end if;
  return result;
end $$;
create function public.delete_owner_response(response_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare caller uuid:=public.require_active_account(); begin
  delete from public.review_responses where id=response_id and (author_id=caller or public.is_admin());
  if not found then raise exception 'Reply not found or not yours.'; end if;
end $$;
revoke all on function public.write_owner_response(uuid,uuid,text,uuid),public.delete_owner_response(uuid) from public,anon;
grant execute on function public.write_owner_response(uuid,uuid,text,uuid),public.delete_owner_response(uuid) to authenticated;

-- No client may enumerate viewers or supply someone else's user ID.
create table public.restaurant_views (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(restaurant_id,user_id)
);
create index restaurant_views_user_idx on public.restaurant_views(user_id);
alter table public.restaurant_views enable row level security;
revoke all on public.restaurant_views from public,anon,authenticated;
grant all on public.restaurant_views to service_role;
create function public.record_restaurant_view(target_restaurant uuid)
returns void language plpgsql security definer set search_path='' as $$
declare caller uuid:=public.require_active_account(); begin
  if not exists(select 1 from public.restaurants where id=target_restaurant and is_active) then
    raise exception 'Restaurant not found.';
  end if;
  insert into public.restaurant_views(restaurant_id,user_id) values(target_restaurant,caller) on conflict do nothing;
end $$;
create function public.restaurant_view_count(target_restaurant uuid)
returns bigint language plpgsql security definer set search_path='' as $$
declare caller uuid:=public.require_active_account(); result bigint; begin
  if not exists(select 1 from public.restaurants where id=target_restaurant and (owner_id=caller or public.is_admin())) then
    raise exception 'Owner or admin access required.';
  end if;
  select count(*) into result from public.restaurant_views where restaurant_id=target_restaurant;
  return result;
end $$;
revoke all on function public.record_restaurant_view(uuid),public.restaurant_view_count(uuid) from public,anon;
grant execute on function public.record_restaurant_view(uuid),public.restaurant_view_count(uuid) to authenticated;

-- Row locking merges independent concurrent changes without replacing settings.
create function public.merge_my_preferences(preference_patch jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare caller uuid:=public.require_active_account(); current_prefs jsonb; result jsonb; k text; v jsonb;
begin
  if preference_patch is null or jsonb_typeof(preference_patch)<>'object' or octet_length(preference_patch::text)>65536 then
    raise exception 'Invalid settings update.';
  end if;
  for k,v in select key,value from jsonb_each(preference_patch) loop
    if k in ('notificationsEnabled','notifyOnLike','notifyOnComment','notifyOnFollow','notifyOnBroadcast','onboardingPending') then
      if jsonb_typeof(v)<>'boolean' then raise exception 'Invalid settings update.'; end if;
    elsif k in ('favoriteCuisines','favoriteParishes','seenBadgeIds') then
      if k='seenBadgeIds' and v='null'::jsonb then continue; end if;
      if jsonb_typeof(v)<>'array' then raise exception 'Invalid settings update.'; end if;
      if jsonb_array_length(v)>1000 or exists(select 1 from jsonb_array_elements(v) a
        where jsonb_typeof(a)<>'string' or length(a#>>'{}')>100) then raise exception 'Invalid settings update.'; end if;
      if k='favoriteParishes' and exists(select 1 from jsonb_array_elements_text(v) p where p not in
        ('kingston','st_andrew','st_thomas','portland','st_mary','st_ann','trelawny','st_james','hanover',
         'westmoreland','st_elizabeth','manchester','clarendon','st_catherine')) then raise exception 'Invalid settings update.'; end if;
    elsif k in ('usernameChangedAt','displayNameChangedAt') then
      if v='null'::jsonb then continue; end if;
      if jsonb_typeof(v)<>'string' or length(v#>>'{}')>100 then raise exception 'Invalid settings update.'; end if;
      begin perform (v#>>'{}')::timestamptz; exception when invalid_datetime_format or datetime_field_overflow then
        raise exception 'Invalid settings update.'; end;
    else raise exception 'Invalid settings update.'; end if;
  end loop;
  select preferences into current_prefs from public.profiles where id=caller for update;
  result:=coalesce(current_prefs,'{}'::jsonb)||preference_patch;
  if octet_length(result::text)>65536 then raise exception 'Invalid settings update.'; end if;
  update public.profiles set preferences=result where id=caller;
  return result;
end $$;
revoke update(preferences) on public.profiles from public,anon,authenticated;
revoke all on function public.merge_my_preferences(jsonb) from public,anon;
grant execute on function public.merge_my_preferences(jsonb) to authenticated;

notify pgrst,'reload schema';
commit;
