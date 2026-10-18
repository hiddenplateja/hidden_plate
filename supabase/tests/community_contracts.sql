-- Non-production fixtures. Rollback also cancels queued push HTTP work.
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,encrypted_password,raw_user_meta_data)
select ('fd000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','community-fixture-'||n||'@example.test',now(),'not-a-real-hash','{}'::jsonb from generate_series(1,5)n
union all select ('fd900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','community-count-'||n||'@example.test',now(),'not-a-real-hash','{}'::jsonb from generate_series(100,1100)n;
delete from public.auth_signup_pending where user_id::text like 'fd900000-%' or user_id in('fd000000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000002','fd000000-0000-4000-8000-000000000003','fd000000-0000-4000-8000-000000000004');
update public.profiles set role='admin'where id='fd000000-0000-4000-8000-000000000001';
update public.profiles set is_banned=true where id='fd000000-0000-4000-8000-000000000004';
insert into public.restaurants(id,name,slug,address,parish,latitude,longitude,is_active)values('fd400000-0000-4000-8000-000000000001','Community Fixture','community-fixture','Fixture Road','Kingston',18,-77,true);
insert into public.reviews(id,restaurant_id,user_id,rating)values('fd500000-0000-4000-8000-000000000001','fd400000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000002',5);
insert into public.posts(id,user_id,text,created_at)
select ('fd100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,case when n=3 then 'fd000000-0000-4000-8000-000000000004'::uuid else 'fd000000-0000-4000-8000-000000000002'::uuid end,'Fixture post','2099-01-01'::timestamptz from generate_series(1,3)n
union all select ('fd110000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'fd000000-0000-4000-8000-000000000002'::uuid,'Paged fixture','2099-01-01'::timestamptz from generate_series(100,350)n;
insert into public.post_comments(id,post_id,user_id,text,created_at)
select ('fd300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'fd100000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000002','Count fixture','2099-01-01' from generate_series(1,1001)n;
insert into public.post_likes(post_id,user_id)
select 'fd100000-0000-4000-8000-000000000001',('fd900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(100,1100)n;
insert into public.follows(follower_id,following_id)values('fd000000-0000-4000-8000-000000000003','fd000000-0000-4000-8000-000000000002');
insert into public.notifications(id,user_id,actor_id,type,title,body,created_at)
select ('fd600000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'fd000000-0000-4000-8000-000000000003',null,'new_restaurant','Fixture','Fixture','2099-01-01' from generate_series(1,1001)n;
insert into public.notifications(id,user_id,actor_id,type,title,body,created_at)
values('fd600000-0000-4000-8000-000000001002','fd000000-0000-4000-8000-000000000003','fd000000-0000-4000-8000-000000000002','follow','Actor fixture','Fixture','2099-01-01');
select set_config('request.jwt.claims','{"sub":"fd000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
do $$ declare p public.posts; result jsonb; c jsonb; t text; begin
 foreach t in array array['posts','post_comments','post_likes','review_comments','review_likes']loop
  if has_table_privilege('authenticated','public.'||t,'INSERT')or has_table_privilege('authenticated','public.'||t,'UPDATE')or has_table_privilege('authenticated','public.'||t,'DELETE')or has_table_privilege('anon','public.'||t,'SELECT')then raise exception 'Unsafe community grants';end if;
 end loop;
 if has_function_privilege('anon','public.create_community_post(text,text[])','EXECUTE')or has_function_privilege('anon','public.my_notification_page(uuid,integer)','EXECUTE')or has_function_privilege('authenticated','public.validated_community_text(text,integer)','EXECUTE')then raise exception 'Unsafe RPC grants';end if;
 select * into p from public.create_community_post(' Hello ',array['post/fd000000-0000-4000-8000-000000000003/photo.jpg']);
 if p.user_id<>auth.uid()or p.text<>'Hello'then raise exception 'Post identity mismatch';end if;
 perform set_config('fixture.post',p.id::text,true);
 begin perform public.create_community_post('Visit example.com');raise exception 'Link allowed';exception when raise_exception then if sqlerrm<>'Links are not allowed.'then raise;end if;end;
 begin perform public.create_community_post(repeat('x',501));raise exception 'Overlong post allowed';exception when raise_exception then if sqlerrm<>'Invalid text length.'then raise;end if;end;
 begin perform public.create_community_post('Images',array['post/fd000000-0000-4000-8000-000000000002/other.jpg']);raise exception 'Foreign image allowed';exception when raise_exception then if sqlerrm<>'Invalid post images.'then raise;end if;end;
 c:=public.write_community_comment('review','fd500000-0000-4000-8000-000000000001',' Nice ','fd400000-0000-4000-8000-000000000001');
 if c->>'user_id'<>auth.uid()::text or c->>'restaurant_id'<>'fd400000-0000-4000-8000-000000000001'or c->>'text'<>'Nice'then raise exception 'Comment contract mismatch';end if;
 perform set_config('fixture.review_comment',c->>'id',true);
 begin perform public.write_community_comment('review','fd500000-0000-4000-8000-000000000001','Forged',gen_random_uuid());raise exception 'Forged parent allowed';exception when raise_exception then if sqlerrm<>'Review restaurant does not match.'then raise;end if;end;
 begin perform public.write_community_comment('post','fd100000-0000-4000-8000-000000000001','name@example.com');raise exception 'Comment email allowed';exception when raise_exception then if sqlerrm<>'Links are not allowed.'then raise;end if;end;
 c:=public.write_community_comment('post','fd100000-0000-4000-8000-000000000001','Nice');perform set_config('fixture.post_comment',c->>'id',true);
 perform public.set_community_like('review','fd500000-0000-4000-8000-000000000001',true);
 perform public.set_community_like('review','fd500000-0000-4000-8000-000000000001',true);
 if(select like_count from public.reviews where id='fd500000-0000-4000-8000-000000000001')<>1 or(select comment_count from public.reviews where id='fd500000-0000-4000-8000-000000000001')<>1 then raise exception 'Review counters incorrect';end if;
 perform public.set_community_like('post','fd100000-0000-4000-8000-000000000001',true);perform public.set_community_like('post','fd100000-0000-4000-8000-000000000001',true);
 result:=public.community_post_counts(array['fd100000-0000-4000-8000-000000000001'::uuid]);
 if result->0->>'likes'<>'1002'or result->0->>'comments'<>'1002'then raise exception 'Post counts truncated';end if;
 result:=public.community_post_page('fd000000-0000-4000-8000-000000000002',true,null,1);
 if result->>'total'<>'253'or result->'items'->0->>'id'<>'fd100000-0000-4000-8000-000000000001'or jsonb_array_length(result->'items')<>2 then raise exception 'Post page/lookahead failed';end if;
 result:=public.community_post_page('fd000000-0000-4000-8000-000000000002',true,'fd100000-0000-4000-8000-000000000001',1);
 if result->'items'->0->>'id'<>'fd100000-0000-4000-8000-000000000002'then raise exception 'Tied post cursor failed';end if;
 if jsonb_array_length(public.community_post_page(null,false,null,1000)->'items')<>251 then raise exception 'Page bound failed';end if;
 result:=public.community_comment_page('post','fd100000-0000-4000-8000-000000000001','fd300000-0000-4000-8000-000000000100',1);
 if result->>'total'<>'1002'or result->'items'->0->>'id'<>'fd300000-0000-4000-8000-000000000101'then raise exception 'Comment cursor/count failed';end if;
 if exists(select 1 from public.posts where id='fd100000-0000-4000-8000-000000000003')then raise exception 'Banned author leak';end if;
 if public.my_unread_notification_count()<>1002 then raise exception 'Unread count capped or alien inbox leaked';end if;
 result:=public.my_notification_page('fd600000-0000-4000-8000-000000000100',1);
 if result->>'total'<>'1002'or result->'items'->0->>'id'<>'fd600000-0000-4000-8000-000000000101'then raise exception 'Inbox cursor failed';end if;
 begin perform public.delete_community_content('post','fd100000-0000-4000-8000-000000000001');raise exception 'Other author deletion allowed';exception when raise_exception then if sqlerrm<>'Content not found or not yours.'then raise;end if;end;
end $$;
reset role;
-- Both block directions must suppress reads and inbox before pagination/counting.
insert into public.blocks(blocker_id,blocked_id)values('fd000000-0000-4000-8000-000000000002','fd000000-0000-4000-8000-000000000003');
set local role authenticated;
do $$ begin
 if exists(select 1 from public.posts where user_id='fd000000-0000-4000-8000-000000000002')or exists(select 1 from public.review_comments where review_id='fd500000-0000-4000-8000-000000000001')then raise exception 'Blocked community leak';end if;
 if public.my_unread_notification_count()<>1001 or public.my_notification_page()->>'total'<>'1001'then raise exception 'Blocked inbox/count mismatch';end if;
 if public.community_post_counts(array['fd100000-0000-4000-8000-000000000001'::uuid])<>'[]'::jsonb then raise exception 'Blocked counts leak';end if;
 begin perform public.set_community_like('post','fd100000-0000-4000-8000-000000000001',true);raise exception 'Blocked like allowed';exception when raise_exception then if sqlerrm<>'Content is unavailable.'then raise;end if;end;
 begin perform public.write_community_comment('review','fd500000-0000-4000-8000-000000000001','Blocked');raise exception 'Blocked comment allowed';exception when raise_exception then if sqlerrm<>'Content is unavailable.'then raise;end if;end;
 perform public.set_community_like('review','fd500000-0000-4000-8000-000000000001',false);
 perform public.set_community_like('post','fd100000-0000-4000-8000-000000000001',false);
 perform public.delete_community_content('review_comment',current_setting('fixture.review_comment')::uuid);
 perform public.delete_community_content('post_comment',current_setting('fixture.post_comment')::uuid);
 perform public.delete_community_content('post',current_setting('fixture.post')::uuid);
end $$;
reset role;
delete from public.blocks where blocker_id='fd000000-0000-4000-8000-000000000002'and blocked_id='fd000000-0000-4000-8000-000000000003';
update public.reviews set is_hidden=true where id='fd500000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ begin
 begin perform public.set_community_like('review','fd500000-0000-4000-8000-000000000001',true);raise exception 'Hidden review like allowed';exception when raise_exception then if sqlerrm<>'Content is unavailable.'then raise;end if;end;
end $$;
reset role;
do $$ declare actor uuid; begin foreach actor in array array['fd000000-0000-4000-8000-000000000004'::uuid,'fd000000-0000-4000-8000-000000000005'::uuid]loop
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 begin perform public.create_community_post('Denied');raise exception 'Inactive caller post allowed';exception when raise_exception then if sqlerrm<>'You must be signed in to an active account.'then raise;end if;end;
 begin perform public.set_community_like('post','fd100000-0000-4000-8000-000000000001',true);raise exception 'Inactive caller like allowed';exception when raise_exception then if sqlerrm<>'You must be signed in to an active account.'then raise;end if;end;
 begin perform public.write_community_comment('post','fd100000-0000-4000-8000-000000000001','Denied');raise exception 'Inactive caller comment allowed';exception when raise_exception then if sqlerrm<>'You must be signed in to an active account.'then raise;end if;end;
end loop;end $$;
select set_config('request.jwt.claims','{"sub":"fd000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select public.delete_community_content('post','fd100000-0000-4000-8000-000000000001');
reset role;
do $$ begin if exists(select 1 from public.post_comments where post_id='fd100000-0000-4000-8000-000000000001')or exists(select 1 from public.post_likes where post_id='fd100000-0000-4000-8000-000000000001')then raise exception 'Post cascade failed';end if;end $$;
rollback;
select 'community contracts passed; fixtures and pushes rolled back' as result;
