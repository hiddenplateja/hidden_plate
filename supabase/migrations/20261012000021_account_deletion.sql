begin;
-- Private durable work record: no email, name, content, token or credentials.
-- Auth is deleted LAST through the Admin API, outside this SQL transaction.
create table public.account_deletion_jobs (
 user_id uuid primary key,
 state text not null default 'prepared' check(state in('prepared','completed')),
 summary jsonb not null default '{}',
 created_at timestamptz not null default now(), completed_at timestamptz
);
alter table public.account_deletion_jobs enable row level security;
revoke all on public.account_deletion_jobs from public,anon,authenticated;
grant all on public.account_deletion_jobs to service_role;

-- Retain ratings, photos and threads without an identifying author/profile.
do $$ declare t text; begin
 foreach t in array array['reviews','review_comments','posts','post_comments'] loop
  execute format('alter table public.%I alter column user_id drop not null',t);
  execute format('alter table public.%I add column deleted_author_visible boolean not null default false',t);
  execute format('alter table public.%I drop constraint %I',t,t||'_user_id_fkey');
  execute format('alter table public.%I add constraint %I foreign key(user_id) references public.profiles(id) on delete set null',t,t||'_user_id_fkey');
 end loop;
end $$;

-- The original dashboard table had broad default grants, including TRUNCATE
-- (which RLS does not protect). Reviews need read + caller/admin deletion only;
-- create/edit already use write_review. New retention flags are never writable.
revoke all on public.reviews from public,anon,authenticated;
do $$declare cols text;begin
 select string_agg(quote_ident(column_name),',')into cols from information_schema.columns where table_schema='public'and table_name='reviews';
 execute 'revoke insert('||cols||'),update('||cols||'),references('||cols||') on public.reviews from public,anon,authenticated';
end $$;
grant select on public.reviews to anon,authenticated;
grant delete on public.reviews to authenticated;

create or replace function public.validate_review_interaction()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 -- Only an already-recorded deletion may remove a comment's author. This
 -- exception cannot modify text/parent/ID or bypass ordinary member writes.
 if tg_op='UPDATE' and tg_table_name='review_comments' then
  if old.user_id is not null and(new.user_id is null or new.user_id=old.user_id)
   and to_jsonb(new)-array['user_id','deleted_author_visible']=to_jsonb(old)-array['user_id','deleted_author_visible']
   and exists(select 1 from public.account_deletion_jobs where user_id=old.user_id and state='prepared')
  then return new;end if;
 end if;
 if not public.is_active_account() or new.user_id is distinct from auth.uid() then
  raise exception 'Sign in to interact with reviews.';
 end if;
 if not exists(select 1 from public.reviews where id=new.review_id and not is_hidden)then raise exception 'Review is unavailable.';end if;
 if tg_table_name='review_comments' then
  if length(trim(new.text))not between 1 and 1000 or new.text ~* '(https?://|www\.)'then
   raise exception 'Comments must contain 1–1000 characters and no external links.';
  end if;
 end if;return new;
end $$;

-- Only content explicitly preserved from a completed, non-banned account may
-- reappear without an author. Deleting a banned/pending account cannot bypass
-- moderation; public restaurant ratings keep their existing visibility rules.
create function public.community_content_author_visible(author uuid,retained boolean)
returns boolean language sql stable security definer set search_path='' as $$
 select public.is_active_account()and((author is null and retained)or public.community_author_visible(author));
$$;
revoke all on function public.community_content_author_visible(uuid,boolean)from public,anon;
grant execute on function public.community_content_author_visible(uuid,boolean)to authenticated;
alter policy "posts visible community" on public.posts using(public.community_content_author_visible(user_id,deleted_author_visible));
alter policy "post comments visible community" on public.post_comments using(public.community_content_author_visible(user_id,deleted_author_visible)and public.community_target_visible('post',post_id));
alter policy "review comments visible community" on public.review_comments using(public.community_content_author_visible(user_id,deleted_author_visible)and public.community_target_visible('review',review_id));
create or replace function public.community_target_visible(content_kind text,target_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select case content_kind when 'post' then exists(select 1 from public.posts p where p.id=target_id and public.community_content_author_visible(p.user_id,p.deleted_author_visible))
 when 'review' then exists(select 1 from public.reviews r join public.restaurants s on s.id=r.restaurant_id
 where r.id=target_id and not r.is_hidden and public.community_content_author_visible(r.user_id,r.deleted_author_visible)
 and(s.is_active or s.owner_id=auth.uid()or public.is_admin()))else false end;
$$;
create or replace function public.community_review_page(target_user uuid default null,following_only boolean default false,
 after_id uuid default null,page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare caller uuid:=public.require_active_account();result jsonb;lim integer:=greatest(1,least(coalesce(page_size,20),250));begin
 with visible as materialized(select r.* from public.reviews r join public.restaurants s on s.id=r.restaurant_id
  where not r.is_hidden and public.community_content_author_visible(r.user_id,r.deleted_author_visible)
  and(s.is_active or s.owner_id=caller or public.is_admin())
  and(target_user is null or r.user_id=target_user)
  and(not coalesce(following_only,false)or exists(select 1 from public.follows f where f.follower_id=caller and f.following_id=r.user_id))),
 anchor as(select * from visible where id=after_id),
 page as(select * from visible v where after_id is null or exists(select 1 from anchor a where v.created_at<a.created_at or(v.created_at=a.created_at and v.id>a.id))order by created_at desc,id limit lim+1)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(p)order by created_at desc,id)from page p),'[]'),'total',(select count(*)from visible))into result;return result;
end $$;

create function public.prepare_account_deletion(target_user uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;retained boolean; t text;begin
 if target_user is null then raise exception 'Missing account.';end if;
 perform pg_advisory_xact_lock(hashtextextended(target_user::text,21021));
 select summary into result from public.account_deletion_jobs where user_id=target_user;
 if found then return result;end if;
 perform 1 from auth.users where id=target_user for update;
 if not found then raise exception 'Account not found.';end if;
 -- Serialize against FK-backed writes. Removing the profile denies all active
 -- member RPCs immediately, even while a previously issued JWT is unexpired.
 perform 1 from public.profiles where id=target_user for update;
 result:=jsonb_build_object(
  'reviewsAnonymized',(select count(*)from public.reviews where user_id=target_user),
  'commentsAnonymized',(select count(*)from public.review_comments where user_id=target_user),
  'postsAnonymized',(select count(*)from public.posts where user_id=target_user),
  'postCommentsAnonymized',(select count(*)from public.post_comments where user_id=target_user),
  'likesDeleted',(select count(*)from public.review_likes where user_id=target_user)+(select count(*)from public.post_likes where user_id=target_user),
  'savedDeleted',(select count(*)from public.saved_restaurants where user_id=target_user),
  'followsDeleted',(select count(*)from public.follows where follower_id=target_user or following_id=target_user),
  'notificationsDeleted',(select count(*)from public.notifications where user_id=target_user or actor_id=target_user),
  'pushTokensDeleted',(select count(*)from public.push_tokens where user_id=target_user),
  'reportsDeleted',(select count(*)from public.review_reports where reported_by_user_id=target_user)
   +(select count(*)from public.comment_reports where reported_by_user_id=target_user)
   +(select count(*)from public.post_reports where reported_by_user_id=target_user)
   +(select count(*)from public.post_comment_reports where reported_by_user_id=target_user),
  'collectionsDeleted',(select count(*)from public.collections where owner_id=target_user),
  'claimsDeleted',(select count(*)from public.restaurant_claims where user_id=target_user),
  'bugReportsDeleted',(select count(*)from public.bug_reports where user_id=target_user),
  'userDocDeleted',true,'authAccountDeleted',false,'errors','[]'::jsonb);
 insert into public.account_deletion_jobs(user_id,summary)values(target_user,result);
 retained:=exists(select 1 from public.profiles where id=target_user and not is_banned)
  and not exists(select 1 from public.auth_signup_pending where user_id=target_user);
 foreach t in array array['reviews','review_comments','posts','post_comments']loop
  execute format('update public.%I set deleted_author_visible=$1 where user_id=$2',t)using retained,target_user;
 end loop;
 -- Other inboxes also contain this actor's name/comment preview. Remove those
 -- copies rather than merely clearing actor_id. Delivery rows cascade too.
 delete from public.notifications where user_id=target_user or actor_id=target_user;
 update public.media_cleanup set state='queued',lease_id=null,lease_owner=null,lease_until=null
  where lease_owner=target_user and state='processing';
 -- Cascades remove private preferences, saves, both relationship directions,
 -- collections, claims/proofs, reports, tokens, owner menus/replies and views.
 -- Restaurant ownership/submission links clear; listings and their photos stay.
 -- The existing profile trigger queues the removed avatar for safe R2 cleanup.
 delete from public.profiles where id=target_user;
 return result;
end $$;

create function public.complete_account_deletion(target_user uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;begin
 perform pg_advisory_xact_lock(hashtextextended(target_user::text,21021));
 if exists(select 1 from auth.users where id=target_user)then raise exception 'Auth deletion is not complete.';end if;
 update public.account_deletion_jobs set state='completed',completed_at=coalesce(completed_at,now()),
  summary=summary||'{"authAccountDeleted":true}'::jsonb where user_id=target_user returning summary into result;
 if not found then raise exception 'Deletion was not prepared.';end if;return result;
end $$;

create function public.pending_account_deletions()
returns setof uuid language sql stable security definer set search_path='' as $$
 select user_id from public.account_deletion_jobs where state='prepared'order by created_at,user_id limit 20;
$$;
revoke all on function public.prepare_account_deletion(uuid),public.complete_account_deletion(uuid),public.pending_account_deletions()from public,anon,authenticated;
grant execute on function public.prepare_account_deletion(uuid),public.complete_account_deletion(uuid),public.pending_account_deletions()to service_role;
revoke all on function public.validate_review_interaction()from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
