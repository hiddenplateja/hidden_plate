-- Run after migration 22. Every fixture and mutation is rolled back.
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,encrypted_password,raw_user_meta_data)
select ('fc220000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated',
 'relationships-fixture-'||n||'@example.test',now(),'not-a-real-hash','{}'::jsonb from generate_series(1,5)n;
delete from public.auth_signup_pending where user_id::text like 'fc220000-%'and user_id<>'fc220000-0000-4000-8000-000000000004';
update public.profiles set preferences='{"notificationsEnabled":false}',
 is_banned=(id='fc220000-0000-4000-8000-000000000003'),
 role=(case when id='fc220000-0000-4000-8000-000000000005'then 'admin'else 'user'end)::public.app_role
 where id::text like 'fc220000-%';
insert into public.restaurants(id,name,slug,address,parish,latitude,longitude,is_active)
select ('fc224000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Relationship fixture '||n,
 'relationship-fixture-'||n,'Fixture Road','Kingston',18,-77,n=1 from generate_series(1,2)n;
insert into public.collections(id,owner_id,title,is_public)values
 ('fc225000-0000-4000-8000-000000000001','fc220000-0000-4000-8000-000000000001','Private fixture',false),
 ('fc225000-0000-4000-8000-000000000002','fc220000-0000-4000-8000-000000000001','Public fixture',true),
 ('fc225000-0000-4000-8000-000000000003','fc220000-0000-4000-8000-000000000003','Banned fixture',true),
 ('fc225000-0000-4000-8000-000000000004','fc220000-0000-4000-8000-000000000004','Pending fixture',true);
insert into public.saved_restaurants(user_id,restaurant_id,list_type)values
 ('fc220000-0000-4000-8000-000000000002','fc224000-0000-4000-8000-000000000001','favorite');

-- Temporary invoker helper tests the current role and avoids false-positive catches.
create function pg_temp.must_fail(statement text,expected text)returns void language plpgsql as $$
declare denied boolean:=false;begin
 begin execute statement;exception when others then
  if position(expected in sqlerrm)=0 then raise;end if;denied:=true;
 end;
 if not denied then raise exception 'Expected denial: %',statement;end if;
end $$;

select set_config('request.jwt.claims','{"sub":"fc220000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$declare r public.collections;t timestamptz;begin
 if exists(select 1 from public.saved_restaurants where user_id='fc220000-0000-4000-8000-000000000002')then raise exception 'Other saves leaked';end if;
 perform public.set_member_saved('fc224000-0000-4000-8000-000000000001','favorite',true);
 perform public.set_member_saved('fc224000-0000-4000-8000-000000000001','want_to_go',true);
 perform public.set_member_saved('fc224000-0000-4000-8000-000000000001','visited',true);
 if(select count(*)from public.saved_restaurants)<>2 or exists(select 1 from public.saved_restaurants where list_type='want_to_go')then raise exception 'Save exclusion/favorite failed';end if;
 select created_at into t from public.saved_restaurants where list_type='visited';
 perform public.set_member_saved('fc224000-0000-4000-8000-000000000001','visited',true);
 if(select created_at from public.saved_restaurants where list_type='visited')<>t then raise exception 'Duplicate save changed recency';end if;
 perform public.set_member_saved('fc224000-0000-4000-8000-000000000001','want_to_go',true);
 if exists(select 1 from public.saved_restaurants where list_type='visited')then raise exception 'Reverse exclusion failed';end if;
 perform public.set_member_saved('fc224000-0000-4000-8000-000000000001','want_to_go',false);
 perform public.set_member_saved('fc224000-0000-4000-8000-000000000001','want_to_go',false);
 perform pg_temp.must_fail($q$select public.set_member_saved('fc224000-0000-4000-8000-000000000001','saved',true)$q$,'Invalid saved');
 perform pg_temp.must_fail($q$select public.set_member_saved('fc224000-0000-4000-8000-000000000002','favorite',true)$q$,'Restaurant unavailable');
 perform public.set_member_saved('fc224000-0000-4000-8000-000000000002','favorite',false);
 r:=public.write_member_collection(null,'{"title":"  New fixture  ","description":" ","is_public":true}');
 if r.owner_id<>auth.uid()or r.title<>'New fixture'or r.description is not null or cardinality(r.restaurant_ids)<>0 then raise exception 'Creation contract failed';end if;
 perform public.delete_member_collection(r.id);
 r:=public.write_member_collection('fc225000-0000-4000-8000-000000000001','{"title":"Renamed","description":"Dinner","is_public":true}');
 r:=public.write_member_collection(r.id,'{"description":null}');
 if r.title<>'Renamed'or not r.is_public or r.description is not null then raise exception 'Patch omission/null failed';end if;
 perform public.write_member_collection(r.id,'{"is_public":false}');
 perform pg_temp.must_fail($q$select public.write_member_collection(null,'{"title":"x"}')$q$,'2 to 100');
 perform pg_temp.must_fail($q$select public.write_member_collection(null,'{"title":"Valid","owner_id":"fc220000-0000-4000-8000-000000000002"}')$q$,'Invalid collection field');
 perform pg_temp.must_fail($q$select public.write_member_collection('fc225000-0000-4000-8000-000000000001','{"restaurant_ids":[]}')$q$,'Invalid collection field');
 perform pg_temp.must_fail($q$select public.write_member_collection(null,'{"title":"Valid","is_public":"true"}')$q$,'Invalid collection visibility');
 perform pg_temp.must_fail($q$select public.write_member_collection(null,'{"title":"Valid","description":12}')$q$,'Invalid description');
 r:=public.change_collection_membership('fc225000-0000-4000-8000-000000000001','fc224000-0000-4000-8000-000000000001',true);
 r:=public.change_collection_membership(r.id,'fc224000-0000-4000-8000-000000000001',true);
 if cardinality(r.restaurant_ids)<>1 or r.cover_restaurant_id<>'fc224000-0000-4000-8000-000000000001'then raise exception 'Membership/cover duplicate failed';end if;
 perform pg_temp.must_fail($q$select public.change_collection_membership('fc225000-0000-4000-8000-000000000001','fc224000-0000-4000-8000-000000000002',true)$q$,'Restaurant unavailable');
 perform public.set_member_block('fc220000-0000-4000-8000-000000000002',true);
 perform public.set_member_block('fc220000-0000-4000-8000-000000000002',true);
 if(select count(*)from public.blocks)<>1 then raise exception 'Duplicate block';end if;
 perform public.set_member_block('fc220000-0000-4000-8000-000000000003',true);
 perform public.set_member_block('fc220000-0000-4000-8000-000000000004',true);
 perform pg_temp.must_fail($q$select public.set_member_block('fc220000-0000-4000-8000-000000000001',true)$q$,'block yourself');
 perform pg_temp.must_fail($q$select public.set_member_block('fc220000-0000-4000-8000-999999999999',true)$q$,'unavailable');
end $$;
reset role;
update public.restaurants set is_active=false where id='fc224000-0000-4000-8000-000000000001';
set local role authenticated;
do $$declare r public.collections;begin
 perform public.set_member_saved('fc224000-0000-4000-8000-000000000001','favorite',false);
 r:=public.change_collection_membership('fc225000-0000-4000-8000-000000000001','fc224000-0000-4000-8000-000000000001',false);
 if cardinality(r.restaurant_ids)<>0 or r.cover_restaurant_id is not null then raise exception 'Inactive removal/empty cover failed';end if;
end $$;
reset role;

select set_config('request.jwt.claims','{"sub":"fc220000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
do $$begin
 if exists(select 1 from public.collections where id::text like 'fc225000-%')then raise exception 'Private/blocked/banned/pending collection leaked';end if;
 if(select count(*)from public.blocks)<>1 then raise exception 'Nonparticipant blocks leaked/participant hidden';end if;
 perform public.set_member_block('fc220000-0000-4000-8000-000000000001',true);
 perform public.set_member_block('fc220000-0000-4000-8000-000000000001',false);
 if(select count(*)from public.blocks)<>1 then raise exception 'Unblock removed reverse block';end if;
 perform pg_temp.must_fail($q$select public.write_member_collection('fc225000-0000-4000-8000-000000000002','{"title":"Hijack"}')$q$,'permission denied');
 perform pg_temp.must_fail($q$select public.delete_member_collection('fc225000-0000-4000-8000-000000000002')$q$,'permission denied');
 perform pg_temp.must_fail($q$select public.change_collection_membership('fc225000-0000-4000-8000-000000000002','fc224000-0000-4000-8000-000000000001',false)$q$,'permission denied');
 perform pg_temp.must_fail($q$insert into public.saved_restaurants(user_id,restaurant_id,list_type)values(auth.uid(),'fc224000-0000-4000-8000-000000000001','favorite')$q$,'permission denied');
 perform pg_temp.must_fail($q$delete from public.blocks$q$,'permission denied');
 perform pg_temp.must_fail($q$update public.collections set restaurant_ids='{}'$q$,'permission denied');
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"fc220000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select public.set_member_block('fc220000-0000-4000-8000-000000000002',false);
reset role;
select set_config('request.jwt.claims','{"sub":"fc220000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
do $$begin
 if(select count(*)from public.collections where id::text like 'fc225000-%')<>1 then raise exception 'Unblocked public collection unavailable';end if;
end $$;
reset role;

-- Banned, unfinished and stale/deleted callers cannot use any write RPC/read.
do $$declare uid text;statement text;begin
 foreach uid in array array['fc220000-0000-4000-8000-000000000003','fc220000-0000-4000-8000-000000000004','fc220000-0000-4000-8000-999999999999']loop
  perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  if exists(select 1 from public.collections)or exists(select 1 from public.blocks)or exists(select 1 from public.saved_restaurants)then raise exception 'Inactive member read leaked';end if;
  foreach statement in array array[
   $q$select public.set_member_saved('fc224000-0000-4000-8000-000000000001','favorite',true)$q$,
   $q$select public.set_member_block('fc220000-0000-4000-8000-000000000001',true)$q$,
   $q$select public.write_member_collection(null,'{"title":"Denied"}')$q$,
   $q$select public.delete_member_collection('fc225000-0000-4000-8000-000000000001')$q$,
   $q$select public.change_collection_membership('fc225000-0000-4000-8000-000000000001','fc224000-0000-4000-8000-000000000001',false)$q$
  ]loop perform pg_temp.must_fail(statement,'active account');end loop;
  execute 'reset role';
 end loop;
end $$;
select set_config('request.jwt.claims','{"sub":"fc220000-0000-4000-8000-000000000005","role":"authenticated"}',true);
set local role authenticated;
do $$begin
 if(select count(*)from public.collections where id::text like 'fc225000-%')<>4 then raise exception 'Admin read lost';end if;
 perform pg_temp.must_fail($q$select public.delete_member_collection('fc225000-0000-4000-8000-000000000001')$q$,'permission denied');
end $$;
reset role;
select set_config('request.jwt.claims','{}',true);
set local role anon;
select pg_temp.must_fail('select * from public.collections','permission denied');
select pg_temp.must_fail($q$select public.set_member_block('fc220000-0000-4000-8000-000000000001',true)$q$,'permission denied');
reset role;

do $$declare t text;p text;f text;begin
 foreach t in array array['saved_restaurants','blocks','collections']loop
  if not(select relrowsecurity from pg_class where oid=('public.'||t)::regclass)then raise exception 'RLS missing';end if;
  foreach p in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']loop
   if has_table_privilege('authenticated','public.'||t,p)or has_table_privilege('anon','public.'||t,p)then raise exception 'Unsafe table grant: % %',t,p;end if;
  end loop;
  if has_any_column_privilege('authenticated','public.'||t,'INSERT,UPDATE,REFERENCES')or has_any_column_privilege('anon','public.'||t,'INSERT,UPDATE,REFERENCES')then raise exception 'Unsafe column grants';end if;
  if has_table_privilege('anon','public.'||t,'SELECT')then raise exception 'Anonymous read';end if;
 end loop;
 foreach f in array array['set_member_saved(uuid,text,boolean)','set_member_block(uuid,boolean)','write_member_collection(uuid,jsonb)',
  'delete_member_collection(uuid)','change_collection_membership(uuid,uuid,boolean)']loop
  if has_function_privilege('anon','public.'||f,'EXECUTE')or not has_function_privilege('authenticated','public.'||f,'EXECUTE')then raise exception 'Unsafe RPC grants';end if;
 end loop;
end $$;
select 'Saved/block/collection permissions, ownership, exclusion, inactive removals and visibility passed (rolled back)'as result;
rollback;
