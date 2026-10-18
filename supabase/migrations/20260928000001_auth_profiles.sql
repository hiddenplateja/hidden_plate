-- Auth/profile foundation applied to the Supabase project on 2026-09-28.
-- Keep this migration with the app so a fresh project can reproduce it.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, display_name, preferences)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'username', ''), 'user_' || left(new.id::text, 8)),
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(coalesce(new.email, 'there'), '@', 1)),
    jsonb_build_object(
      'onboardingPending', true,
      'notificationsEnabled', true,
      'notifyOnLike', true,
      'notifyOnComment', true,
      'notifyOnFollow', true,
      'notifyOnBroadcast', true
    )
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

insert into public.app_config (id) values (true) on conflict (id) do nothing;
insert into public.app_control (id, maintenance) values (true, false)
  on conflict (id) do nothing;

create or replace view public.public_profiles
with (security_invoker = true) as
  select id, username, display_name, avatar_path, bio, created_at
  from public.profiles;
