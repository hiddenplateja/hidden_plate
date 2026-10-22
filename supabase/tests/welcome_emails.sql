begin;
create function pg_temp.ok(result boolean,message text)returns void language plpgsql as $$begin if result is distinct from true then raise exception '%',message;end if;end $$;
insert into auth.users(id,email,email_confirmed_at,encrypted_password)values
 ('fa280000-0000-4000-8000-000000000001','welcome@example.test',now(),'fixture-hash'),
 ('fa280000-0000-4000-8000-000000000002','abandoned@example.test',now(),'fixture-hash');
select pg_temp.ok(not exists(select 1 from public.welcome_email_jobs),'OTP/identity creation must not queue welcome');
select pg_temp.ok(public.classify_signup_password_email('fixture-initial','fa280000-0000-4000-8000-000000000001',repeat('a',64)),'pending signup password should not send changed alert');
select set_config('request.jwt.claim.sub','fa280000-0000-4000-8000-000000000001',true);
select public.finish_auth_signup('welcome_test','Welcome Test',null);
select pg_temp.ok((select count(*)=1 from public.welcome_email_jobs),'completion must queue exactly one welcome');
select pg_temp.ok(public.classify_signup_password_email('fixture-initial','fa280000-0000-4000-8000-000000000001',repeat('a',64)),'retry must preserve original suppression after signup completes');
select pg_temp.ok(not public.classify_signup_password_email('fixture-change','fa280000-0000-4000-8000-000000000001',repeat('b',64)),'completed password change must retain alert');
do $$begin
 begin perform public.classify_signup_password_email('fixture-initial','fa280000-0000-4000-8000-000000000001',repeat('c',64));raise exception 'Expected mismatch rejection';
 exception when others then if sqlerrm='Expected mismatch rejection'then raise;end if;end;
end $$;
select pg_temp.ok(not exists(select 1 from public.claim_welcome_emails()),'delivery starts disabled');
update public.welcome_email_settings set enabled=true where id;
create temp table leases as select * from public.claim_welcome_emails();
select pg_temp.ok((select count(*)=1 from leases),'one job claim');
select pg_temp.ok(not exists(select 1 from public.claim_welcome_emails()),'active lease prevents duplicate claim');
do $$begin
 begin perform public.finish_welcome_email('fa280000-0000-4000-8000-000000000001',gen_random_uuid(),'sent');raise exception 'Expected lease rejection';
 exception when others then if sqlerrm='Expected lease rejection'then raise;end if;end;
end $$;
select public.finish_welcome_email(user_id,lease_id,'sent')from leases;
select pg_temp.ok(not exists(select 1 from public.claim_welcome_emails()),'sent welcome cannot be resent');
delete from public.profiles where id='fa280000-0000-4000-8000-000000000002';
select pg_temp.ok(not exists(select 1 from public.welcome_email_jobs where user_id='fa280000-0000-4000-8000-000000000002'),'abandoned-account deletion must not queue welcome');
select pg_temp.ok(not has_table_privilege('authenticated','public.welcome_email_jobs','SELECT')and not has_table_privilege('anon','public.auth_email_password_events','SELECT'),'email state must stay private');
select pg_temp.ok(not has_function_privilege('authenticated','public.classify_signup_password_email(text,uuid,text)','EXECUTE')and not has_function_privilege('anon','public.claim_welcome_emails()','EXECUTE'),'clients cannot suppress security alerts or claim mail');
delete from public.profiles where id='fa280000-0000-4000-8000-000000000001';
select pg_temp.ok(not exists(select 1 from public.welcome_email_jobs)and not exists(select 1 from public.auth_email_password_events),'account deletion cleans up private email state');
-- Synthetic transport failure cannot undo signup; the queue remains retryable.
create or replace function public.dispatch_welcome_emails()returns bigint language plpgsql security definer set search_path=''as $$begin raise exception 'Synthetic transport failure';end $$;
insert into auth.users(id,email,email_confirmed_at,encrypted_password)values('fa280000-0000-4000-8000-000000000003','retry@example.test',now(),'fixture-hash');
select set_config('request.jwt.claim.sub','fa280000-0000-4000-8000-000000000003',true);
select public.finish_auth_signup('welcome_retry','Welcome Retry',null);
select pg_temp.ok(not exists(select 1 from public.auth_signup_pending where user_id='fa280000-0000-4000-8000-000000000003'),'transport error cannot undo completed signup');
select pg_temp.ok(exists(select 1 from public.welcome_email_jobs where user_id='fa280000-0000-4000-8000-000000000003'and state='pending'),'transport error must retain retry job');
rollback;
