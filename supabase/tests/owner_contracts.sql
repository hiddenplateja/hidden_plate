-- Test project only. Fixtures, notifications and all writes roll back together.
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,encrypted_password,raw_user_meta_data)
select ('fc000000-0000-4000-8000-00000000000'||n)::uuid,'authenticated','authenticated',
  'owner-contract-fixture-'||n||'@example.test',now(),'not-a-real-hash','{}'::jsonb from generate_series(1,5) n;
delete from public.auth_signup_pending where user_id in
 ('fc000000-0000-4000-8000-000000000001','fc000000-0000-4000-8000-000000000002',
  'fc000000-0000-4000-8000-000000000003','fc000000-0000-4000-8000-000000000004');
update public.profiles set role='admin' where id='fc000000-0000-4000-8000-000000000001';
update public.profiles set preferences='{"futureSetting":42}' where id='fc000000-0000-4000-8000-000000000002';
update public.profiles set is_banned=true where id='fc000000-0000-4000-8000-000000000004';
insert into public.restaurants(id,name,slug,address,parish,latitude,longitude,is_active,owner_id) values
 ('fc100000-0000-4000-8000-000000000001','Owner Contract One','owner-contract-one','Fixture Road','Kingston',18,-77,true,'fc000000-0000-4000-8000-000000000002'),
 ('fc100000-0000-4000-8000-000000000002','Owner Contract Inactive','owner-contract-inactive','Fixture Road','Kingston',18,-77,false,'fc000000-0000-4000-8000-000000000002');
insert into public.reviews(id,restaurant_id,user_id,rating,comment) values
 ('fc200000-0000-4000-8000-000000000001','fc100000-0000-4000-8000-000000000001','fc000000-0000-4000-8000-000000000003',5,'Fixture review'),
 ('fc200000-0000-4000-8000-000000000002','fc100000-0000-4000-8000-000000000002','fc000000-0000-4000-8000-000000000003',4,'Inactive fixture');
select set_config('request.jwt.claims','{"sub":"fc000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
do $$ declare reply public.review_responses; prefs jsonb; begin
  if has_table_privilege('authenticated','public.review_responses','INSERT')
    or has_table_privilege('authenticated','public.review_responses','UPDATE')
    or has_table_privilege('authenticated','public.review_responses','DELETE')
    or has_table_privilege('authenticated','public.restaurant_views','SELECT')
    or has_table_privilege('authenticated','public.restaurant_views','INSERT')
    or has_column_privilege('authenticated','public.profiles','preferences','UPDATE')
    or has_function_privilege('anon','public.merge_my_preferences(jsonb)','EXECUTE')
    or has_function_privilege('anon','public.write_owner_response(uuid,uuid,text,uuid)','EXECUTE')
    or has_function_privilege('anon','public.restaurant_view_count(uuid)','EXECUTE') then raise exception 'Unsafe grants'; end if;
  select * into reply from public.write_owner_response('fc200000-0000-4000-8000-000000000001',
    'fc100000-0000-4000-8000-000000000001',' Thanks https://example.test/menu ');
  if reply.author_id<>auth.uid() or reply.text<>'Thanks https://example.test/menu' then raise exception 'Reply mapping failed'; end if;
  perform public.write_owner_response(response_id=>reply.id,response_text=>'Updated');
  if not exists(select 1 from public.review_responses where id=reply.id and text='Updated') then raise exception 'Reply update failed'; end if;
  begin perform public.write_owner_response('fc200000-0000-4000-8000-000000000001',null,'Duplicate');
    raise exception 'Duplicate reply allowed'; exception when unique_violation then null; end;
  begin perform public.write_owner_response('fc200000-0000-4000-8000-000000000001','fc100000-0000-4000-8000-000000000002','Wrong parent');
    raise exception 'Parent forgery allowed'; exception when raise_exception then if sqlerrm<>'Review not found.' then raise; end if; end;
  begin perform public.write_owner_response(response_id=>reply.id,target_review=>'fc200000-0000-4000-8000-000000000002',response_text=>'Move');
    raise exception 'Reply retarget allowed'; exception when raise_exception then if sqlerrm<>'A reply cannot be moved.' then raise; end if; end;
  begin perform public.write_owner_response(response_id=>reply.id,response_text=>' ');
    raise exception 'Blank reply allowed'; exception when raise_exception then if sqlerrm<>'Replies must be 1–1000 characters.' then raise; end if; end;
  perform public.write_owner_response('fc200000-0000-4000-8000-000000000002',null,'Inactive owner reply');
  if public.restaurant_view_count('fc100000-0000-4000-8000-000000000002')<>0 then raise exception 'Inactive owner count failed'; end if;
  perform public.record_restaurant_view('fc100000-0000-4000-8000-000000000001');
  perform public.record_restaurant_view('fc100000-0000-4000-8000-000000000001');
  if public.restaurant_view_count('fc100000-0000-4000-8000-000000000001')<>1 then raise exception 'View dedupe failed'; end if;
  begin perform public.record_restaurant_view('fc100000-0000-4000-8000-000000000002');
    raise exception 'Inactive view allowed'; exception when raise_exception then if sqlerrm<>'Restaurant not found.' then raise; end if; end;
  perform public.merge_my_preferences('{"notifyOnLike":false,"favoriteParishes":["kingston"],"usernameChangedAt":"2026-10-09T00:00:00Z"}');
  prefs:=public.merge_my_preferences('{"notifyOnFollow":false,"seenBadgeIds":null}');
  if prefs->>'futureSetting'<>'42' or prefs->>'notifyOnLike'<>'false' or prefs->>'notifyOnFollow'<>'false'
    or prefs->'seenBadgeIds'<>'null'::jsonb then raise exception 'Preference preservation failed'; end if;
  begin perform public.merge_my_preferences('{"role":"admin"}'); raise exception 'Unknown preference accepted';
    exception when raise_exception then if sqlerrm<>'Invalid settings update.' then raise; end if; end;
  begin perform public.merge_my_preferences('{"notifyOnLike":"false"}'); raise exception 'Invalid boolean accepted';
    exception when raise_exception then if sqlerrm<>'Invalid settings update.' then raise; end if; end;
  begin perform public.merge_my_preferences('{"favoriteParishes":["unknown"]}'); raise exception 'Invalid parish accepted';
    exception when raise_exception then if sqlerrm<>'Invalid settings update.' then raise; end if; end;
  begin perform public.merge_my_preferences('{"favoriteCuisines":[1]}'); raise exception 'Invalid cuisine accepted';
    exception when raise_exception then if sqlerrm<>'Invalid settings update.' then raise; end if; end;
  begin perform public.merge_my_preferences('{"displayNameChangedAt":"bad date"}'); raise exception 'Invalid date accepted';
    exception when raise_exception then if sqlerrm<>'Invalid settings update.' then raise; end if; end;
end $$;
select set_config('request.jwt.claims','{"sub":"fc000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
do $$ begin
  perform public.record_restaurant_view('fc100000-0000-4000-8000-000000000001');
  begin perform public.restaurant_view_count('fc100000-0000-4000-8000-000000000001'); raise exception 'Member analytics leak';
    exception when raise_exception then if sqlerrm<>'Owner or admin access required.' then raise; end if; end;
  begin perform public.write_owner_response('fc200000-0000-4000-8000-000000000001',null,'Not owner'); raise exception 'Nonowner reply allowed';
    exception when raise_exception then if sqlerrm<>'Only the current restaurant owner can reply.' then raise; end if; end;
end $$;
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$ begin
  if (select count(*) from public.review_responses where restaurant_id='fc100000-0000-4000-8000-000000000001')<>1 then raise exception 'Public reply absent'; end if;
  if exists(select 1 from public.review_responses where restaurant_id='fc100000-0000-4000-8000-000000000002') then raise exception 'Inactive reply public leak'; end if;
end $$;
reset role;
update public.reviews set is_hidden=true where id='fc200000-0000-4000-8000-000000000001';
set local role anon;
do $$ begin if exists(select 1 from public.review_responses where restaurant_id='fc100000-0000-4000-8000-000000000001') then raise exception 'Hidden review reply leak'; end if; end $$;
reset role;
update public.reviews set is_hidden=false where id='fc200000-0000-4000-8000-000000000001';
update public.restaurants set owner_id='fc000000-0000-4000-8000-000000000003' where id='fc100000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims','{"sub":"fc000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
do $$ begin
  if exists(select 1 from public.review_responses where restaurant_id='fc100000-0000-4000-8000-000000000001') then raise exception 'Former owner reply displayed'; end if;
  if public.restaurant_view_count('fc100000-0000-4000-8000-000000000001')<>2 then raise exception 'Unique total incorrect'; end if;
  perform public.write_owner_response('fc200000-0000-4000-8000-000000000001',null,'New owner reply');
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"fc000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
do $$ begin
  begin perform public.write_owner_response('fc200000-0000-4000-8000-000000000001',null,'Former owner'); raise exception 'Former owner edit allowed';
    exception when raise_exception then if sqlerrm<>'Only the current restaurant owner can reply.' then raise; end if; end;
  begin perform public.restaurant_view_count('fc100000-0000-4000-8000-000000000001'); raise exception 'Former owner analytics leak';
    exception when raise_exception then if sqlerrm<>'Owner or admin access required.' then raise; end if; end;
end $$;
reset role;
-- Private fixture IDs captured only as postgres; no client sees other authors' rows.
select set_config('fixture.old_reply',(select id::text from public.review_responses where review_id='fc200000-0000-4000-8000-000000000001' and author_id='fc000000-0000-4000-8000-000000000002'),true);
set local role authenticated;
select public.delete_owner_response(current_setting('fixture.old_reply')::uuid);
reset role;
select set_config('request.jwt.claims','{"sub":"fc000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$ declare reply_id uuid; begin
  if public.restaurant_view_count('fc100000-0000-4000-8000-000000000001')<>2 then raise exception 'Admin count failed'; end if;
  select id into reply_id from public.review_responses where review_id='fc200000-0000-4000-8000-000000000001';
  begin perform public.write_owner_response(response_id=>reply_id,response_text=>'Admin edit'); raise exception 'Admin impersonation allowed';
    exception when raise_exception then if sqlerrm<>'Reply not found or not yours.' then raise; end if; end;
  perform public.delete_owner_response(reply_id);
end $$;
reset role;
do $$ declare actor uuid; begin
  foreach actor in array array['fc000000-0000-4000-8000-000000000004'::uuid,'fc000000-0000-4000-8000-000000000005'::uuid] loop
    perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
    begin perform public.record_restaurant_view('fc100000-0000-4000-8000-000000000001'); raise exception 'Inactive account view allowed';
      exception when raise_exception then if sqlerrm<>'You must be signed in to an active account.' then raise; end if; end;
    begin perform public.merge_my_preferences('{}'); raise exception 'Inactive account preferences allowed';
      exception when raise_exception then if sqlerrm<>'You must be signed in to an active account.' then raise; end if; end;
    begin perform public.write_owner_response('fc200000-0000-4000-8000-000000000001',null,'Inactive'); raise exception 'Inactive account reply allowed';
      exception when raise_exception then if sqlerrm<>'You must be signed in to an active account.' then raise; end if; end;
  end loop;
end $$;
select set_config('request.jwt.claims','{"sub":"fc000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
delete from public.restaurants where id in ('fc100000-0000-4000-8000-000000000001','fc100000-0000-4000-8000-000000000002');
do $$ begin
  if exists(select 1 from public.review_responses where restaurant_id::text like 'fc100000-%')
    or exists(select 1 from public.restaurant_views where restaurant_id::text like 'fc100000-%') then raise exception 'Cascade cleanup failed'; end if;
end $$;
select 'owner contracts passed; all fixtures rolled back' as result;
rollback;
