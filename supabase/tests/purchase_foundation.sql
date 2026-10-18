-- After migration 25. Fake proof/contracts only, not real RevenueCat verification.
-- No external calls, native checkout, webhook routing or real payment grant.
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,encrypted_password,raw_user_meta_data)
select ('fc250000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated',
 'purchase-fixture-'||n||'@example.test',now(),'not-a-real-hash','{}'::jsonb from generate_series(1,4)n;
delete from public.auth_signup_pending where user_id::text like 'fc250000-%'and user_id<>'fc250000-0000-4000-8000-000000000004';
update public.profiles set preferences='{"notificationsEnabled":false}',is_banned=(id='fc250000-0000-4000-8000-000000000003')where id::text like 'fc250000-%';
insert into public.restaurants(id,name,slug,address,parish,latitude,longitude,is_active,owner_id)values
 ('fc254000-0000-4000-8000-000000000001','Purchase fixture','purchase-fixture-25','Fixture Road','Kingston',18,-77,true,'fc250000-0000-4000-8000-000000000001'),
 ('fc254000-0000-4000-8000-000000000002','Purchase fixture two','purchase-fixture-25-two','Fixture Road','Kingston',18,-77,true,'fc250000-0000-4000-8000-000000000002');
create function pg_temp.must_fail(statement text,expected text)returns void language plpgsql as $$declare denied boolean:=false;begin
 begin execute statement;exception when others then if position(expected in sqlerrm)=0 then raise;end if;denied:=true;end;
 if not denied then raise exception 'Expected denial: %',statement;end if;
end $$;
create function pg_temp.proof(purchase text,transaction text,product text default 'feature_7d')returns jsonb language sql as $$
 select jsonb_build_object('rc_project_id','proj-fixture-25','rc_purchase_id',purchase,'buyer_id','fc250000-0000-4000-8000-000000000001',
  'app_id','app-fixture-25','store','PLAY_STORE','environment','SANDBOX','store_transaction_id',transaction,'product_id',product,'purchased_at',clock_timestamp()::text);
$$;
select set_config('request.jwt.claims','{"sub":"fc250000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$begin
 perform pg_temp.must_fail($q$select public.prepare_purchase_intent('fc251000-0000-4000-8000-000000000001','fc254000-0000-4000-8000-000000000001','feature_7d')$q$,'Payments are not enabled');
end $$;
reset role;
-- The fake sandbox routing settings are changed ONLY inside this transaction.
update public.purchase_settings set enabled=true,rc_project_id='proj-fixture-25',allowed_apps='{"app-fixture-25":"PLAY_STORE"}'where id=true;
update public.app_config set feature_plans=null,listing_plans=null where id=true;
set local role authenticated;
do $$declare first jsonb;second jsonb;begin
 first:=public.prepare_purchase_intent('fc251000-0000-4000-8000-000000000001','fc254000-0000-4000-8000-000000000001','feature_7d');
 second:=public.prepare_purchase_intent('fc251000-0000-4000-8000-000000000001','fc254000-0000-4000-8000-000000000001','feature_7d');
 if first<>second or(first->>'days')::int<>7 then raise exception 'Idempotent intent/default terms failed';end if;
 perform public.prepare_purchase_intent('fc251000-0000-4000-8000-000000000002','fc254000-0000-4000-8000-000000000001','feature_7d');
 perform public.prepare_purchase_intent('fc251000-0000-4000-8000-000000000003','fc254000-0000-4000-8000-000000000001','listing_1yr');
 perform pg_temp.must_fail($q$select public.prepare_purchase_intent('fc251000-0000-4000-8000-000000000001','fc254000-0000-4000-8000-000000000001','listing_1yr')$q$,'intent conflict');
 perform pg_temp.must_fail($q$select public.prepare_purchase_intent('fc251000-0000-4000-8000-000000000010','fc254000-0000-4000-8000-000000000002','feature_7d')$q$,'ownership required');
 perform pg_temp.must_fail($q$select public.prepare_purchase_intent('fc251000-0000-4000-8000-000000000011','fc254000-0000-4000-8000-000000000001','unknown')$q$,'Unknown purchase product');
 perform pg_temp.must_fail('select * from public.purchase_ledger','permission denied');
 perform pg_temp.must_fail('truncate public.purchase_intents','permission denied');
 perform pg_temp.must_fail($q$select public.fulfill_verified_purchase('fc251000-0000-4000-8000-000000000001',pg_temp.proof('purch-a','tx-a'))$q$,'permission denied');
end $$;
reset role;
-- Changing the display plan after intent creation must not change bought days.
update public.app_config set feature_plans='[{"id":"7d","label":"7 days","days":14,"amount":100,"currency":"JMD","productId":"feature_7d"}]'where id=true;
set local role service_role;
do $$declare proof jsonb;first jsonb;retry jsonb;next jsonb;begin
 proof:=pg_temp.proof('purch-a','tx-a');
 perform pg_temp.must_fail(format('select public.fulfill_verified_purchase(%L::uuid,%L::jsonb)','fc251000-0000-4000-8000-000000000001',(proof||'{"environment":"PRODUCTION"}')::text),'route is not enabled');
 perform pg_temp.must_fail(format('select public.fulfill_verified_purchase(%L::uuid,%L::jsonb)','fc251000-0000-4000-8000-000000000001',(proof||'{"buyer_id":"fc250000-0000-4000-8000-000000000002"}')::text),'does not match intent');
 perform pg_temp.must_fail(format('select public.fulfill_verified_purchase(%L::uuid,%L::jsonb)','fc251000-0000-4000-8000-000000000001',(proof||'{"product_id":"listing_1yr"}')::text),'does not match intent');
 perform pg_temp.must_fail(format('select public.fulfill_verified_purchase(%L::uuid,%L::jsonb)','fc251000-0000-4000-8000-000000000001',(proof||'{"purchased_at":"2020-01-01"}')::text),'time does not match');
 first:=public.fulfill_verified_purchase('fc251000-0000-4000-8000-000000000001',proof);
 retry:=public.fulfill_verified_purchase('fc251000-0000-4000-8000-000000000001',proof);
 if first<>retry or(first->>'granted_until')::timestamptz not between clock_timestamp()+interval '6 days'and clock_timestamp()+interval '8 days'then raise exception 'Retry/snapshot terms failed';end if;
 perform pg_temp.must_fail($q$select public.fulfill_verified_purchase('fc251000-0000-4000-8000-000000000002',pg_temp.proof('purch-a','tx-a'))$q$,'already assigned');
 perform pg_temp.must_fail($q$select public.fulfill_verified_purchase('fc251000-0000-4000-8000-000000000002',pg_temp.proof('different-purchase','tx-a'))$q$,'already assigned');
 perform pg_temp.must_fail($q$select public.fulfill_verified_purchase('fc251000-0000-4000-8000-000000000001',pg_temp.proof('purch-new','tx-new'))$q$,'already fulfilled');
 next:=public.fulfill_verified_purchase('fc251000-0000-4000-8000-000000000002',pg_temp.proof('purch-b','tx-b'));
 if(next->>'granted_until')::timestamptz<>(first->>'granted_until')::timestamptz+interval '7 days'then raise exception 'Distinct renewal did not stack';end if;
 perform public.fulfill_verified_purchase('fc251000-0000-4000-8000-000000000003',pg_temp.proof('purch-listing','tx-listing','listing_1yr'));
 if(select count(*)from public.purchase_ledger where rc_project_id='proj-fixture-25')<>3 then raise exception 'Ledger transaction deduplication failed';end if;
end $$;
reset role;
do $$declare restaurant public.restaurants;feature_until timestamptz;listing_until timestamptz;begin
 select * into restaurant from public.restaurants where id='fc254000-0000-4000-8000-000000000001';
 select granted_until into feature_until from public.purchase_ledger where rc_purchase_id='purch-b'and rc_project_id='proj-fixture-25';
 select granted_until into listing_until from public.purchase_ledger where rc_purchase_id='purch-listing'and rc_project_id='proj-fixture-25';
 if not restaurant.is_featured or restaurant.featured_until is distinct from feature_until or restaurant.listing_paid_until is distinct from listing_until
  or listing_until not between clock_timestamp()+interval '364 days'and clock_timestamp()+interval '366 days'then raise exception 'Atomic independent restaurant windows failed';end if;
end $$;
set local role authenticated;
do $$declare status jsonb;begin
 status:=public.my_purchase_intent('fc251000-0000-4000-8000-000000000001');
 if status->>'fulfilled'<>'true'or status->>'granted_until'is null then raise exception 'Own fulfillment status failed';end if;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"fc250000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
do $$begin
 if public.my_purchase_intent('fc251000-0000-4000-8000-000000000001')is not null then raise exception 'Other intent leaked';end if;
end $$;
reset role;
-- A separate unfulfilled intent checks buyer/owner status at grant time.
select set_config('request.jwt.claims','{"sub":"fc250000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select public.prepare_purchase_intent('fc251000-0000-4000-8000-000000000004','fc254000-0000-4000-8000-000000000001','feature_7d');
reset role;
update public.profiles set is_banned=true where id='fc250000-0000-4000-8000-000000000001';
set local role service_role;
do $$begin perform pg_temp.must_fail($q$select public.fulfill_verified_purchase('fc251000-0000-4000-8000-000000000004',pg_temp.proof('purch-denied','tx-denied'))$q$,'active account');end $$;
reset role;
update public.profiles set is_banned=false where id='fc250000-0000-4000-8000-000000000001';
update public.restaurants set owner_id='fc250000-0000-4000-8000-000000000002'where id='fc254000-0000-4000-8000-000000000001';
set local role service_role;
do $$begin perform pg_temp.must_fail($q$select public.fulfill_verified_purchase('fc251000-0000-4000-8000-000000000004',pg_temp.proof('purch-denied','tx-denied'))$q$,'ownership required');end $$;
reset role;
do $$declare uid text;begin
 foreach uid in array array['fc250000-0000-4000-8000-000000000003','fc250000-0000-4000-8000-000000000004','fc250000-0000-4000-8000-999999999999']loop
  perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true);execute 'set local role authenticated';
  perform pg_temp.must_fail($q$select public.prepare_purchase_intent('fc251000-0000-4000-8000-000000000099','fc254000-0000-4000-8000-000000000001','feature_7d')$q$,'active account');
  perform pg_temp.must_fail($q$select public.my_purchase_intent('fc251000-0000-4000-8000-000000000001')$q$,'active account');
  execute 'reset role';
 end loop;
end $$;
select set_config('request.jwt.claims','{}',true);
set local role anon;
do $$begin
 perform pg_temp.must_fail('select * from public.purchase_settings','permission denied');
 perform pg_temp.must_fail($q$select public.my_purchase_intent('fc251000-0000-4000-8000-000000000001')$q$,'permission denied');
end $$;
reset role;
select 'Purchase intent/privacy/disabled-route and atomic ledger retry/renewal contracts passed with fake proof (rolled back)'as result;
rollback;
