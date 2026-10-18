begin;

-- A server-owned marker, not editable user_metadata/preferences. Existing test
-- profiles remain complete; only identities created after this migration wait.
create table if not exists public.auth_signup_pending (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.auth_signup_pending enable row level security;
revoke all on public.auth_signup_pending from public, anon, authenticated;
grant select on public.auth_signup_pending to authenticated;
grant all on public.auth_signup_pending to service_role;
create policy "read own pending signup" on public.auth_signup_pending
  for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, username, display_name, preferences)
  values (
    new.id,
    'user_' || right(replace(new.id::text, '-', ''), 15),
    left(coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''),
      nullif(new.raw_user_meta_data ->> 'full_name', ''), 'New member'), 50),
    jsonb_build_object('onboardingPending', true, 'notificationsEnabled', true,
      'notifyOnLike', true, 'notifyOnComment', true, 'notifyOnFollow', true, 'notifyOnBroadcast', true)
  );
  insert into public.auth_signup_pending (user_id) values (new.id);
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

create or replace function public.finish_auth_signup(
  chosen_username text, chosen_display_name text, chosen_avatar text default null
)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  confirmed timestamptz;
  password_hash text;
  has_social_identity boolean;
begin
  if caller is null then raise exception 'Verify your email or sign in first.'; end if;
  -- Lock makes completion one-shot, including concurrent calls.
  perform 1 from public.auth_signup_pending where user_id = caller for update;
  if not found then raise exception 'This account is already set up. Please sign in.'; end if;
  select email_confirmed_at, encrypted_password into confirmed, password_hash
    from auth.users where id = caller;
  select exists(select 1 from auth.identities where user_id = caller and provider in ('google', 'apple'))
    into has_social_identity;
  if confirmed is null or (not has_social_identity and coalesce(password_hash, '') = '') then
    raise exception 'Verify your email and set a password before finishing signup.';
  end if;
  if chosen_username is null or chosen_username !~ '^[a-z0-9_]{3,20}$'
    or chosen_display_name is null or length(btrim(chosen_display_name)) not between 2 and 50 then
    raise exception 'Check your username and display name.';
  end if;
  if chosen_avatar is not null and (length(chosen_avatar) > 2048 or chosen_avatar !~ '^https://') then
    raise exception 'Invalid profile photo.';
  end if;
  if exists(select 1 from public.profiles where id = caller and is_banned) then
    raise exception 'This account has been suspended.';
  end if;
  begin
    update public.profiles set username = chosen_username, display_name = btrim(chosen_display_name),
      avatar_path = chosen_avatar,
      preferences = coalesce(preferences, '{}'::jsonb) || '{"onboardingPending":true}'::jsonb
    where id = caller;
    if not found then raise exception 'Profile not found.'; end if;
  exception when unique_violation then
    raise exception 'That username is already taken.';
  end;
  delete from public.auth_signup_pending where user_id = caller;
end;
$$;
revoke all on function public.finish_auth_signup(text,text,text) from public, anon;
grant execute on function public.finish_auth_signup(text,text,text) to authenticated;
commit;
