begin read only;
do $$ declare f text;begin
 if not exists(select 1 from pg_class where oid='public.follows'::regclass and relrowsecurity)then raise exception 'Follow RLS missing';end if;
 if has_table_privilege('authenticated','public.follows','INSERT,UPDATE,DELETE')or has_table_privilege('anon','public.follows','SELECT')then raise exception 'Unsafe follow grants';end if;
 if exists(select 1 from information_schema.column_privileges where table_schema='public'and table_name='follows'and grantee in('PUBLIC','anon','authenticated')and privilege_type in('INSERT','UPDATE','REFERENCES'))then raise exception 'Unsafe follow column grants';end if;
 foreach f in array array['set_member_follow(uuid,boolean)','community_review_page(uuid,boolean,uuid,integer)','community_review_detail(uuid)','my_restaurant_review(uuid)','liked_content_page(text,uuid,uuid,integer)','user_review_statistics(uuid)','member_follow_counts(uuid)','member_follow_page(uuid,text,uuid,integer)','suggest_public_profiles(integer)']loop
  if has_function_privilege('anon','public.'||f,'EXECUTE')or not has_function_privilege('authenticated','public.'||f,'EXECUTE')then raise exception 'Unsafe RPC permissions: %',f;end if;
 end loop;
 if exists(select 1 from auth.users where id::text like 'fe000000-%'or id::text like 'fe900000-%')
 or exists(select 1 from public.profiles where id::text like 'fe000000-%'or id::text like 'fe900000-%')
 or exists(select 1 from public.restaurants where id::text like 'fe400000-%')
 or exists(select 1 from public.reviews where id::text like 'fe500000-%')
 or exists(select 1 from public.posts where id::text like 'fe100000-%')
 or exists(select 1 from public.review_likes where user_id::text like 'fe000000-%')
 or exists(select 1 from public.post_likes where user_id::text like 'fe000000-%')
 or exists(select 1 from public.follows where follower_id::text like 'fe000000-%'or follower_id::text like 'fe900000-%'or following_id::text like 'fe000000-%')
 or exists(select 1 from public.notifications where user_id::text like 'fe000000-%'or actor_id::text like 'fe000000-%')then raise exception 'Profile-feed fixtures remain';end if;
end $$;
select 'Nine RPCs and follow security verified; zero profile-feed fixtures remain'as result;
commit;
