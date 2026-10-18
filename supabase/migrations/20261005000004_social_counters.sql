begin;
create or replace function public.validate_review_interaction()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null or new.user_id <> auth.uid() or not exists(select 1 from profiles where id=auth.uid() and not is_banned) then raise exception 'Sign in to interact with reviews.'; end if;
  if not exists(select 1 from reviews where id=new.review_id and not is_hidden) then raise exception 'Review is unavailable.'; end if;
  if TG_TABLE_NAME='review_comments' then
    if length(trim(new.text)) not between 1 and 1000 or new.text ~* '(https?://|www\.)' then raise exception 'Comments must contain 1–1000 characters and no external links.'; end if;
  end if;
  return new;
end; $$;
create or replace function public.sync_review_interaction_counts()
returns trigger language plpgsql security definer set search_path=public as $$
declare target uuid;
begin
  target:=case when TG_OP='DELETE' then old.review_id else new.review_id end;
  perform 1 from reviews where id=target for update;
  update reviews set like_count=(select count(*) from review_likes where review_id=target),
    comment_count=(select count(*) from review_comments where review_id=target) where id=target;
  return null;
end; $$;
drop trigger if exists validate_interaction on review_likes;
create trigger validate_interaction before insert or update on review_likes for each row execute function public.validate_review_interaction();
drop trigger if exists validate_interaction on review_comments;
create trigger validate_interaction before insert or update on review_comments for each row execute function public.validate_review_interaction();
drop trigger if exists sync_interaction_counts on review_likes;
create trigger sync_interaction_counts after insert or delete on review_likes for each row execute function public.sync_review_interaction_counts();
drop trigger if exists sync_interaction_counts on review_comments;
create trigger sync_interaction_counts after insert or delete on review_comments for each row execute function public.sync_review_interaction_counts();
revoke all on function public.validate_review_interaction() from public,anon,authenticated;
revoke all on function public.sync_review_interaction_counts() from public,anon,authenticated;
commit;
