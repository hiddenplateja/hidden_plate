begin;
-- These helpers return only visibility, never private profile/block rows.
create function public.community_author_visible(author uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select public.is_active_account() and exists(select 1 from public.profiles where id=author and not is_banned)
 and not exists(select 1 from public.auth_signup_pending where user_id=author)
 and not exists(select 1 from public.blocks where (blocker_id=auth.uid() and blocked_id=author) or (blocked_id=auth.uid() and blocker_id=author));
$$;
create function public.community_target_visible(content_kind text,target_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select case content_kind when 'post' then exists(select 1 from public.posts p where p.id=target_id and public.community_author_visible(p.user_id))
 when 'review' then exists(select 1 from public.reviews r join public.restaurants s on s.id=r.restaurant_id
 where r.id=target_id and not r.is_hidden and public.community_author_visible(r.user_id)
 and (s.is_active or s.owner_id=auth.uid() or public.is_admin())) else false end;
$$;
revoke all on function public.community_author_visible(uuid),public.community_target_visible(text,uuid) from public,anon;
grant execute on function public.community_author_visible(uuid),public.community_target_visible(text,uuid) to authenticated;

-- Match existing signed-in community access. All writes go through bounded RPCs.
revoke all on public.posts,public.post_comments,public.post_likes,public.review_comments,public.review_likes from public,anon,authenticated;
grant select on public.posts,public.post_comments,public.post_likes,public.review_comments,public.review_likes to authenticated;
-- Remove possible inherited column grants as well as table grants.
do $$ declare t text; cols text; begin
 foreach t in array array['posts','post_comments','post_likes','review_comments','review_likes'] loop
  select string_agg(quote_ident(column_name),',') into cols from information_schema.columns where table_schema='public' and table_name=t;
  execute 'revoke insert('||cols||'),update('||cols||'),references('||cols||') on public.'||quote_ident(t)||' from public,anon,authenticated';
 end loop;
end $$;
create policy "posts visible community" on public.posts as restrictive for select to authenticated using(public.community_author_visible(user_id));
create policy "post comments visible community" on public.post_comments as restrictive for select to authenticated
 using(public.community_author_visible(user_id) and public.community_target_visible('post',post_id));
create policy "post likes visible community" on public.post_likes as restrictive for select to authenticated
 using(public.community_author_visible(user_id) and public.community_target_visible('post',post_id));
create policy "review comments visible community" on public.review_comments as restrictive for select to authenticated
 using(public.community_author_visible(user_id) and public.community_target_visible('review',review_id));
create policy "review likes visible community" on public.review_likes as restrictive for select to authenticated
 using(public.community_author_visible(user_id) and public.community_target_visible('review',review_id));

create function public.validated_community_text(input_text text,max_length integer)
returns text language plpgsql immutable set search_path='' as $$
declare body text:=btrim(input_text); normalized text; begin
 if body is null or length(body) not between 1 and max_length then raise exception 'Invalid text length.'; end if;
 normalized:=lower(translate(body,'．。․˙܁܂','......')); -- client also checks obfuscated links
 if normalized ~ '(https?://|ftp://|hxxps?://|www[.]|[[:alnum:]-]+[.](com|net|org|io|co|app|dev|me|info|biz|ly|gov|edu|jm)([.][a-z]{2})?\y|[[:alnum:]_.%+-]+@[[:alnum:].-]+[.][a-z]{2,})' then
  raise exception 'Links are not allowed.';
 end if; return body;
end $$;
revoke all on function public.validated_community_text(text,integer) from public,anon,authenticated;
create function public.create_community_post(post_text text,post_images text[] default '{}')
returns public.posts language plpgsql security definer set search_path='' as $$
declare caller uuid:=public.require_active_account(); body text:=public.validated_community_text(post_text,500); result public.posts; begin
 if post_images is null or cardinality(post_images)>4 or exists(select 1 from unnest(post_images) k
  where k is null or length(k)>512 or k !~ ('^post/'||caller::text||'/[a-zA-Z0-9._-]+[.](jpg|png|webp)$')) then raise exception 'Invalid post images.'; end if;
 insert into public.posts(user_id,text,image_paths)values(caller,body,post_images)returning * into result;
 return result;
end $$;
create function public.write_community_comment(content_kind text,target_id uuid,comment_text text,target_restaurant uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare caller uuid:=public.require_active_account(); body text:=public.validated_community_text(comment_text,1000); result jsonb; parent uuid; begin
 if not public.community_target_visible(content_kind,target_id) then raise exception 'Content is unavailable.'; end if;
 if content_kind='review' then
  select restaurant_id into parent from public.reviews where id=target_id;
  if target_restaurant is not null and parent<>target_restaurant then raise exception 'Review restaurant does not match.'; end if;
  insert into public.review_comments(review_id,user_id,text)values(target_id,caller,body) returning to_jsonb(review_comments)||jsonb_build_object('restaurant_id',parent) into result;
 else
  insert into public.post_comments(post_id,user_id,text)values(target_id,caller,body)returning to_jsonb(post_comments) into result;
 end if; return result;
end $$;
create function public.set_community_like(content_kind text,target_id uuid,liked boolean)
returns void language plpgsql security definer set search_path='' as $$
declare caller uuid:=public.require_active_account(); begin
 if content_kind not in ('review','post') or liked is null then raise exception 'Invalid like.'; end if;
 -- Unliking remains possible after a block/moderation change.
 if liked and not public.community_target_visible(content_kind,target_id) then raise exception 'Content is unavailable.'; end if;
 if content_kind='review' then
  if liked then insert into public.review_likes(review_id,user_id)values(target_id,caller)on conflict do nothing;
  else delete from public.review_likes where review_id=target_id and user_id=caller; end if;
 else
  if liked then insert into public.post_likes(post_id,user_id)values(target_id,caller)on conflict do nothing;
  else delete from public.post_likes where post_id=target_id and user_id=caller; end if;
 end if;
end $$;
create function public.delete_community_content(content_kind text,target_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare caller uuid:=public.require_active_account(); begin
 if content_kind='post' then delete from public.posts where id=target_id and(user_id=caller or public.is_admin());
 elsif content_kind='post_comment' then delete from public.post_comments where id=target_id and(user_id=caller or public.is_admin());
 elsif content_kind='review_comment' then delete from public.review_comments where id=target_id and(user_id=caller or public.is_admin());
 else raise exception 'Invalid content type.'; end if;
 if not found then raise exception 'Content not found or not yours.'; end if;
end $$;
revoke all on function public.create_community_post(text,text[]),public.write_community_comment(text,uuid,text,uuid),public.set_community_like(text,uuid,boolean),public.delete_community_content(text,uuid) from public,anon;
grant execute on function public.create_community_post(text,text[]),public.write_community_comment(text,uuid,text,uuid),public.set_community_like(text,uuid,boolean),public.delete_community_content(text,uuid) to authenticated;

create function public.community_post_page(target_user uuid default null,following_only boolean default false,after_id uuid default null,page_size integer default 30)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; lim integer:=greatest(1,least(coalesce(page_size,30),250)); begin
 with visible as materialized(select p.* from public.posts p where (target_user is null or p.user_id=target_user)
 and (not coalesce(following_only,false) or exists(select 1 from public.follows f where f.follower_id=auth.uid() and f.following_id=p.user_id))),
 anchor as(select * from visible where id=after_id),
 page as(select * from visible v where after_id is null or exists(select 1 from anchor a where v.created_at<a.created_at or(v.created_at=a.created_at and v.id>a.id))
 order by created_at desc,id asc limit lim+1)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(p)order by created_at desc,id asc)from page p),'[]'),'total',(select count(*)from visible)) into result;
 return result;
end $$;
create function public.community_comment_page(content_kind text,target_id uuid,after_id uuid default null,page_size integer default 30)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; lim integer:=greatest(1,least(coalesce(page_size,30),250)); begin
 if content_kind not in('review','post') then raise exception 'Invalid content type.'; end if;
 with visible as materialized(
  select c.id,c.created_at,to_jsonb(c)||jsonb_build_object('restaurant_id',r.restaurant_id) row_value
  from public.review_comments c join public.reviews r on r.id=c.review_id where content_kind='review' and c.review_id=target_id
  union all select c.id,c.created_at,to_jsonb(c) from public.post_comments c where content_kind='post' and c.post_id=target_id),
 anchor as(select * from visible where id=after_id),
 page as(select * from visible v where after_id is null or exists(select 1 from anchor a where(v.created_at,v.id)>(a.created_at,a.id))order by created_at,id limit lim+1)
 select jsonb_build_object('items',coalesce((select jsonb_agg(row_value order by created_at,id)from page),'[]'),'total',(select count(*)from visible)) into result;
 return result;
end $$;
create function public.community_post_counts(target_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare caller uuid:=public.require_active_account(); result jsonb; begin
 if target_ids is null or cardinality(target_ids)>100 then raise exception 'Request up to 100 posts.'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('post_id',p.id,'likes',(select count(*)from public.post_likes l where l.post_id=p.id),
 'comments',(select count(*)from public.post_comments c where c.post_id=p.id))),'[]')into result from public.posts p
 where p.id=any(target_ids)and public.community_target_visible('post',p.id);
 return result;
end $$;
revoke all on function public.community_post_page(uuid,boolean,uuid,integer),public.community_comment_page(text,uuid,uuid,integer),public.community_post_counts(uuid[]) from public,anon;
grant execute on function public.community_post_page(uuid,boolean,uuid,integer),public.community_comment_page(text,uuid,uuid,integer),public.community_post_counts(uuid[]) to authenticated;

-- Filtering happens before paging/counting, so badge and inbox agree.
create policy "notifications visible actors" on public.notifications as restrictive for select to authenticated
 using(public.is_active_account() and(actor_id is null or not exists(select 1 from public.blocks
 where(blocker_id=auth.uid()and blocked_id=actor_id)or(blocked_id=auth.uid()and blocker_id=actor_id))));
create function public.my_notification_page(after_id uuid default null,page_size integer default 20)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; lim integer:=greatest(1,least(coalesce(page_size,20),100)); begin
 with visible as materialized(select * from public.notifications where user_id=auth.uid()),anchor as(select * from visible where id=after_id),
 page as(select * from visible v where after_id is null or exists(select 1 from anchor a where v.created_at<a.created_at or(v.created_at=a.created_at and v.id>a.id))order by created_at desc,id limit lim+1)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(p)order by created_at desc,id)from page p),'[]'),'total',(select count(*)from visible))into result;
 return result;
end $$;
create function public.my_unread_notification_count()
returns bigint language sql stable security invoker set search_path='' as $$
 select count(*)from public.notifications where user_id=auth.uid()and not is_read;
$$;
revoke all on function public.my_notification_page(uuid,integer),public.my_unread_notification_count() from public,anon;
grant execute on function public.my_notification_page(uuid,integer),public.my_unread_notification_count() to authenticated;

create index if not exists posts_feed_cursor_idx on public.posts(created_at desc,id);
create index if not exists post_comments_cursor_idx on public.post_comments(post_id,created_at,id);
create index if not exists review_comments_cursor_idx on public.review_comments(review_id,created_at,id);
create index if not exists notifications_cursor_idx on public.notifications(user_id,created_at desc,id);
notify pgrst,'reload schema';
commit;
