begin;

-- Registration has no direct client write path. Logout cleanup remains owner-only,
-- even for a suspended/unfinished user. Remove grants that bypass row security.
revoke all on public.push_tokens from public,anon,authenticated;
do $$declare cols text;begin
 select string_agg(quote_ident(column_name),',')into cols from information_schema.columns where table_schema='public'and table_name='push_tokens';
 execute 'revoke insert('||cols||'),update('||cols||'),references('||cols||') on public.push_tokens from public,anon,authenticated';
end $$;
grant select,delete on public.push_tokens to authenticated;
create or replace function public.register_push_token(push_token text,device_platform text)
returns void language plpgsql security definer set search_path='' as $$
declare caller uuid:=public.require_active_account();begin
 if push_token is null or length(push_token)>512 or push_token !~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$'
  or device_platform is null or device_platform not in('ios','android')then raise exception 'Invalid push token or platform.';end if;
 perform pg_advisory_xact_lock(hashtextextended(push_token,0));
 delete from public.push_tokens where token=push_token;
 insert into public.push_tokens(user_id,token,platform)values(caller,push_token,device_platform);
end $$;

create policy "reviews active member delete" on public.reviews as restrictive for delete to authenticated
 using(public.is_active_account());
create or replace function public.write_review(payload jsonb,review_id uuid default null)
returns public.reviews language plpgsql security definer set search_path='' as $$
declare caller uuid:=public.require_active_account();r public.reviews;result public.reviews;k text;v jsonb;old_images text[]:='{}';begin
 if payload is null or jsonb_typeof(payload)<>'object'then raise exception 'Invalid review.';end if;
 for k,v in select * from jsonb_each(payload)loop
  if k not in('restaurant_id','rating','comment','image_paths')or(review_id is not null and k='restaurant_id')then raise exception 'Invalid review field.';end if;
  if k='rating'and(jsonb_typeof(v)<>'number')then raise exception 'Invalid rating.';end if;
  if k='comment'and jsonb_typeof(v)not in('string','null')then raise exception 'Invalid comment.';end if;
  if k='image_paths'and jsonb_typeof(v)not in('array','null')then raise exception 'Invalid review images.';end if;
  if k='image_paths'and jsonb_typeof(v)='array'then
   if exists(select 1 from jsonb_array_elements(v)e where jsonb_typeof(e)<>'string')then raise exception 'Invalid review images.';end if;
  end if;
 end loop;
 if payload?'rating'then
  if(payload->>'rating')::numeric not between 1 and 5 or(payload->>'rating')::numeric<>trunc((payload->>'rating')::numeric)then raise exception 'Invalid rating.';end if;
 end if;
 if review_id is not null then
  select * into r from public.reviews where id=review_id and user_id=caller for update;
  if not found then raise exception 'Review not found or permission denied.';end if;
  old_images:=coalesce(r.image_paths,'{}');
 end if;
 r:=jsonb_populate_record(r,payload);
 if r.rating is null or r.rating not between 1 and 5 or length(coalesce(r.comment,''))>2000
  or cardinality(coalesce(r.image_paths,'{}'))>6 then raise exception 'Check your rating, comment length and image count.';end if;
 if coalesce(r.comment,'')~*'(https?://|www\.)'then raise exception 'External links are not allowed in reviews.';end if;
 -- Previously referenced images can stay. Newly attached images must be this
 -- caller's review-upload keys, never another member's objects or external URLs.
 if exists(select 1 from unnest(coalesce(r.image_paths,'{}'))p where p is null or length(p)>512
  or(not p=any(old_images)and p !~ ('^rev/'||caller::text||'/[a-zA-Z0-9._-]+[.](jpg|png|webp)$')))then raise exception 'Invalid review images.';end if;
 if review_id is null then
  if not exists(select 1 from public.restaurants where id=r.restaurant_id and is_active)then raise exception 'Restaurant is not available for reviews.';end if;
  insert into public.reviews(restaurant_id,user_id,rating,comment,image_paths,like_count,comment_count,is_edited,is_hidden)
   values(r.restaurant_id,caller,r.rating,r.comment,coalesce(r.image_paths,'{}'),0,0,false,false)returning * into result;
 else
  update public.reviews set rating=r.rating,comment=r.comment,image_paths=coalesce(r.image_paths,'{}'),is_edited=true
   where id=review_id and user_id=caller returning * into result;
 end if;
 return result;
end $$;

create index if not exists saves_member_page_idx on public.saved_restaurants(user_id,list_type,created_at desc,restaurant_id);
create index if not exists blocks_member_page_idx on public.blocks(blocker_id,created_at desc,blocked_id);
create index if not exists collections_member_page_idx on public.collections(owner_id,updated_at desc,id);

-- A saved-list cursor is the restaurant UUID within that one bucket.
create function public.member_saved_page(saved_list text,after_id uuid default null,page_size integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare caller uuid:=public.require_active_account();result jsonb;lim integer:=greatest(1,least(coalesce(page_size,30),250));begin
 if saved_list is null or saved_list not in('favorite','want_to_go','visited')then raise exception 'Invalid saved list.';end if;
 with visible as materialized(select restaurant_id id,created_at,list_type from public.saved_restaurants where user_id=caller and list_type=saved_list),
 anchor as(select * from visible where id=after_id),
 page as(select * from visible v where after_id is null or exists(select 1 from anchor a where v.created_at<a.created_at or(v.created_at=a.created_at and v.id>a.id))order by created_at desc,id limit lim+1)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(p)order by created_at desc,id)from page p),'[]'),'total',(select count(*)from visible))into result;return result;
end $$;
create function public.member_saved_count()
returns bigint language plpgsql stable security definer set search_path='' as $$
declare caller uuid:=public.require_active_account();result bigint;begin
 select count(*)into result from public.saved_restaurants where user_id=caller;return result;
end $$;

-- Hidden ID union includes both directions, banned and unfinished accounts, and
-- deduplicates reciprocal edges BEFORE paging. It never returns private profiles.
create function public.member_hidden_user_page(after_id uuid default null,page_size integer default 250)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare caller uuid:=public.require_active_account();result jsonb;lim integer:=greatest(1,least(coalesce(page_size,250),250));begin
 with visible as materialized(select blocked_id id from public.blocks where blocker_id=caller
  union select blocker_id id from public.blocks where blocked_id=caller),
 page as(select id from visible where after_id is null or id>after_id order by id limit lim+1)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(p)order by id)from page p),'[]'),'total',(select count(*)from visible))into result;return result;
end $$;

-- The management page includes only blocks the caller can remove, hydrates only
-- public profile columns, and filters missing/pending profiles BEFORE pagination.
create function public.member_blocked_profile_page(after_id uuid default null,page_size integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare caller uuid:=public.require_active_account();result jsonb;lim integer:=greatest(1,least(coalesce(page_size,30),250));begin
 with visible as materialized(select b.blocked_id id,b.created_at,to_jsonb(p)profile from public.blocks b join public.public_profiles p on p.id=b.blocked_id where b.blocker_id=caller),
 anchor as(select * from visible where id=after_id),
 page as(select * from visible v where after_id is null or exists(select 1 from anchor a where v.created_at<a.created_at or(v.created_at=a.created_at and v.id>a.id))order by created_at desc,id limit lim+1)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(p)order by created_at desc,id)from page p),'[]'),'total',(select count(*)from visible))into result;return result;
end $$;

create function public.member_collection_page(target_user uuid default null,public_only boolean default false,after_id uuid default null,page_size integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare caller uuid:=public.require_active_account();owner uuid:=coalesce(target_user,caller);result jsonb;lim integer:=greatest(1,least(coalesce(page_size,30),250));begin
 if public_only is null then raise exception 'Invalid collection query.';end if;
 with visible as materialized(select * from public.collections c where c.owner_id=owner and(not public_only or c.is_public)
  and(c.owner_id=caller or public.is_admin()or(c.is_public and public.community_author_visible(c.owner_id)))),
 anchor as(select * from visible where id=after_id),
 page as(select * from visible v where after_id is null or exists(select 1 from anchor a where v.updated_at<a.updated_at or(v.updated_at=a.updated_at and v.id>a.id))order by updated_at desc,id limit lim+1)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(p)order by updated_at desc,id)from page p),'[]'),'total',(select count(*)from visible))into result;return result;
end $$;

revoke all on function public.write_review(jsonb,uuid),public.register_push_token(text,text),public.member_saved_page(text,uuid,integer),
 public.member_saved_count(),public.member_hidden_user_page(uuid,integer),public.member_blocked_profile_page(uuid,integer),
 public.member_collection_page(uuid,boolean,uuid,integer)from public,anon,authenticated;
grant execute on function public.write_review(jsonb,uuid),public.register_push_token(text,text),public.member_saved_page(text,uuid,integer),
 public.member_saved_count(),public.member_hidden_user_page(uuid,integer),public.member_blocked_profile_page(uuid,integer),
 public.member_collection_page(uuid,boolean,uuid,integer)to authenticated;
notify pgrst,'reload schema';
commit;
