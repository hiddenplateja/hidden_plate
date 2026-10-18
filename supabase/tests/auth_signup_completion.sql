-- Non-production regression test. Every fixture is rolled back; no emails sent.
begin;
insert into auth.users (id, aud, role, email, email_confirmed_at, encrypted_password, raw_user_meta_data)
values
 ('f6000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'signup-fixture-a@example.test', now(), 'fixture-not-a-real-password-hash', '{}'),
 ('f6000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'signup-fixture-b@example.test', now(), '', '{}'),
 ('f6000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'signup-fixture-c@example.test', null, 'fixture-not-a-real-password-hash', '{}');
update public.profiles set preferences = '{"notifyOnLike":false,"futureKey":42}'::jsonb
  where id = 'f6000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims', '{"sub":"f6000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  if (select count(*) from public.auth_signup_pending) <> 1 then raise exception 'Pending signup RLS failed'; end if;
  if has_table_privilege('authenticated', 'public.auth_signup_pending', 'INSERT')
    or has_table_privilege('authenticated', 'public.auth_signup_pending', 'UPDATE')
    or has_table_privilege('authenticated', 'public.auth_signup_pending', 'DELETE')
    or has_function_privilege('anon', 'public.finish_auth_signup(text,text,text)', 'EXECUTE') then
    raise exception 'Pending signup privileges failed';
  end if;
  perform public.finish_auth_signup('signup_fixture_a', 'Fixture A', null);
  if exists(select 1 from public.auth_signup_pending) then raise exception 'Completion marker not cleared'; end if;
  if not exists(select 1 from public.profiles where id = auth.uid()
    and username = 'signup_fixture_a' and preferences ->> 'futureKey' = '42'
    and preferences ->> 'notifyOnLike' = 'false' and preferences ->> 'onboardingPending' = 'true') then
    raise exception 'Completed profile/preferences incorrect';
  end if;
  begin
    perform public.finish_auth_signup('changed_again', 'Not allowed', null);
    raise exception 'Completion was not one-shot';
  exception when raise_exception then
    if sqlerrm not like 'This account is already set up.%' then raise; end if;
  end;
end;
$$;
select set_config('request.jwt.claims', '{"sub":"f6000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $$ begin
  begin
    perform public.finish_auth_signup('signup_fixture_b', 'Fixture B', null);
    raise exception 'Missing password accepted';
  exception when raise_exception then
    if sqlerrm not like 'Verify your email and set a password%' then raise; end if;
  end;
end $$;
select set_config('request.jwt.claims', '{"sub":"f6000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
do $$ begin
  begin
    perform public.finish_auth_signup('signup_fixture_c', 'Fixture C', null);
    raise exception 'Unverified email accepted';
  exception when raise_exception then
    if sqlerrm not like 'Verify your email and set a password%' then raise; end if;
  end;
end $$;
reset role;
rollback;
