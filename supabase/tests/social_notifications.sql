-- Run in SQL Editor as postgres. Everything is rolled back, including auth users.
begin;
do $$
declare
  actor uuid := gen_random_uuid();
  recipient uuid := gen_random_uuid();
  restaurant uuid := gen_random_uuid();
  review uuid := gen_random_uuid();
  post uuid := gen_random_uuid();
  n integer;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (actor,actor::text || '@example.invalid','{"display_name":"Test Actor"}'),
    (recipient,recipient::text || '@example.invalid','{"display_name":"Test Recipient"}');
  if (select count(*) from public.profiles where id in (actor,recipient)) <> 2 then
    raise exception 'Auth profile trigger missing';
  end if;
  insert into public.restaurants(id,name,slug,address,parish,latitude,longitude,is_active)
    values(restaurant,'Notification Test',restaurant::text,'Test address','Kingston',18,-77,true);
  insert into public.reviews(id,restaurant_id,user_id,rating)
    values(review,restaurant,recipient,5);
  insert into public.posts(id,user_id,text) values(post,recipient,'Test post');
  perform set_config('request.jwt.claim.sub',actor::text,true);
  insert into public.follows(follower_id,following_id) values(actor,recipient);
  insert into public.review_likes(review_id,user_id) values(review,actor);
  insert into public.review_comments(review_id,user_id,text) values(review,actor,'Nice review');
  insert into public.post_likes(post_id,user_id) values(post,actor);
  insert into public.post_comments(post_id,user_id,text) values(post,actor,'Nice post');
  select count(*) into n from public.notifications where user_id=recipient;
  if n <> 5 then raise exception 'Expected 5 notifications, got %',n; end if;
  if exists(select 1 from public.notifications where user_id=recipient
    and (actor_id <> actor or data->>'actorName' <> 'Test Actor')) then
    raise exception 'Incorrect actor identity';
  end if;
  insert into public.review_comments(review_id,user_id,text) values(review,actor,'Second comment');
  if (select count(*) from public.notifications where user_id=recipient) <> 5 then
    raise exception 'Deduplication failed';
  end if;
  delete from public.notifications where user_id=recipient;
  update public.profiles set preferences=preferences || '{"notifyOnComment":false}'::jsonb where id=recipient;
  insert into public.review_comments(review_id,user_id,text) values(review,actor,'Preferences test');
  if exists(select 1 from public.notifications where user_id=recipient) then raise exception 'Preference suppression failed'; end if;
  update public.profiles set preferences=preferences || '{"notifyOnComment":true}'::jsonb where id=recipient;
  insert into public.blocks(blocker_id,blocked_id) values(recipient,actor);
  insert into public.review_comments(review_id,user_id,text) values(review,actor,'Block test');
  if exists(select 1 from public.notifications where user_id=recipient) then raise exception 'Mutual block suppression failed'; end if;
  delete from public.blocks where blocker_id=recipient and blocked_id=actor;
  perform set_config('request.jwt.claim.sub',recipient::text,true);
  insert into public.review_comments(review_id,user_id,text) values(review,recipient,'Self test');
  if exists(select 1 from public.notifications where user_id=recipient) then raise exception 'Self suppression failed'; end if;
  if has_table_privilege('authenticated','public.notifications','UPDATE')
    or not has_column_privilege('authenticated','public.notifications','is_read','UPDATE')
    or has_column_privilege('authenticated','public.notifications','body','UPDATE')
    or has_table_privilege('authenticated','public.push_tokens','INSERT') then
    raise exception 'Unsafe client write privileges';
  end if;
end; $$;
rollback;
select 'PASS: five event types, trusted actor, dedupe, preferences, mutual blocks, self suppression, write privileges. Fixtures rolled back.' as result;
