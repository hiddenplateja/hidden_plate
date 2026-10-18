-- Run AFTER migration 21, or with that migration in this SAME rollback transaction.
-- Synthetic accounts only. No Auth API, device push or physical R2 deletion runs.
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,encrypted_password,raw_user_meta_data)
select ('fd000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','deletion-fixture-'||n||'@example.test',now(),'not-a-real-hash','{}'::jsonb from generate_series(1,3)n;
delete from public.auth_signup_pending where user_id::text like 'fd000000-%';
update public.profiles set preferences='{"notificationsEnabled":false}',avatar_path='usr/'||id||'/avatar.jpg'where id::text like 'fd000000-%';
insert into public.restaurants(id,name,slug,address,parish,latitude,longitude,is_active,owner_id,added_by)
values('fd400000-0000-4000-8000-000000000001','Deletion fixture','deletion-fixture','Fixture Road','Kingston',18,-77,true,'fd000000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000001');
insert into public.reviews(id,restaurant_id,user_id,rating,comment,image_paths,is_hidden)
values('fd500000-0000-4000-8000-000000000001','fd400000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000001',5,'Kept review',array['rev/fd000000-0000-4000-8000-000000000001/photo.jpg'],false),
('fd500000-0000-4000-8000-000000000002','fd400000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000002',1,'Hidden review','{}',true);
insert into public.posts(id,user_id,text,image_paths)values('fd100000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000001','Kept post',array['post/fd000000-0000-4000-8000-000000000001/photo.jpg']);
insert into public.posts(id,user_id,text)values('fd100000-0000-4000-8000-000000000003','fd000000-0000-4000-8000-000000000003','Banned content stays unavailable');
update public.profiles set is_banned=true where id='fd000000-0000-4000-8000-000000000003';
insert into public.post_comments(post_id,user_id,text)values('fd100000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000001','Kept post comment');
insert into public.post_likes(post_id,user_id)values('fd100000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000001'),('fd100000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000002');
select set_config('request.jwt.claims','{"sub":"fd000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into public.review_comments(id,review_id,user_id,text)
select ('fd600000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'fd500000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000001','Kept comment '||n from generate_series(1,1001)n;
insert into public.review_likes(review_id,user_id)values('fd500000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claims','{"sub":"fd000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
insert into public.review_comments(review_id,user_id,text)values('fd500000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000002','Another member');
insert into public.review_likes(review_id,user_id)values('fd500000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000002');
insert into public.saved_restaurants(user_id,restaurant_id,list_type)values('fd000000-0000-4000-8000-000000000001','fd400000-0000-4000-8000-000000000001','favorite');
insert into public.follows(follower_id,following_id)values('fd000000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000002'),('fd000000-0000-4000-8000-000000000002','fd000000-0000-4000-8000-000000000001');
insert into public.blocks(blocker_id,blocked_id)values('fd000000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000003'),('fd000000-0000-4000-8000-000000000003','fd000000-0000-4000-8000-000000000001');
insert into public.collections(owner_id,title,is_public)values('fd000000-0000-4000-8000-000000000001','Delete own collection',true);
insert into public.push_tokens(user_id,token,platform)values('fd000000-0000-4000-8000-000000000001','ExpoPushToken[deletion-fixture]','android');
insert into public.notifications(user_id,actor_id,type,title,body,data)values
('fd000000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000002','follow','Fixture','Private recipient','{}'),
('fd000000-0000-4000-8000-000000000002','fd000000-0000-4000-8000-000000000001','follow','Fixture','Private actor name','{"actorName":"Private"}');
insert into public.review_reports(review_id,restaurant_id,reported_by_user_id,reason)values('fd500000-0000-4000-8000-000000000002','fd400000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000001','other');
insert into public.restaurant_claims(restaurant_id,user_id,contact_name,contact_email,proof_note)values('fd400000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000001','Private','fixture@example.test','Private proof');
insert into public.restaurant_menus(restaurant_id,owner_id,menu)values('fd400000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000001','[]');
insert into public.review_responses(review_id,restaurant_id,author_id,text)values('fd500000-0000-4000-8000-000000000002','fd400000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000001','Owner reply');
insert into public.restaurant_views(restaurant_id,user_id)values('fd400000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000001');

set local role authenticated;
do $$begin
 if has_table_privilege('authenticated','public.account_deletion_jobs','SELECT,INSERT,UPDATE,DELETE')or has_table_privilege('anon','public.account_deletion_jobs','SELECT')then raise exception 'Unsafe deletion job grants';end if;
 if has_function_privilege('authenticated','public.prepare_account_deletion(uuid)','EXECUTE')or has_function_privilege('anon','public.complete_account_deletion(uuid)','EXECUTE')or has_function_privilege('authenticated','public.pending_account_deletions()','EXECUTE')then raise exception 'Unsafe deletion RPC grants';end if;
 begin perform public.prepare_account_deletion('fd000000-0000-4000-8000-000000000001');raise exception 'Client initiated privileged deletion';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claims','{}',true);
do $$declare s jsonb;again jsonb;t text;begin
 s:=public.prepare_account_deletion('fd000000-0000-4000-8000-000000000001');
 again:=public.prepare_account_deletion('fd000000-0000-4000-8000-000000000001');
 if s<>again or(s->>'reviewsAnonymized')::int<>1 or(s->>'commentsAnonymized')::int<>1001 or(s->>'likesDeleted')::int<>2 or(s->>'followsDeleted')::int<>2 or(s->>'reportsDeleted')::int<>1 then raise exception 'Full counts or idempotency failed: %',s;end if;
 if(s->>'authAccountDeleted')::boolean or not exists(select 1 from auth.users where id='fd000000-0000-4000-8000-000000000001')then raise exception 'Auth was not retained for last step';end if;
 if exists(select 1 from public.profiles where id='fd000000-0000-4000-8000-000000000001')then raise exception 'Private profile retained';end if;
 if not exists(select 1 from public.reviews where id='fd500000-0000-4000-8000-000000000001'and user_id is null and rating=5 and comment='Kept review'and cardinality(image_paths)=1 and comment_count=1002 and like_count=1)then raise exception 'Reviews, counters or photos not preserved';end if;
 if(select count(*)from public.review_comments where review_id='fd500000-0000-4000-8000-000000000001'and user_id is null)<>1001 then raise exception 'Comments were capped/lost';end if;
 if not exists(select 1 from public.posts where id='fd100000-0000-4000-8000-000000000001'and user_id is null and cardinality(image_paths)=1)or not exists(select 1 from public.post_comments where post_id='fd100000-0000-4000-8000-000000000001'and user_id is null)then raise exception 'Post threads not preserved';end if;
 if not exists(select 1 from public.restaurants where id='fd400000-0000-4000-8000-000000000001'and owner_id is null and added_by is null and review_count=1 and average_rating=5)then raise exception 'Listing or rating lost';end if;
 if exists(select 1 from public.notifications where user_id='fd000000-0000-4000-8000-000000000001'or actor_id='fd000000-0000-4000-8000-000000000001')or exists(select 1 from public.push_tokens where user_id='fd000000-0000-4000-8000-000000000001')then raise exception 'Private notification/token copies retained';end if;
 if exists(select 1 from public.collections where owner_id='fd000000-0000-4000-8000-000000000001')or exists(select 1 from public.restaurant_claims where user_id='fd000000-0000-4000-8000-000000000001')or exists(select 1 from public.restaurant_menus where owner_id='fd000000-0000-4000-8000-000000000001')or exists(select 1 from public.review_responses where author_id='fd000000-0000-4000-8000-000000000001')then raise exception 'Private/owner data retained';end if;
 if exists(select 1 from public.saved_restaurants where user_id='fd000000-0000-4000-8000-000000000001')or exists(select 1 from public.follows where follower_id='fd000000-0000-4000-8000-000000000001'or following_id='fd000000-0000-4000-8000-000000000001')or exists(select 1 from public.blocks where blocker_id='fd000000-0000-4000-8000-000000000001'or blocked_id='fd000000-0000-4000-8000-000000000001')then raise exception 'Relationships/saves retained';end if;
 if not exists(select 1 from public.media_cleanup where key='usr/fd000000-0000-4000-8000-000000000001/avatar.jpg')or exists(select 1 from public.media_cleanup where key in('rev/fd000000-0000-4000-8000-000000000001/photo.jpg','post/fd000000-0000-4000-8000-000000000001/photo.jpg'))then raise exception 'Retained media incorrectly queued';end if;
 begin perform public.complete_account_deletion('fd000000-0000-4000-8000-000000000001');raise exception 'Premature Auth success';exception when raise_exception then if sqlerrm<>'Auth deletion is not complete.'then raise;end if;end;
end $$;
select set_config('request.jwt.claims','{"sub":"fd000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$begin
 if public.is_active_account()then raise exception 'Old JWT still active';end if;
 begin perform public.create_community_post('Denied','{}');raise exception 'Old JWT could write';exception when raise_exception then if sqlerrm<>'You must be signed in to an active account.'then raise;end if;end;
 if exists(select 1 from public.posts where id='fd100000-0000-4000-8000-000000000001')then raise exception 'Deleted caller could read community';end if;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"fd000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
do $$begin
 if not exists(select 1 from public.posts where id='fd100000-0000-4000-8000-000000000001')or not exists(select 1 from public.review_comments where id='fd600000-0000-4000-8000-000000000001')then raise exception 'Deleted author threads disappeared';end if;
end $$;
reset role;
select set_config('request.jwt.claims','{}',true);
select public.prepare_account_deletion('fd000000-0000-4000-8000-000000000003');
select set_config('request.jwt.claims','{"sub":"fd000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
do $$begin
 if exists(select 1 from public.posts where id='fd100000-0000-4000-8000-000000000003')or public.community_target_visible('post','fd100000-0000-4000-8000-000000000003')then raise exception 'Deletion bypassed account moderation';end if;
end $$;
reset role;
select set_config('request.jwt.claims','{}',true);
-- Simulate the external Auth-last operation only for this rollback fixture.
delete from auth.users where id='fd000000-0000-4000-8000-000000000001';
do $$declare s jsonb;begin
 s:=public.complete_account_deletion('fd000000-0000-4000-8000-000000000001');
 if not(s->>'authAccountDeleted')::boolean or s<>public.complete_account_deletion('fd000000-0000-4000-8000-000000000001')then raise exception 'Completion/retry failed';end if;
 if exists(select 1 from public.pending_account_deletions()u where u='fd000000-0000-4000-8000-000000000001')then raise exception 'Completed job still pending';end if;
end $$;
select 'Account deletion preservation, full counts, permissions and retries passed (rolled back)'as result;
rollback;
