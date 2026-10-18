-- Disposable test accounts/content; no fixtures, notifications or push jobs commit.
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,encrypted_password,raw_user_meta_data)
select ('fe000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','feeds-fixture-'||n||'@example.test',now(),'not-a-real-hash','{}'::jsonb from generate_series(1,5)n
union all select ('fe900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','feeds-count-'||n||'@example.test',now(),'not-a-real-hash','{}'::jsonb from generate_series(100,1100)n;
delete from public.auth_signup_pending where user_id::text like 'fe900000-%'or user_id in('fe000000-0000-4000-8000-000000000001','fe000000-0000-4000-8000-000000000002','fe000000-0000-4000-8000-000000000003','fe000000-0000-4000-8000-000000000004');
update public.profiles set is_banned=true where id='fe000000-0000-4000-8000-000000000004';
update public.profiles set preferences='{"notificationsEnabled":false}'where id::text like 'fe000000-%'or id::text like 'fe900000-%';
update public.profiles set preferences='{"notificationsEnabled":true}'where id='fe000000-0000-4000-8000-000000000001';
insert into public.restaurants(id,name,slug,address,parish,latitude,longitude,is_active)
select ('fe400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Feed fixture '||n,'feed-fixture-'||n,'Fixture Road',case when n%2=0 then 'Kingston'else 'St. Andrew'end,18,-77,n<>1005 from generate_series(1,1006)n;
insert into public.reviews(id,restaurant_id,user_id,rating,is_hidden,created_at)
select ('fe500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('fe400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 case n when 1002 then 'fe000000-0000-4000-8000-000000000004'::uuid when 1003 then 'fe000000-0000-4000-8000-000000000005'::uuid when 1006 then 'fe900000-0000-4000-8000-000000001100'::uuid else 'fe000000-0000-4000-8000-000000000002'::uuid end,5,false,'2099-01-01' from generate_series(1,1006)n;
insert into public.posts(id,user_id,text,created_at)
select ('fe100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'fe000000-0000-4000-8000-000000000002','Liked fixture','2000-01-01' from generate_series(1,251)n;
select set_config('request.jwt.claims','{"sub":"fe000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
insert into public.review_likes(review_id,user_id,created_at)
select ('fe500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'fe000000-0000-4000-8000-000000000003','2099-01-01'from generate_series(1,1006)n;
update public.reviews set is_hidden=true where id='fe500000-0000-4000-8000-000000001004';
insert into public.post_likes(post_id,user_id,created_at)
select ('fe100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'fe000000-0000-4000-8000-000000000003','2099-01-01'from generate_series(1,251)n;
-- A very old item liked most recently must lead the Likes tab.
update public.reviews set created_at='1990-01-01'where id='fe500000-0000-4000-8000-000000001001';
update public.review_likes set created_at='2100-01-01'where review_id='fe500000-0000-4000-8000-000000001001';
update public.posts set created_at='1990-01-01'where id='fe100000-0000-4000-8000-000000000251';
update public.post_likes set created_at='2100-01-01'where post_id='fe100000-0000-4000-8000-000000000251';
insert into public.follows(follower_id,following_id,created_at)
select ('fe900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'fe000000-0000-4000-8000-000000000002','2099-01-01'::timestamptz from generate_series(100,1100)n
union all select 'fe000000-0000-4000-8000-000000000003',('fe900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'2099-01-01'from generate_series(100,1100)n
union all select ('fe000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'fe000000-0000-4000-8000-000000000002','2099-01-01'from generate_series(3,5)n
union all select 'fe000000-0000-4000-8000-000000000003',('fe000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'2099-01-01'from generate_series(4,5)n;
select set_config('request.jwt.claims','{"sub":"fe000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
do $$ declare result jsonb; t text;begin
 if has_table_privilege('authenticated','public.follows','INSERT,UPDATE,DELETE')or has_table_privilege('anon','public.follows','SELECT')then raise exception 'Unsafe follow grants';end if;
 foreach t in array array['community_review_page(uuid,boolean,uuid,integer)','community_review_detail(uuid)','my_restaurant_review(uuid)','liked_content_page(text,uuid,uuid,integer)','user_review_statistics(uuid)','member_follow_counts(uuid)','member_follow_page(uuid,text,uuid,integer)','set_member_follow(uuid,boolean)']loop
 if has_function_privilege('anon','public.'||t,'EXECUTE')then raise exception 'Unsafe RPC grants: %',t;end if;end loop;
 result:=public.community_review_page('fe000000-0000-4000-8000-000000000002',false,null,999);
 if(result->>'total')::int<>1001 or jsonb_array_length(result->'items')<>251 then raise exception 'User review full count/clamp failed';end if;
 result:=public.community_review_page('fe000000-0000-4000-8000-000000000002',false,'fe500000-0000-4000-8000-000000000001',1);
 if result->'items'->0->>'id'<>'fe500000-0000-4000-8000-000000000002'or jsonb_array_length(result->'items')<>2 then raise exception 'Review tie cursor failed';end if;
 result:=public.community_review_page(null,true,null,1);
 if(result->>'total')::int<>1002 then raise exception 'Following graph was capped';end if;
 result:=public.user_review_statistics('fe000000-0000-4000-8000-000000000002');
 if(result->>'reviewCount')::int<>1001 or(result->>'averageRating')::numeric<>5 or(result->>'parishesVisited')::int<>2 then raise exception 'Full review/parish stats failed';end if;
 result:=public.liked_content_page('review','fe000000-0000-4000-8000-000000000003',null,1);
 if(result->>'total')::int<>1002 or(result->'items'->0->>'liked_at')::timestamptz<>'2100-01-01'::timestamptz
 or result->'items'->0->>'id'<>'fe500000-0000-4000-8000-000000001001'then raise exception 'Liked review visibility/time failed: %',result;end if;
 result:=public.liked_content_page('review','fe000000-0000-4000-8000-000000000003','fe500000-0000-4000-8000-000000000001',1);
 if result->'items'->0->>'id'<>'fe500000-0000-4000-8000-000000000002'then raise exception 'Liked review tie failed';end if;
 result:=public.liked_content_page('post','fe000000-0000-4000-8000-000000000003',null,999);
 if(result->>'total')::int<>251 or jsonb_array_length(result->'items')<>251 or result->'items'->0->>'id'<>'fe100000-0000-4000-8000-000000000251'then raise exception 'Liked post paging/recency failed';end if;
 result:=public.member_follow_counts('fe000000-0000-4000-8000-000000000002');
 if(result->>'followerCount')::int<>1002 or(result->>'followingCount')::int<>0 then raise exception 'Follow count failed';end if;
 result:=public.member_follow_counts(auth.uid());if(result->>'followingCount')::int<>1002 then raise exception 'Own follow count failed';end if;
 result:=public.member_follow_page('fe000000-0000-4000-8000-000000000002','followers',null,999);
 if(result->>'total')::int<>1002 or jsonb_array_length(result->'items')<>251 or result->'items'->0->'profile'?'preferences'or result->'items'->0->'profile'?'role'then raise exception 'Follow paging/private projection failed';end if;
 result:=public.member_follow_page('fe000000-0000-4000-8000-000000000002','followers','fe000000-0000-4000-8000-000000000003',1);
 if result->'items'->0->>'id'<>'fe900000-0000-4000-8000-000000000100'then raise exception 'Follow tied cursor failed';end if;
 if(select id from public.suggest_public_profiles(1))<>'fe000000-0000-4000-8000-000000000002'then raise exception 'Suggestion full ranking failed';end if;
 if public.community_review_detail('fe500000-0000-4000-8000-000000001004')is not null or public.my_restaurant_review('fe400000-0000-4000-8000-000000000001')is not null then raise exception 'Hidden/other review leaked';end if;
 perform public.set_member_follow('fe000000-0000-4000-8000-000000000002',true);
 perform public.set_member_follow('fe000000-0000-4000-8000-000000000002',true);
 perform public.set_member_follow('fe000000-0000-4000-8000-000000000001',true);
 perform public.set_member_follow('fe000000-0000-4000-8000-000000000001',true);
 begin perform public.set_member_follow(auth.uid(),true);raise exception 'Self follow allowed';exception when raise_exception then if sqlerrm<>'Invalid follow.'then raise;end if;end;
 foreach t in array array['fe000000-0000-4000-8000-000000000004','fe000000-0000-4000-8000-000000000005']loop
 begin perform public.set_member_follow(t::uuid,true);raise exception 'Unavailable follow allowed';exception when raise_exception then if sqlerrm<>'This account is unavailable.'then raise;end if;end;end loop;
end $$;
reset role;
do $$begin
 if(select count(*)from public.follows where follower_id='fe000000-0000-4000-8000-000000000003'and following_id='fe000000-0000-4000-8000-000000000002')<>1 then raise exception 'Duplicate follow inserted';end if;
 if(select count(*)from public.notifications where user_id='fe000000-0000-4000-8000-000000000001'and actor_id='fe000000-0000-4000-8000-000000000003'and type='follow')<>1 then raise exception 'Follow notification missing/duplicated';end if;
end $$;
select set_config('request.jwt.claims','{"sub":"fe000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
do $$begin if public.my_restaurant_review('fe400000-0000-4000-8000-000000001004')->>'is_hidden'<>'true'then raise exception 'Own hidden review lost';end if;end $$;
reset role;
insert into public.blocks(blocker_id,blocked_id)values('fe000000-0000-4000-8000-000000000002','fe000000-0000-4000-8000-000000000003');
select set_config('request.jwt.claims','{"sub":"fe000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
do $$declare result jsonb;begin
 result:=public.community_review_page('fe000000-0000-4000-8000-000000000002');if(result->>'total')::int<>0 then raise exception 'Blocked feed leaked';end if;
 result:=public.user_review_statistics('fe000000-0000-4000-8000-000000000002');if(result->>'reviewCount')::int<>0 then raise exception 'Blocked stats leaked';end if;
 result:=public.member_follow_counts('fe000000-0000-4000-8000-000000000002');if(result->>'followerCount')::int<>0 then raise exception 'Blocked graph leaked';end if;
 result:=public.liked_content_page('post',auth.uid());if(result->>'total')::int<>0 then raise exception 'Blocked liked post leaked';end if;
 result:=public.liked_content_page('review',auth.uid());if(result->>'total')::int<>1 then raise exception 'Blocked liked reviews not filtered';end if;
 if public.community_review_detail('fe500000-0000-4000-8000-000000000001')is not null then raise exception 'Blocked detail leaked';end if;
 if(select count(*)from public.follows where following_id='fe000000-0000-4000-8000-000000000002')<>0 then raise exception 'Direct follows bypassed block';end if;
 begin perform public.set_member_follow('fe000000-0000-4000-8000-000000000002',true);raise exception 'Blocked follow allowed';exception when raise_exception then if sqlerrm<>'This account is unavailable.'then raise;end if;end;
 perform public.set_member_follow('fe000000-0000-4000-8000-000000000002',false);
 if public.restaurant_rating_distribution('fe400000-0000-4000-8000-000000000001')->>'count'<>'1'then raise exception 'Public ratings changed';end if;
end $$;
reset role;
do $$declare actor uuid;begin foreach actor in array array['fe000000-0000-4000-8000-000000000004'::uuid,'fe000000-0000-4000-8000-000000000005'::uuid]loop
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 begin perform public.community_review_page();raise exception 'Inactive feed allowed';exception when raise_exception then if sqlerrm<>'You must be signed in to an active account.'then raise;end if;end;
 begin perform public.member_follow_counts(actor);raise exception 'Inactive stats allowed';exception when raise_exception then if sqlerrm<>'You must be signed in to an active account.'then raise;end if;end;
 begin perform public.set_member_follow('fe000000-0000-4000-8000-000000000001',true);raise exception 'Inactive follow allowed';exception when raise_exception then if sqlerrm<>'You must be signed in to an active account.'then raise;end if;end;
end loop;end $$;
rollback;
select 'profile feeds passed; all fixtures and queued work rolled back'as result;
