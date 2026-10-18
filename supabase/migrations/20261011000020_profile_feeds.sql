begin;
-- Follows are visible to active members; writes derive the follower on the server.
revoke all on public.follows from public,anon,authenticated;
grant select on public.follows to authenticated;
do $$ declare cols text; begin
 select string_agg(quote_ident(column_name),',') into cols from information_schema.columns where table_schema='public'and table_name='follows';
 execute 'revoke insert('||cols||'),update('||cols||'),references('||cols||') on public.follows from public,anon,authenticated';
end $$;
create policy "follows visible members" on public.follows as restrictive for select to authenticated
 using(public.community_author_visible(follower_id)and public.community_author_visible(following_id));
create function public.set_member_follow(target_user uuid,following boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare caller uuid:=public.require_active_account(); begin
 if target_user is null or target_user=caller or following is null then raise exception 'Invalid follow.';end if;
 if following then
  if not public.community_author_visible(target_user)then raise exception 'This account is unavailable.';end if;
  insert into public.follows(follower_id,following_id)values(caller,target_user)on conflict do nothing;
 else delete from public.follows where follower_id=caller and following_id=target_user;end if;
 -- Composite-key relationships have no row ID. Return an opaque target token.
 return target_user;
end $$;

create function public.community_review_page(target_user uuid default null,following_only boolean default false,
 after_id uuid default null,page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare caller uuid:=public.require_active_account(); result jsonb; lim integer:=greatest(1,least(coalesce(page_size,20),250));begin
 with visible as materialized(select r.* from public.reviews r join public.restaurants s on s.id=r.restaurant_id
  where not r.is_hidden and public.community_author_visible(r.user_id)and(s.is_active or s.owner_id=caller or public.is_admin())
  and(target_user is null or r.user_id=target_user)
  and(not coalesce(following_only,false)or exists(select 1 from public.follows f where f.follower_id=caller and f.following_id=r.user_id))),
 anchor as(select * from visible where id=after_id),
 page as(select * from visible v where after_id is null or exists(select 1 from anchor a where v.created_at<a.created_at or(v.created_at=a.created_at and v.id>a.id))order by created_at desc,id limit lim+1)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(p)order by created_at desc,id)from page p),'[]'),'total',(select count(*)from visible))into result;return result;
end $$;
create function public.community_review_detail(target_review uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare caller uuid:=public.require_active_account(); result jsonb;begin
 select to_jsonb(r)into result from public.reviews r where r.id=target_review and public.community_target_visible('review',r.id);
 return result;
end $$;
create function public.my_restaurant_review(target_restaurant uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare caller uuid:=public.require_active_account(); result jsonb;begin
 -- Include the author's hidden review so the edit screen cannot create a duplicate.
 select to_jsonb(r)into result from public.reviews r where r.restaurant_id=target_restaurant and r.user_id=caller;
 return result;
end $$;
create function public.liked_content_page(content_kind text,target_user uuid,after_id uuid default null,page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare caller uuid:=public.require_active_account(); result jsonb;lim integer:=greatest(1,least(coalesce(page_size,20),250));begin
 if content_kind is null or content_kind not in('review','post')or target_user is null then raise exception 'Invalid liked-content query.';end if;
 with visible as materialized(
  select l.review_id id,l.created_at liked_at,to_jsonb(r)content from public.review_likes l join public.reviews r on r.id=l.review_id
   where content_kind='review'and l.user_id=target_user and public.community_author_visible(target_user)and public.community_target_visible('review',r.id)
  union all select l.post_id,l.created_at,to_jsonb(p)from public.post_likes l join public.posts p on p.id=l.post_id
   where content_kind='post'and l.user_id=target_user and public.community_author_visible(target_user)and public.community_target_visible('post',p.id)),
 anchor as(select * from visible where id=after_id),
 page as(select * from visible v where after_id is null or exists(select 1 from anchor a where v.liked_at<a.liked_at or(v.liked_at=a.liked_at and v.id>a.id))order by liked_at desc,id limit lim+1)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(p)order by liked_at desc,id)from page p),'[]'),'total',(select count(*)from visible))into result;return result;
end $$;
create function public.user_review_statistics(target_user uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare caller uuid:=public.require_active_account(); result jsonb;begin
 select jsonb_build_object('reviewCount',count(*),'averageRating',coalesce(round(avg(r.rating),1),0),
  'parishesVisited',count(distinct nullif(btrim(s.parish),'')))into result
 from public.reviews r join public.restaurants s on s.id=r.restaurant_id
 where r.user_id=target_user and not r.is_hidden and public.community_author_visible(target_user)
 and(s.is_active or s.owner_id=caller or public.is_admin());return result;
end $$;
create function public.member_follow_counts(target_user uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare caller uuid:=public.require_active_account();result jsonb;begin
 select jsonb_build_object('followerCount',count(*)filter(where following_id=target_user),
 'followingCount',count(*)filter(where follower_id=target_user))into result from public.follows
 where(follower_id=target_user or following_id=target_user)
 and public.community_author_visible(follower_id)and public.community_author_visible(following_id);return result;
end $$;
create function public.member_follow_page(target_user uuid,direction text,after_id uuid default null,page_size integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare caller uuid:=public.require_active_account();result jsonb;lim integer:=greatest(1,least(coalesce(page_size,30),250));begin
 if target_user is null or direction is null or direction not in('followers','following')then raise exception 'Invalid follow query.';end if;
 with edges as materialized(select case direction when 'followers'then follower_id else following_id end id,created_at
  from public.follows where((direction='followers'and following_id=target_user)or(direction='following'and follower_id=target_user))
  and public.community_author_visible(follower_id)and public.community_author_visible(following_id)),
 visible as materialized(select e.*,to_jsonb(p)profile from edges e join public.public_profiles p on p.id=e.id),
 anchor as(select * from visible where id=after_id),
 page as(select * from visible v where after_id is null or exists(select 1 from anchor a where v.created_at<a.created_at or(v.created_at=a.created_at and v.id>a.id))order by created_at desc,id limit lim+1)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(p)order by created_at desc,id)from page p),'[]'),'total',(select count(*)from visible))into result;return result;
end $$;
create or replace function public.suggest_public_profiles(result_limit integer default 10)
returns setof public.public_profiles language plpgsql stable security definer set search_path='' as $$
declare caller uuid:=public.require_active_account();begin
 if result_limit is null or result_limit not between 1 and 100 then raise exception 'Invalid suggestion limit.';end if;
 return query with counts as(select f.following_id,count(*)followers from public.follows f
 where public.community_author_visible(f.follower_id)and public.community_author_visible(f.following_id)group by f.following_id)
 select p.* from public.public_profiles p left join counts c on c.following_id=p.id
 where p.id<>caller and public.community_author_visible(p.id)
 order by coalesce(c.followers,0)desc,p.created_at desc,p.id desc limit result_limit;
end $$;
revoke all on function public.set_member_follow(uuid,boolean),public.community_review_page(uuid,boolean,uuid,integer),
 public.community_review_detail(uuid),public.my_restaurant_review(uuid),public.liked_content_page(text,uuid,uuid,integer),
 public.user_review_statistics(uuid),public.member_follow_counts(uuid),public.member_follow_page(uuid,text,uuid,integer),
 public.suggest_public_profiles(integer)from public,anon;
grant execute on function public.set_member_follow(uuid,boolean),public.community_review_page(uuid,boolean,uuid,integer),
 public.community_review_detail(uuid),public.my_restaurant_review(uuid),public.liked_content_page(text,uuid,uuid,integer),
 public.user_review_statistics(uuid),public.member_follow_counts(uuid),public.member_follow_page(uuid,text,uuid,integer),
 public.suggest_public_profiles(integer)to authenticated;
create index if not exists reviews_member_feed_idx on public.reviews(user_id,created_at desc,id)where not is_hidden;
create index if not exists review_likes_member_cursor_idx on public.review_likes(user_id,created_at desc,review_id);
create index if not exists post_likes_member_cursor_idx on public.post_likes(user_id,created_at desc,post_id);
create index if not exists follows_followers_cursor_idx on public.follows(following_id,created_at desc,follower_id);
create index if not exists follows_following_cursor_idx on public.follows(follower_id,created_at desc,following_id);
notify pgrst,'reload schema';
commit;
