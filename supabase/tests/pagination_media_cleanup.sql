-- Disposable test fixtures only. No email/push/R2 delivery is invoked.
-- Entire fixture set, temporary admin role, and cleanup leases are rolled back.
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,encrypted_password,raw_user_meta_data)
select ('fa000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated',
 'pagination-fixture-'||n||'@example.test',now(),'not-a-real-hash','{}'::jsonb from generate_series(1,1103) n;
delete from public.auth_signup_pending where user_id::text like 'fa000000-%' and user_id<>'fa000000-0000-4000-8000-000000001103';
update public.profiles set role='admin' where id='fa000000-0000-4000-8000-000000000001';
insert into public.restaurants(id,name,slug,address,parish,latitude,longitude,is_active,search_text,average_rating,created_at)
select ('fa100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'Pagination Fixture '||lpad((2002-n)::text,4,'0'),'pagination-fixture-'||n,'Fixture Road','kingston',18,-77,true,
 'pagination fixture',case when n<=3 then n+2 else 0 end,'2090-01-01'::timestamptz+n*interval '1 second'
from generate_series(1,2001) n;
insert into public.reviews(id,restaurant_id,user_id,rating,comment,like_count,created_at)
select ('fa200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'fa100000-0000-4000-8000-000000000001',
 ('fa000000-0000-4000-8000-'||lpad((n+1)::text,12,'0'))::uuid,case when n%2=0 then 5 else 4 end,
 'Fixture review',n%17,'2090-01-01'::timestamptz+n*interval '1 second' from generate_series(1,1101) n;
-- Restore independent sort fixtures after the review-count trigger recalculates row 1.
update public.restaurants set average_rating=3 where id='fa100000-0000-4000-8000-000000000001';
set local role anon;
do $$ declare first_page jsonb; next_page jsonb; ordering text; cursor_id uuid; loaded integer:=0; stats jsonb; begin
 foreach ordering in array array['rating','recent','name'] loop
  first_page:=public.restaurant_page('{"search":"pagination fixture"}',ordering,null,2);
  if (first_page->>'total')::integer<>2001 or jsonb_array_length(first_page->'items')<>3 then raise exception 'Restaurant total/lookahead mismatch'; end if;
  cursor_id:=(first_page->'items'->1->>'id')::uuid;
  next_page:=public.restaurant_page('{"search":"pagination fixture"}',ordering,cursor_id,2);
  if next_page->'items'->0->>'id'<>first_page->'items'->2->>'id' then raise exception 'Restaurant sort-aware cursor mismatch: %',ordering; end if;
 end loop;
 if public.restaurant_page('{"search":"pagination fixture"}','rating',null,2)->'items'->0->>'id'<>'fa100000-0000-4000-8000-000000000003' then raise exception 'Rating sort wrong'; end if;
 if public.restaurant_page('{"search":"pagination fixture"}','recent',null,2)->'items'->0->>'id'<>'fa100000-0000-4000-8000-000000002001' then raise exception 'Recent sort wrong'; end if;
 if public.restaurant_page('{"search":"pagination fixture"}','name',null,2)->'items'->0->>'id'<>'fa100000-0000-4000-8000-000000002001' then raise exception 'Name sort wrong'; end if;
 cursor_id:=null;
 for batch in 1..8 loop
  first_page:=public.restaurant_page('{"search":"pagination fixture"}','name',cursor_id,250);
  if jsonb_array_length(first_page->'items')<>251 then raise exception 'Large result truncated'; end if;
  loaded:=loaded+250;cursor_id:=(first_page->'items'->249->>'id')::uuid;
 end loop;
 if loaded<>2000 then raise exception 'Map retrieval limit mismatch'; end if;
 foreach ordering in array array['recent','popular'] loop
  first_page:=public.restaurant_review_page('fa100000-0000-4000-8000-000000000001',ordering,null,2);
  next_page:=public.restaurant_review_page('fa100000-0000-4000-8000-000000000001',ordering,(first_page->'items'->1->>'id')::uuid,2);
  if (first_page->>'total')::integer<>1101 or next_page->'items'->0->>'id'<>first_page->'items'->2->>'id' then raise exception 'Review pagination mismatch'; end if;
 end loop;
 stats:=public.restaurant_rating_distribution('fa100000-0000-4000-8000-000000000001');
 if (stats->>'count')::integer<>1101 or (stats->>'average')::numeric<>4.5 or (stats->'buckets'->>'4')::integer<>551 then raise exception 'Ratings capped or wrong'; end if;
 if not exists(select 1 from public.restaurant_review_stats(array['fa100000-0000-4000-8000-000000000001'::uuid]) where count=1101 and average=4.5) then raise exception 'Collection ratings capped'; end if;
 if not exists(select 1 from public.restaurant_review_stats(array['fa100000-0000-4000-8000-000000000002'::uuid]) where count=0 and average=0) then raise exception 'New listing stats wrong'; end if;
 if (public.restaurant_page('{"search":"%"}')->>'total')::integer<>0 then raise exception 'Search wildcard interpreted'; end if;
end $$;
reset role;
update public.reviews set is_hidden=true where id='fa200000-0000-4000-8000-000000000001';
set local role anon;
do $$ begin
 if (public.restaurant_rating_distribution('fa100000-0000-4000-8000-000000000001')->>'count')::integer<>1100 then raise exception 'Hidden review counted'; end if;
 if has_table_privilege('anon','public.media_cleanup','SELECT') or has_function_privilege('anon','public.claim_admin_media_cleanup()','EXECUTE')
 or has_function_privilege('authenticated','public.media_is_referenced(text)','EXECUTE') then raise exception 'Private cleanup access exposed'; end if;
end $$;
reset role;
-- Shared media: removing one reference must never delete the remaining image.
update public.restaurants set image_paths=array['rest/fa000000-0000-4000-8000-000000000002/shared.jpg']
 where id in ('fa100000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000000002');
update public.restaurants set image_paths='{}' where id='fa100000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims','{"sub":"fa000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
do $$ begin
 if has_table_privilege('authenticated','public.media_cleanup','UPDATE') then raise exception 'Direct queue write allowed'; end if;
 begin perform public.claim_admin_media_cleanup(); raise exception 'TESTFAIL member admin access';
 exception when raise_exception then if sqlerrm like 'TESTFAIL%' then raise; end if; end;
 begin perform public.claim_my_media_cleanup('rest/fa000000-0000-4000-8000-000000000002/shared.jpg'); raise exception 'TESTFAIL shared image deletion';
 exception when raise_exception then if sqlerrm<>'This image is still in use.' then raise; end if; end;
 begin perform public.claim_my_media_cleanup('rest/fa000000-0000-4000-8000-000000000001/foreign.jpg'); raise exception 'TESTFAIL foreign deletion';
 exception when raise_exception then if sqlerrm<>'Only your own image can be removed.' then raise; end if; end;
end $$;
reset role;
do $$ begin
 begin update public.restaurants set image_paths=array['rest/fa000000-0000-4000-8000-000000000002/shared.jpg'] where id='fa100000-0000-4000-8000-000000000003'; raise exception 'TESTFAIL retired new reference';
 exception when raise_exception then if sqlerrm<>'This image is being removed. Upload a new image.' then raise; end if; end;
end $$;
select set_config('request.jwt.claims','{"sub":"fa000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$ begin
 if jsonb_array_length(public.claim_admin_media_cleanup())<>0 then raise exception 'Shared job incorrectly leased'; end if;
end $$;
reset role;
do $$ begin
 if exists(select 1 from public.media_cleanup where key='rest/fa000000-0000-4000-8000-000000000002/shared.jpg') then raise exception 'Shared candidate not cancelled'; end if;
end $$;
update public.restaurants set image_paths='{}' where id='fa100000-0000-4000-8000-000000000002';
select set_config('request.jwt.claims','{"sub":"fa000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$ declare jobs jsonb; begin
 jobs:=public.claim_admin_media_cleanup();
 if jsonb_array_length(jobs)<>1 or jobs->0->>'key'<>'rest/fa000000-0000-4000-8000-000000000002/shared.jpg' then raise exception 'Unused foreign image not leased to admin'; end if;
 if jsonb_array_length(public.claim_admin_media_cleanup())<>0 then raise exception 'Live lease claimed twice'; end if;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"fa000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
-- Wrong identity cannot acknowledge another caller's lease, even for its own key.
do $$ declare leased uuid; begin
 select lease_id into leased from public.media_cleanup where key='rest/fa000000-0000-4000-8000-000000000002/shared.jpg';
 begin perform public.finish_media_cleanup('rest/fa000000-0000-4000-8000-000000000002/shared.jpg',leased); raise exception 'TESTFAIL wrong lease owner';
 exception when raise_exception then if sqlerrm<>'Invalid cleanup lease.' then raise; end if; end;
end $$;
update public.media_cleanup set lease_until=now()-interval '1 second' where key='rest/fa000000-0000-4000-8000-000000000002/shared.jpg';
set local role authenticated;
do $$ declare job jsonb; begin
 job:=public.claim_my_media_cleanup('rest/fa000000-0000-4000-8000-000000000002/shared.jpg');
 if public.media_upload_allowed(job->>'key') then raise exception 'Retired key upload allowed'; end if;
 if not public.media_upload_retired(job->>'key') then raise exception 'Retired upload not detected'; end if;
 perform public.finish_media_cleanup(job->>'key',(job->>'lease_id')::uuid);
 if public.claim_my_media_cleanup(job->>'key')->>'done'<>'true' then raise exception 'Deletion not idempotent'; end if;
 if not public.media_upload_allowed('usr/fa000000-0000-4000-8000-000000000002/fresh.jpg') then raise exception 'Fresh owner upload denied'; end if;
 if public.media_upload_allowed('usr/fa000000-0000-4000-8000-000000000001/foreign.jpg') then raise exception 'Foreign upload allowed'; end if;
end $$;
reset role;
-- Avatar replacement and cascade review deletion both enqueue removed keys.
update public.profiles set avatar_path='https://hidden-plate-pay.hiddenplate-ja.workers.dev/media/usr/fa000000-0000-4000-8000-000000000002/avatar.jpg' where id='fa000000-0000-4000-8000-000000000002';
do $$ begin
 if not public.media_is_referenced('usr/fa000000-0000-4000-8000-000000000002/avatar.jpg') then raise exception 'Full avatar URL not protected'; end if;
end $$;
update public.profiles set avatar_path=null where id='fa000000-0000-4000-8000-000000000002';
update public.reviews set image_paths=array['rev/fa000000-0000-4000-8000-000000000003/review.jpg'] where id='fa200000-0000-4000-8000-000000000002';
delete from public.restaurants where id='fa100000-0000-4000-8000-000000000001';
do $$ begin
 if not exists(select 1 from public.media_cleanup where key='usr/fa000000-0000-4000-8000-000000000002/avatar.jpg' and state='queued')
 or not exists(select 1 from public.media_cleanup where key='rev/fa000000-0000-4000-8000-000000000003/review.jpg' and state='queued') then raise exception 'Removed media trigger missed references'; end if;
 if not exists(select 1 from public.media_cleanup where key='rest/fa000000-0000-4000-8000-000000000002/shared.jpg' and state='done' and attempts=2) then raise exception 'Expired lease retry mismatch'; end if;
end $$;
select set_config('request.jwt.claims','{"sub":"fa000000-0000-4000-8000-000000001103","role":"authenticated"}',true);
set local role authenticated;
do $$ begin
 begin perform public.media_upload_allowed('usr/fa000000-0000-4000-8000-000000001103/photo.jpg'); raise exception 'TESTFAIL pending upload';
 exception when raise_exception then if sqlerrm like 'TESTFAIL%' then raise; end if; end;
end $$;
reset role;
select 'pagination and media cleanup tests passed; rollback follows' as result;
rollback;
