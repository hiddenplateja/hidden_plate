begin;

-- Clients may read/delete their inbox and mark it read, but cannot author or
-- rewrite notifications. Token registration must go through the validated RPC.
revoke insert, update on public.notifications from anon, authenticated;
grant update (is_read) on public.notifications to authenticated;
drop policy if exists "notifications delete own" on public.notifications;
create policy "notifications delete own" on public.notifications
  for delete to authenticated using (user_id = auth.uid());
drop policy if exists "push tokens own" on public.push_tokens;
drop policy if exists "push tokens read own" on public.push_tokens;
drop policy if exists "push tokens delete own" on public.push_tokens;
create policy "push tokens read own" on public.push_tokens
  for select to authenticated using (user_id = auth.uid());
create policy "push tokens delete own" on public.push_tokens
  for delete to authenticated using (user_id = auth.uid());
revoke insert, update on public.push_tokens from anon, authenticated;

create or replace function public.notify_social_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  actor uuid;
  recipient uuid;
  event_type text;
  target_id uuid;
  target_key text;
  target_label text;
  actor_name text;
  pref_key text;
  prefs jsonb;
  message_title text;
  message_body text;
  message_data jsonb;
begin
  if TG_TABLE_NAME = 'follows' then
    actor := new.follower_id; recipient := new.following_id;
    event_type := 'follow';
  else
    actor := new.user_id;
    event_type := case when TG_TABLE_NAME in ('review_likes','post_likes') then 'like' else 'comment' end;
    if TG_TABLE_NAME in ('review_likes','review_comments') then
      target_id := new.review_id; target_key := 'reviewId'; target_label := 'review';
      select user_id into recipient from public.reviews where id = target_id and not is_hidden;
    else
      target_id := new.post_id; target_key := 'postId'; target_label := 'post';
      select user_id into recipient from public.posts where id = target_id;
    end if;
  end if;
  if recipient is null or recipient = actor then return null; end if;
  if not exists(select 1 from public.profiles where id = actor and not is_banned)
    or not exists(select 1 from public.profiles where id = recipient and not is_banned)
    or exists(select 1 from public.blocks where
      (blocker_id = actor and blocked_id = recipient) or
      (blocker_id = recipient and blocked_id = actor)) then return null; end if;

  select preferences into prefs from public.profiles where id = recipient;
  pref_key := case event_type when 'follow' then 'notifyOnFollow'
    when 'like' then 'notifyOnLike' else 'notifyOnComment' end;
  if prefs->'notificationsEnabled' = 'false'::jsonb or prefs->pref_key = 'false'::jsonb then return null; end if;

  -- Serialize matching events so concurrent requests cannot evade deduplication.
  perform pg_advisory_xact_lock(hashtextextended(
    actor::text || recipient::text || event_type || coalesce(target_id::text,''), 0));
  if exists(select 1 from public.notifications where user_id = recipient
    and actor_id = actor and type = event_type and not is_read
    and created_at > now() - interval '5 minutes'
    and (target_key is null or data->>target_key = target_id::text)) then return null; end if;

  select coalesce(nullif(trim(display_name),''),'Someone') into actor_name
    from public.profiles where id = actor;
  message_data := jsonb_build_object('actorName',actor_name);
  if target_key is not null then
    message_data := message_data || jsonb_build_object(target_key,target_id::text);
  end if;
  if event_type = 'follow' then
    message_title := 'New follower'; message_body := actor_name || ' started following you';
  elsif event_type = 'like' then
    message_title := 'New like'; message_body := actor_name || ' liked your ' || target_label;
  else
    message_title := 'New comment';
    message_body := actor_name || ': ' || case when length(trim(new.text)) > 80
      then rtrim(left(trim(new.text),77)) || '…' else trim(new.text) end;
  end if;
  insert into public.notifications(user_id,actor_id,type,title,body,data,is_read)
    values(recipient,actor,event_type,message_title,message_body,message_data,false);
  return null;
end; $$;
revoke all on function public.notify_social_event() from public, anon, authenticated;

drop trigger if exists follows_notify on public.follows;
drop trigger if exists review_likes_notify on public.review_likes;
drop trigger if exists review_comments_notify on public.review_comments;
drop trigger if exists post_likes_notify on public.post_likes;
drop trigger if exists post_comments_notify on public.post_comments;
create trigger follows_notify after insert on public.follows
  for each row execute function public.notify_social_event();
create trigger review_likes_notify after insert on public.review_likes
  for each row execute function public.notify_social_event();
create trigger review_comments_notify after insert on public.review_comments
  for each row execute function public.notify_social_event();
create trigger post_likes_notify after insert on public.post_likes
  for each row execute function public.notify_social_event();
create trigger post_comments_notify after insert on public.post_comments
  for each row execute function public.notify_social_event();
commit;
