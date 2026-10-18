-- Run AFTER migration 23. Synthetic accounts only; no pushes or R2 operations.
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,encrypted_password,raw_user_meta_data)
select ('fc230000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated',
 'paging-fixture-'||n||'@example.test',now(),'not-a-real-hash','{}'::jsonb from generate_series(1,2106)n;
delete from public.auth_signup_pending where user_id::text like 'fc230000-%'and user_id<>'fc230000-0000-4000-8000-000000000004';
update public.profiles set preferences='{"notificationsEnabled":false}',is_banned=(id='fc230000-0000-4000-8000-000000000003')
 where id::text like 'fc230000-%';
insert into public.restaurants(id,name,slug,address,parish,latitude,longitude,is_active)
select ('fc234000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Paging fixture '||n,'paging-fixture-'||n,
 'Fixture Road','Kingston',18,-77,n<=1100 from generate_series(1,1101)n;
insert into public.saved_restaurants(user_id,restaurant_id,list_type,created_at)
select 'fc230000-0000-4000-8000-000000000001',id,'favorite','2026-01-01'from public.restaurants where id::text like 'fc234000-%';
insert into public.blocks(blocker_id,blocked_id,created_at)
select 'fc230000-0000-4000-8000-000000000001',id,'2026-01-01'from public.profiles where id::text like 'fc230000-%'
 and id not in('fc230000-0000-4000-8000-000000000001','fc230000-0000-4000-8000-000000002106');
-- Reciprocal edge must not duplicate the hidden union.
insert into public.blocks(blocker_id,blocked_id)values('fc230000-0000-4000-8000-000000000002','fc230000-0000-4000-8000-000000000001');
insert into public.blocks(blocker_id,blocked_id)values('fc230000-0000-4000-8000-000000002106','fc230000-0000-4000-8000-000000000001');
insert into public.collections(id,owner_id,title,is_public,updated_at)
select ('fc235000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'fc230000-0000-4000-8000-000000000001','Paging collection '||n,n%2=0,'2026-01-01'from generate_series(1,1101)n;
insert into public.collections(id,owner_id,title,is_public)values
 ('fc235000-0000-4000-8000-000000003001','fc230000-0000-4000-8000-000000000003','Banned collection',true),
 ('fc235000-0000-4000-8000-000000003002','fc230000-0000-4000-8000-000000000004','Pending collection',true);
insert into public.reviews(id,restaurant_id,user_id,rating,comment)values
 ('fc236000-0000-4000-8000-000000000003','fc234000-0000-4000-8000-000000000001','fc230000-0000-4000-8000-000000000003',2,'Banned author fixture'),
 ('fc236000-0000-4000-8000-000000000004','fc234000-0000-4000-8000-000000000001','fc230000-0000-4000-8000-000000000004',3,'Pending author fixture');
insert into public.push_tokens(user_id,token,platform)values('fc230000-0000-4000-8000-000000000003','ExpoPushToken[banned-fixture]','android');
create function pg_temp.must_fail(statement text,expected text)returns void language plpgsql as $$declare denied boolean:=false;begin
 begin execute statement;exception when others then if position(expected in sqlerrm)=0 then raise;end if;denied:=true;end;
 if not denied then raise exception 'Expected denial: %',statement;end if;
end $$;
select set_config('request.jwt.claims','{"sub":"fc230000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$declare p jsonb;q jsonb;r public.reviews;begin
 p:=public.member_saved_page('favorite',null,99999);
 if(p->>'total')::int<>1101 or jsonb_array_length(p->'items')<>251 then raise exception 'Saved full count/bounds failed';end if;
 q:=public.member_saved_page('favorite',(p->'items'->249->>'id')::uuid,250);
 if(q->'items'->0->>'id')<>'fc234000-0000-4000-8000-000000000251'then raise exception 'Saved tied cursor failed';end if;
 if public.member_saved_count()<>1101 then raise exception 'Saved count capped';end if;
 p:=public.member_hidden_user_page(null,99999);
 if(p->>'total')::int<>2105 or jsonb_array_length(p->'items')<>251 then raise exception 'Hidden union cap/dedup failed';end if;
 q:=public.member_hidden_user_page((p->'items'->249->>'id')::uuid,250);
 if(q->'items'->0->>'id')<>'fc230000-0000-4000-8000-000000000252'then raise exception 'Hidden cursor failed';end if;
 if(public.member_hidden_user_page('fc230000-0000-4000-8000-000000002105',1)->'items'->0->>'id')<>'fc230000-0000-4000-8000-000000002106'then raise exception 'Incoming-only block missing at tail';end if;
 p:=public.member_blocked_profile_page(null,250);
 if(p->>'total')::int<>2103 or jsonb_array_length(p->'items')<>251 then raise exception 'Blocked filter before paging failed';end if;
 if(p->'items'->0->'profile')?'preferences'or(p->'items'->0->'profile')?'role'or(p->'items'->0->'profile')?'email'then raise exception 'Private profile projection leaked';end if;
 q:=public.member_blocked_profile_page((p->'items'->249->>'id')::uuid,250);
 if(q->'items'->0->>'id')<>'fc230000-0000-4000-8000-000000000253'then raise exception 'Blocked tied cursor failed';end if;
 p:=public.member_collection_page(null,false,null,99999);
 if(p->>'total')::int<>1101 or jsonb_array_length(p->'items')<>251 then raise exception 'Collection full count/bounds failed';end if;
 q:=public.member_collection_page(null,false,(p->'items'->249->>'id')::uuid,250);
 if(q->'items'->0->>'id')<>'fc235000-0000-4000-8000-000000000251'then raise exception 'Collection tied cursor failed';end if;
 if(public.member_collection_page(null,true)->>'total')::int<>550 then raise exception 'Public-only filter failed';end if;
 if(public.member_collection_page('fc230000-0000-4000-8000-000000000003')->>'total')::int<>0
  or(public.member_collection_page('fc230000-0000-4000-8000-000000000004')->>'total')::int<>0 then raise exception 'Unavailable owners leaked';end if;
 if jsonb_array_length(public.member_saved_page('favorite','fc234000-0000-4000-8000-999999999999')->'items')<>0 then raise exception 'Invalid save anchor leaked';end if;
 perform pg_temp.must_fail($q$select public.member_saved_page('bad')$q$,'Invalid saved list');
 r:=public.write_review('{"restaurant_id":"fc234000-0000-4000-8000-000000000002","rating":5,"comment":"Great","image_paths":["rev/fc230000-0000-4000-8000-000000000001/fixture.jpg"]}');
 r:=public.write_review('{"comment":"Edited"}',r.id);
 if not r.is_edited or r.rating<>5 or cardinality(r.image_paths)<>1 then raise exception 'Review patch contract failed';end if;
 perform pg_temp.must_fail($q$select public.write_review('{"restaurant_id":"fc234000-0000-4000-8000-000000000003","rating":5,"user_id":"fc230000-0000-4000-8000-000000000002"}')$q$,'Invalid review field');
 perform pg_temp.must_fail(format('select public.write_review(%L,%L::uuid)','{"is_hidden":false}',r.id),'Invalid review field');
 perform pg_temp.must_fail(format('select public.write_review(%L,%L::uuid)','{"deleted_author_visible":true}',r.id),'Invalid review field');
 perform pg_temp.must_fail(format('select public.write_review(%L,%L::uuid)','{"like_count":99}',r.id),'Invalid review field');
 perform pg_temp.must_fail(format('select public.write_review(%L,%L::uuid)','{"image_paths":["rev/fc230000-0000-4000-8000-000000000002/other.jpg"]}',r.id),'Invalid review images');
 perform pg_temp.must_fail(format('select public.write_review(%L,%L::uuid)','{"rating":4.5}',r.id),'Invalid rating');
 perform pg_temp.must_fail($q$select public.write_review('{"restaurant_id":"fc234000-0000-4000-8000-000000001101","rating":5}')$q$,'not available');
 perform public.register_push_token('ExpoPushToken[paging-fixture]','android');
 perform public.register_push_token('ExpoPushToken[paging-fixture]','android');
 if(select count(*)from public.push_tokens)<>1 then raise exception 'Token idempotency/privacy failed';end if;
 perform pg_temp.must_fail($q$select public.register_push_token(null,'android')$q$,'Invalid push');
 perform pg_temp.must_fail($q$select public.register_push_token('ExpoPushToken[paging-fixture]',null)$q$,'Invalid push');
 perform pg_temp.must_fail($q$insert into public.push_tokens(user_id,token,platform)values(auth.uid(),'ExpoPushToken[direct]','android')$q$,'permission denied');
end $$;
reset role;
update public.reviews set is_hidden=true,image_paths=array['rev/fc230000-0000-4000-8000-000000000002/legacy.jpg']
 where user_id='fc230000-0000-4000-8000-000000000001';
update public.restaurants set is_active=false where id='fc234000-0000-4000-8000-000000000002';
set local role authenticated;
do $$declare r public.reviews;begin
 select * into r from public.reviews where user_id=auth.uid();
 r:=public.write_review('{"rating":4}',r.id);
 if not r.is_hidden or r.rating<>4 or r.image_paths<>array['rev/fc230000-0000-4000-8000-000000000002/legacy.jpg']then raise exception 'Own hidden/inactive edit changed moderation/old images';end if;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"fc230000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
do $$begin
 if(public.member_saved_count())<>0 then raise exception 'Other saves leaked';end if;
 if(public.member_collection_page('fc230000-0000-4000-8000-000000000001')->>'total')::int<>0 then raise exception 'Blocked collections leaked';end if;
 perform public.register_push_token('ExpoPushToken[paging-fixture]','ios');
 if not exists(select 1 from public.push_tokens where token='ExpoPushToken[paging-fixture]'and user_id=auth.uid()and platform='ios')then raise exception 'Device token transfer failed';end if;
end $$;
reset role;
delete from public.blocks where(blocker_id='fc230000-0000-4000-8000-000000000001'and blocked_id='fc230000-0000-4000-8000-000000000002')or(blocker_id='fc230000-0000-4000-8000-000000000002'and blocked_id='fc230000-0000-4000-8000-000000000001');
set local role authenticated;
do $$begin if(public.member_collection_page('fc230000-0000-4000-8000-000000000001')->>'total')::int<>550 then raise exception 'Private collection page leaked/public count wrong';end if;end $$;
reset role;
do $$declare uid text;statement text;begin
 foreach uid in array array['fc230000-0000-4000-8000-000000000003','fc230000-0000-4000-8000-000000000004','fc230000-0000-4000-8000-999999999999']loop
  perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true);execute 'set local role authenticated';
  foreach statement in array array[
   $q$select public.write_review('{"restaurant_id":"fc234000-0000-4000-8000-000000000001","rating":5}')$q$,
   $q$select public.register_push_token('ExpoPushToken[denied-fixture]','android')$q$,
   $q$select public.member_saved_page('favorite')$q$,$q$select public.member_saved_count()$q$,
   $q$select public.member_hidden_user_page()$q$,$q$select public.member_blocked_profile_page()$q$,$q$select public.member_collection_page()$q$
  ]loop perform pg_temp.must_fail(statement,'active account');end loop;
  delete from public.reviews where user_id=auth.uid();
  if exists(select 1 from public.reviews where user_id=auth.uid())and uid in('fc230000-0000-4000-8000-000000000003','fc230000-0000-4000-8000-000000000004')then
   -- Rows remain readable under unchanged public/own read policy, but DELETE is denied.
   null;
  elsif uid<>'fc230000-0000-4000-8000-999999999999'then raise exception 'Inactive member deleted a review';end if;
  if uid='fc230000-0000-4000-8000-000000000003'then delete from public.push_tokens where user_id=auth.uid();end if;
  execute 'reset role';
 end loop;
end $$;
select set_config('request.jwt.claims','{}',true);
set local role anon;
do $$begin
 perform pg_temp.must_fail('select * from public.push_tokens','permission denied');
 perform pg_temp.must_fail('select public.member_hidden_user_page()','permission denied');
 if(public.restaurant_rating_distribution('fc234000-0000-4000-8000-000000000001')->>'count')::int<>2 then raise exception 'Public rating policy changed';end if;
end $$;
reset role;
select 'Account guards, private cursor paging/full counts, token cleanup and unchanged public ratings passed (rolled back)'as result;
rollback;
