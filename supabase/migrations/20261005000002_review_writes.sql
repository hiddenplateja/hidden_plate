begin;
create or replace function public.write_review(payload jsonb, review_id uuid default null)
returns public.reviews language plpgsql security definer set search_path = public
as $$
declare r public.reviews; result public.reviews;
begin
  if auth.uid() is null or not exists (select 1 from profiles where id = auth.uid() and not is_banned) then
    raise exception 'Sign in to write a review.';
  end if;
  if review_id is not null then
    select * into r from reviews where id = review_id and user_id = auth.uid() for update;
    if not found then raise exception 'Review not found or permission denied.'; end if;
  end if;
  r := jsonb_populate_record(r, payload);
  if r.rating is null or r.rating not between 1 and 5 or length(coalesce(r.comment,'')) > 2000
    or cardinality(coalesce(r.image_paths,'{}')) > 6 then
    raise exception 'Check your rating, comment length and image count.';
  end if;
  if coalesce(r.comment,'') ~* '(https?://|www\.)' then
    raise exception 'External links are not allowed in reviews.';
  end if;
  if review_id is null then
    if not exists(select 1 from restaurants where id = r.restaurant_id and is_active) then
      raise exception 'Restaurant is not available for reviews.';
    end if;
    insert into reviews (restaurant_id,user_id,rating,comment,image_paths,like_count,comment_count,is_edited,is_hidden)
    values (r.restaurant_id,auth.uid(),r.rating,r.comment,coalesce(r.image_paths,'{}'),0,0,false,false)
    returning * into result;
  else
    update reviews set rating=r.rating,comment=r.comment,image_paths=coalesce(r.image_paths,'{}'),is_edited=true
    where id=review_id and user_id=auth.uid() returning * into result;
  end if;
  return result;
end; $$;

create or replace function public.sync_restaurant_review_stats()
returns trigger language plpgsql security definer set search_path = public
as $$
declare target uuid;
begin
  target := case when TG_OP='DELETE' then old.restaurant_id else new.restaurant_id end;
  perform 1 from restaurants where id=target for update;
  update restaurants set review_count=s.n,average_rating=s.avg_rating
  from (select count(*)::integer n,coalesce(round(avg(rating),1),0) avg_rating
    from reviews where restaurant_id=target and not is_hidden) s where id=target;
  return null;
end; $$;
drop trigger if exists reviews_sync_stats on public.reviews;
create trigger reviews_sync_stats after insert or update or delete on public.reviews
for each row execute function public.sync_restaurant_review_stats();
drop policy if exists "reviews create own" on public.reviews;
revoke all on function public.write_review(jsonb,uuid) from public,anon;
grant execute on function public.write_review(jsonb,uuid) to authenticated;
revoke all on function public.sync_restaurant_review_stats() from public,anon,authenticated;
commit;
