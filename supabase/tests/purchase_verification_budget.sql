-- Local only, after migration 26. All fake accounts/counters roll back.
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,encrypted_password,raw_user_meta_data)
select ('fc260000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated',
 'verify-budget-fixture-'||n||'@example.test',now(),'not-a-real-hash','{}'::jsonb from generate_series(1,3)n;
delete from public.auth_signup_pending where user_id::text like 'fc260000-%'and user_id<>'fc260000-0000-4000-8000-000000000003';
update public.profiles set preferences='{"notificationsEnabled":false}'where id::text like 'fc260000-%';
-- Reset only inside this rollback transaction, not a live budget reset.
delete from public.purchase_verification_budgets;
create function pg_temp.must_fail(statement text,expected text)returns void language plpgsql as $$declare denied boolean:=false;begin
 begin execute statement;exception when others then if position(expected in sqlerrm)=0 then raise;end if;denied:=true;end;
 if not denied then raise exception 'Expected denial: %',statement;end if;
end $$;
set local role service_role;
do $$begin
 for n in 1..5 loop if not public.take_purchase_verification_slot('fc260000-0000-4000-8000-000000000001')then raise exception 'Early per-buyer denial';end if;end loop;
 if public.take_purchase_verification_slot('fc260000-0000-4000-8000-000000000001')then raise exception 'Per-buyer budget exceeded';end if;
 if not public.take_purchase_verification_slot('fc260000-0000-4000-8000-000000000002')then raise exception 'Other buyer incorrectly denied';end if;
 perform pg_temp.must_fail($q$select public.take_purchase_verification_slot('fc260000-0000-4000-8000-000000000003')$q$,'active account');
 perform pg_temp.must_fail($q$select public.take_purchase_verification_slot('fc260000-0000-4000-8000-999999999999')$q$,'active account');
end $$;
reset role;
update public.purchase_verification_budgets set attempts=30 where id='global';
set local role service_role;
do $$begin if public.take_purchase_verification_slot('fc260000-0000-4000-8000-000000000002')then raise exception 'Global budget exceeded';end if;end $$;
reset role;
update public.purchase_verification_budgets set window_started=clock_timestamp()-interval '2 minutes';
set local role service_role;
do $$begin
 if not public.take_purchase_verification_slot('fc260000-0000-4000-8000-000000000001')then raise exception 'Window failed to reset';end if;
 if(select attempts from public.purchase_verification_budgets where id='global')<>1 then raise exception 'Global window failed to reset';end if;
end $$;
reset role;
update public.profiles set is_banned=true where id='fc260000-0000-4000-8000-000000000002';
set local role service_role;
do $$begin perform pg_temp.must_fail($q$select public.take_purchase_verification_slot('fc260000-0000-4000-8000-000000000002')$q$,'active account');end $$;
reset role;
set local role authenticated;
do $$begin
 perform pg_temp.must_fail('select * from public.purchase_verification_budgets','permission denied');
 perform pg_temp.must_fail('truncate public.purchase_verification_budgets','permission denied');
 perform pg_temp.must_fail($q$select public.take_purchase_verification_slot('fc260000-0000-4000-8000-000000000001')$q$,'permission denied');
end $$;
reset role;
set local role anon;
do $$begin perform pg_temp.must_fail($q$select public.take_purchase_verification_slot('fc260000-0000-4000-8000-000000000001')$q$,'permission denied');end $$;
reset role;
select 'Verification project/buyer budgets, active-account and private permissions passed (rolled back)'as result;
rollback;
