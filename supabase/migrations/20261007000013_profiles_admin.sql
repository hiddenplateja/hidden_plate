begin;

-- Role checks are server-owned. Banning an admin also removes its authority.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid()
    and p.role = 'admin' and not p.is_banned
    and not exists (select 1 from public.auth_signup_pending s where s.user_id = p.id));
$$;
revoke all on function public.is_admin() from public, anon;
-- Anonymous read policies elsewhere may call it; auth.uid() is null -> false.
grant execute on function public.is_admin() to anon, authenticated;

-- Public projection deliberately excludes role, preferences and auth email.
-- The view owner reads through RLS; consumers can access only this projection.
alter view public.public_profiles set (security_invoker = false, security_barrier = true);
create or replace view public.public_profiles
with (security_invoker = false, security_barrier = true) as
  select p.id, p.username, p.display_name, p.avatar_path, p.bio, p.is_banned, p.created_at
  from public.profiles p
  where not exists (select 1 from public.auth_signup_pending s where s.user_id = p.id);
revoke all on public.public_profiles from public, anon, authenticated;
grant select on public.public_profiles to anon, authenticated;

-- Remove table AND any existing column-level write grants. No mobile caller,
-- including an admin, may assign roles or bypass the bounded write functions.
revoke all on public.profiles from public, anon, authenticated;
do $$ declare cols text; begin
  select string_agg(quote_ident(column_name), ', ') into cols
    from information_schema.columns where table_schema = 'public' and table_name = 'profiles';
  execute 'revoke insert (' || cols || '), update (' || cols || '), references (' || cols ||
    ') on public.profiles from public, anon, authenticated';
end $$;
grant select on public.profiles to authenticated;
grant update (preferences) on public.profiles to authenticated;
drop policy if exists "profiles readable" on public.profiles;
drop policy if exists "profiles update own" on public.profiles;
create policy "profiles private read" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));
create policy "profiles preferences own" on public.profiles for update to authenticated
  using (id = (select auth.uid()) and not is_banned
    and not exists (select 1 from public.auth_signup_pending s where s.user_id = id))
  with check (id = (select auth.uid()) and not is_banned);

create or replace function public.update_my_profile(profile_patch jsonb)
returns setof public.public_profiles
language plpgsql security definer set search_path = ''
as $$
declare caller uuid := auth.uid(); current_profile public.profiles; next_username text;
  next_name text; next_bio text; next_avatar text;
begin
  if caller is null then raise exception 'You must be signed in.'; end if;
  select * into current_profile from public.profiles where id = caller for update;
  if not found then raise exception 'Profile not found.'; end if;
  if current_profile.is_banned then raise exception 'This account has been suspended.'; end if;
  if exists (select 1 from public.auth_signup_pending where user_id = caller) then
    raise exception 'Finish creating your account first.';
  end if;
  if profile_patch is null or jsonb_typeof(profile_patch) <> 'object'
    or exists (select 1 from jsonb_object_keys(profile_patch) k
      where k not in ('username', 'display_name', 'bio', 'avatar_path')) then
    raise exception 'Invalid profile update.';
  end if;
  next_username := current_profile.username; next_name := current_profile.display_name;
  next_bio := current_profile.bio; next_avatar := current_profile.avatar_path;
  if profile_patch ? 'username' then
    if jsonb_typeof(profile_patch->'username') <> 'string' then raise exception 'Invalid username.'; end if;
    next_username := lower(btrim(profile_patch->>'username'));
    if next_username !~ '^[a-z0-9_]{3,20}$' then raise exception '3–20 chars: lowercase letters, numbers, underscore'; end if;
  end if;
  if profile_patch ? 'display_name' then
    if jsonb_typeof(profile_patch->'display_name') <> 'string' then raise exception 'Invalid display name.'; end if;
    next_name := btrim(profile_patch->>'display_name');
    if length(next_name) not between 2 and 50 then raise exception 'Display name must be 2–50 characters.'; end if;
  end if;
  if profile_patch ? 'bio' then
    if jsonb_typeof(profile_patch->'bio') not in ('string', 'null') then raise exception 'Invalid bio.'; end if;
    next_bio := profile_patch->>'bio';
    if length(coalesce(next_bio, '')) > 280 then raise exception 'Bio must be 280 characters or less'; end if;
  end if;
  if profile_patch ? 'avatar_path' then
    if jsonb_typeof(profile_patch->'avatar_path') not in ('string', 'null') then raise exception 'Invalid profile photo.'; end if;
    next_avatar := profile_patch->>'avatar_path';
    if next_avatar is not null and (length(next_avatar) > 2048 or
      (next_avatar !~ '^https://[^[:space:]]+$' and
       next_avatar !~ ('^usr/' || caller::text || '/[A-Za-z0-9_-]+\.(jpg|png|webp)$'))) then
      raise exception 'Invalid profile photo.';
    end if;
  end if;
  begin
    update public.profiles set username = next_username, display_name = next_name,
      bio = next_bio, avatar_path = next_avatar where id = caller;
  exception when unique_violation then raise exception 'That username is already taken.'; end;
  -- Auth name is only a convenience for emails; role/authorization never use metadata.
  if profile_patch ? 'display_name' then
    update auth.users set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
      || jsonb_build_object('display_name', next_name, 'full_name', next_name) where id = caller;
  end if;
  return query select * from public.public_profiles where id = caller;
end;
$$;

create or replace function public.admin_list_profiles(after_id uuid default null, page_size integer default 30)
returns setof public.public_profiles
language plpgsql security definer set search_path = ''
as $$
declare after_created timestamptz;
begin
  if not public.is_admin() then raise exception 'Admin access required.'; end if;
  if page_size is null or page_size not between 1 and 100 then raise exception 'Invalid page size.'; end if;
  if after_id is not null then
    select created_at into after_created from public.public_profiles where id = after_id;
    if not found then raise exception 'Invalid user cursor. Refresh the list.'; end if;
  end if;
  return query select p.* from public.public_profiles p
    where after_id is null or (p.created_at, p.id) < (after_created, after_id)
    order by p.created_at desc, p.id desc limit page_size + 1;
end;
$$;

create or replace function public.admin_set_user_banned(target_id uuid, banned boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admin access required.'; end if;
  if target_id is null or banned is null then raise exception 'Invalid user update.'; end if;
  -- Prevent accidental self-lockout; assigning/removing admin roles stays console-only.
  if target_id = auth.uid() then raise exception 'You cannot suspend your own account.'; end if;
  perform 1 from public.profiles where id = target_id for update;
  if not found then raise exception 'User not found.'; end if;
  update public.profiles set is_banned = banned where id = target_id;
  if banned then
    -- Remove registered push destinations as soon as a profile is banned.
    delete from public.push_tokens where user_id = target_id;
  end if;
end;
$$;

create or replace function public.search_public_profiles(search_text text)
returns setof public.public_profiles
language plpgsql stable security definer set search_path = ''
as $$
declare needle text := lower(btrim(coalesce(search_text, '')));
begin
  if auth.uid() is null then raise exception 'You must be signed in.'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and not is_banned)
    or exists (select 1 from public.auth_signup_pending where user_id = auth.uid()) then
    raise exception 'Finish creating an active account first.';
  end if;
  if left(needle, 1) = '@' then needle := substr(needle, 2); end if;
  if length(needle) < 2 then return; end if;
  if length(needle) > 100 then raise exception 'Search is too long.'; end if;
  -- Literal token-prefix comparison: %, commas and parentheses are not filters.
  return query select p.* from public.public_profiles p
    where starts_with(lower(p.username), needle)
      or not exists (select 1 from regexp_split_to_table(needle, '\s+') q
        where not exists (select 1 from regexp_split_to_table(lower(p.display_name), '\s+') word
          where starts_with(word, q)))
    order by starts_with(lower(p.username), needle) desc, p.username, p.id limit 40;
end;
$$;

create or replace function public.suggest_public_profiles(result_limit integer default 10)
returns setof public.public_profiles
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid() and not is_banned)
    or exists (select 1 from public.auth_signup_pending where user_id = auth.uid()) then
    raise exception 'You must be signed in to an active account.';
  end if;
  if result_limit is null or result_limit not between 1 and 100 then raise exception 'Invalid suggestion limit.'; end if;
  return query with recent as (
    select following_id from public.follows order by created_at desc, follower_id, following_id limit 500
  ), counts as (select following_id, count(*) as followers from recent group by following_id)
  select p.* from public.public_profiles p left join counts c on c.following_id = p.id
    where p.id <> auth.uid() and not p.is_banned
      and not exists (select 1 from public.blocks b where
        (b.blocker_id = auth.uid() and b.blocked_id = p.id)
        or (b.blocked_id = auth.uid() and b.blocker_id = p.id))
    order by coalesce(c.followers, 0) desc, p.created_at desc, p.id desc limit result_limit;
end;
$$;

revoke all on function public.update_my_profile(jsonb),
  public.admin_list_profiles(uuid, integer), public.admin_set_user_banned(uuid, boolean),
  public.search_public_profiles(text), public.suggest_public_profiles(integer)
  from public, anon;
grant execute on function public.update_my_profile(jsonb),
  public.admin_list_profiles(uuid, integer), public.admin_set_user_banned(uuid, boolean),
  public.search_public_profiles(text), public.suggest_public_profiles(integer)
  to authenticated;
notify pgrst, 'reload schema';
commit;
