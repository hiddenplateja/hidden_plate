-- Disposable fixtures only; no emails or persistent users. Roll back every write.
begin;
insert into auth.users (id, aud, role, email, email_confirmed_at, encrypted_password, raw_user_meta_data)
values
 ('f7000000-0000-4000-8000-000000000001','authenticated','authenticated','profile-fixture-a@example.test',now(),'not-a-real-hash','{"keep":"yes"}'),
 ('f7000000-0000-4000-8000-000000000002','authenticated','authenticated','profile-fixture-b@example.test',now(),'not-a-real-hash','{}'),
 ('f7000000-0000-4000-8000-000000000003','authenticated','authenticated','profile-fixture-c@example.test',now(),'not-a-real-hash','{}'),
 ('f7000000-0000-4000-8000-000000000004','authenticated','authenticated','profile-fixture-d@example.test',now(),'not-a-real-hash','{}');
delete from public.auth_signup_pending where user_id in
 ('f7000000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000002','f7000000-0000-4000-8000-000000000003');
update public.profiles set username = 'profile_fixture_a', display_name = 'Fixture A', role = 'admin', created_at = '2098-01-01'
 where id = 'f7000000-0000-4000-8000-000000000001';
update public.profiles set username = 'profile_fixture_b', display_name = 'Fixture B', preferences = '{"privateFixture":42}', created_at = '2099-01-01'
 where id = 'f7000000-0000-4000-8000-000000000002';
update public.profiles set username = 'profile_fixture_c', display_name = 'Fixture C', created_at = '2099-01-01'
 where id = 'f7000000-0000-4000-8000-000000000003';
insert into public.push_tokens (user_id, token, platform)
 values ('f7000000-0000-4000-8000-000000000002', 'ExpoPushToken[profilefixture]', 'android');
insert into public.blocks (blocker_id, blocked_id) values
 ('f7000000-0000-4000-8000-000000000002','f7000000-0000-4000-8000-000000000003');
select set_config('request.jwt.claims','{"sub":"f7000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
do $$ begin
  if public.is_admin() then raise exception 'Member granted admin'; end if;
  if exists (select 1 from public.profiles where id <> auth.uid()) then raise exception 'Private profile RLS leak'; end if;
  if not exists (select 1 from public.public_profiles where id = 'f7000000-0000-4000-8000-000000000003') then
    raise exception 'Public profiles unavailable'; end if;
  if exists (select 1 from public.public_profiles where id = 'f7000000-0000-4000-8000-000000000004') then
    raise exception 'Provisional signup exposed'; end if;
  if has_column_privilege('authenticated','public.profiles','role','UPDATE')
    or has_column_privilege('authenticated','public.profiles','is_banned','UPDATE')
    or has_column_privilege('authenticated','public.profiles','username','UPDATE')
    or has_table_privilege('authenticated','public.profiles','DELETE') then raise exception 'Profile grants unsafe'; end if;
  begin update public.profiles set role = 'admin' where id = auth.uid();
    raise exception 'Self-promotion allowed'; exception when insufficient_privilege then null; end;
  begin perform public.admin_set_user_banned('f7000000-0000-4000-8000-000000000003',true);
    raise exception 'Member ban allowed'; exception when raise_exception then
    if sqlerrm <> 'Admin access required.' then raise; end if; end;
  begin perform public.admin_list_profiles(null,30);
    raise exception 'Member admin browse allowed'; exception when raise_exception then
    if sqlerrm <> 'Admin access required.' then raise; end if; end;
  begin perform public.update_my_profile('{"role":"admin"}');
    raise exception 'RPC role escalation'; exception when raise_exception then
    if sqlerrm <> 'Invalid profile update.' then raise; end if; end;
  begin perform public.update_my_profile('{"avatar_path":"usr/f7000000-0000-4000-8000-000000000003/other.jpg"}');
    raise exception 'Foreign avatar allowed'; exception when raise_exception then
    if sqlerrm <> 'Invalid profile photo.' then raise; end if; end;
  begin perform public.update_my_profile('{"username":"PROFILE_FIXTURE_C"}');
    raise exception 'Duplicate username allowed'; exception when raise_exception then
    if sqlerrm <> 'That username is already taken.' then raise; end if; end;
  begin perform public.update_my_profile(jsonb_build_object('bio',repeat('x',281)));
    raise exception 'Overlong bio allowed'; exception when raise_exception then
    if sqlerrm <> 'Bio must be 280 characters or less' then raise; end if; end;
  begin perform public.update_my_profile('{"display_name":"x"}');
    raise exception 'Short name allowed'; exception when raise_exception then
    if sqlerrm <> 'Display name must be 2–50 characters.' then raise; end if; end;
  perform public.update_my_profile('{"username":" NEW_FIXTURE_B ","display_name":" New Fixture B ","bio":null,"avatar_path":"usr/f7000000-0000-4000-8000-000000000002/avatar.jpg"}');
  if not exists (select 1 from public.profiles where id = auth.uid() and username = 'new_fixture_b'
    and display_name = 'New Fixture B' and preferences->>'privateFixture' = '42' and role <> 'admin') then
    raise exception 'Profile update mapping/preservation failed'; end if;
  perform public.merge_my_preferences('{"notifyOnLike":false}'::jsonb);
  if (select count(*) from public.search_public_profiles('@new_fixture')) <> 1 then raise exception 'Prefix search failed'; end if;
  if exists (select 1 from public.search_public_profiles('%')) then raise exception 'Wildcard search accepted'; end if;
  if exists (select 1 from public.suggest_public_profiles(10) where id = auth.uid() or is_banned) then raise exception 'Unsafe suggestions'; end if;
  if exists (select 1 from public.suggest_public_profiles(100) where id = 'f7000000-0000-4000-8000-000000000003') then
    raise exception 'Blocked suggestion returned'; end if;
end $$;
select set_config('request.jwt.claims','{"sub":"f7000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$ declare ids uuid[]; begin
  if not public.is_admin() then raise exception 'Admin check failed'; end if;
  select array_agg(id) into ids from public.admin_list_profiles(null,1);
  if ids <> array['f7000000-0000-4000-8000-000000000003'::uuid,'f7000000-0000-4000-8000-000000000002'::uuid] then
    raise exception 'Tied timestamp pagination failed'; end if;
  select array_agg(id) into ids from public.admin_list_profiles('f7000000-0000-4000-8000-000000000003',1);
  if ids[1] <> 'f7000000-0000-4000-8000-000000000002'::uuid then raise exception 'Next page skipped user'; end if;
  begin perform public.admin_set_user_banned(auth.uid(),true);
    raise exception 'Self-ban allowed'; exception when raise_exception then
    if sqlerrm <> 'You cannot suspend your own account.' then raise; end if; end;
  perform public.admin_set_user_banned('f7000000-0000-4000-8000-000000000002',true);
  if not exists (select 1 from public.profiles where id = 'f7000000-0000-4000-8000-000000000002' and is_banned) then
    raise exception 'Ban failed'; end if;
  perform public.admin_set_user_banned('f7000000-0000-4000-8000-000000000002',false);
  if exists (select 1 from public.profiles where id = 'f7000000-0000-4000-8000-000000000002' and is_banned) then
    raise exception 'Unban failed'; end if;
  perform public.admin_set_user_banned('f7000000-0000-4000-8000-000000000002',true);
  perform public.admin_set_user_banned('f7000000-0000-4000-8000-000000000003',true);
end $$;
select set_config('request.jwt.claims','{"sub":"f7000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$ begin
  begin perform public.update_my_profile('{"display_name":"Banned edit"}');
    raise exception 'Banned profile write allowed'; exception when raise_exception then
    if sqlerrm <> 'This account has been suspended.' then raise; end if; end;
end $$;
reset role;
update public.profiles set role = 'admin' where id = 'f7000000-0000-4000-8000-000000000003';
select set_config('request.jwt.claims','{"sub":"f7000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
do $$ begin if public.is_admin() then raise exception 'Banned admin authorized'; end if; end $$;
select set_config('request.jwt.claims','{"sub":"f7000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
do $$ begin
  begin perform public.update_my_profile('{"display_name":"Bypass signup"}');
    raise exception 'Pending profile bypass'; exception when raise_exception then
    if sqlerrm <> 'Finish creating your account first.' then raise; end if; end;
end $$;
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$ begin
  if public.is_admin() then raise exception 'Anonymous admin'; end if;
  if has_table_privilege('anon','public.profiles','SELECT') or
    has_function_privilege('anon','public.update_my_profile(jsonb)','EXECUTE') or
    has_function_privilege('anon','public.admin_set_user_banned(uuid,boolean)','EXECUTE') then
    raise exception 'Anonymous private access'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public'
    and table_name = 'public_profiles' and column_name in ('role','preferences','email')) then
    raise exception 'Public view exposes private fields'; end if;
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.push_tokens where user_id = 'f7000000-0000-4000-8000-000000000002') then
    raise exception 'Banned push token retained'; end if;
  if not exists (select 1 from auth.users where id = 'f7000000-0000-4000-8000-000000000002'
    and raw_user_meta_data->>'display_name' = 'New Fixture B') then raise exception 'Auth display name not synced'; end if;
end $$;
rollback;
