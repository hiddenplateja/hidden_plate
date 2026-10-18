begin;
create or replace function public.restaurant_page(filters jsonb default '{}',sort_by text default 'rating',
 after_id uuid default null,page_size integer default 25,exclude_expired boolean default false)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare cursor_row public.restaurants; result jsonb; begin
 if filters is null or jsonb_typeof(filters)<>'object' or sort_by is null or sort_by not in ('rating','recent','name')
   or page_size is null or page_size not between 1 and 250 or exclude_expired is null
   or exists(select 1 from jsonb_each(filters) e where e.key not in ('parish','cuisine','category','search','priceRange','featured')
     or (e.key='featured' and jsonb_typeof(e.value)<>'boolean')
     or (e.key<>'featured' and (jsonb_typeof(e.value)<>'string' or length(e.value#>>'{}')>200))) then raise exception 'Invalid restaurant query.'; end if;
 if after_id is not null then
   select * into cursor_row from public.restaurants where id=after_id and is_active;
   if not found then raise exception 'Invalid restaurant cursor. Refresh the list.'; end if;
 end if;
 with matches as (select * from public.restaurants r where r.is_active
   and (not exclude_expired or r.listing_paid_until is null or r.listing_paid_until>now())
   and (not (filters ? 'parish') or r.parish=filters->>'parish')
   and (not (filters ? 'priceRange') or r.price_range=filters->>'priceRange')
   and (not (filters ? 'cuisine') or lower(filters->>'cuisine')=any(r.cuisines))
   and (not (filters ? 'category') or lower(filters->>'category')=any(r.categories))
   and (coalesce((filters->>'featured')::boolean,false)=false or r.is_featured)
   and strpos(r.search_text,lower(btrim(coalesce(filters->>'search',''))))>0),
 page as (select * from matches r where after_id is null
   or (sort_by='rating' and (r.average_rating<cursor_row.average_rating or (r.average_rating=cursor_row.average_rating and r.id>after_id)))
   or (sort_by='recent' and (r.created_at<cursor_row.created_at or (r.created_at=cursor_row.created_at and r.id>after_id)))
   or (sort_by='name' and (r.name>cursor_row.name or (r.name=cursor_row.name and r.id>after_id)))
   order by case when sort_by='rating' then average_rating end desc,
     case when sort_by='recent' then created_at end desc,case when sort_by='name' then name end asc,id asc limit page_size+1)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(p) order by
   case when sort_by='rating' then p.average_rating end desc,case when sort_by='recent' then p.created_at end desc,
   case when sort_by='name' then p.name end asc,p.id asc) from page p),'[]'::jsonb),'total',(select count(*) from matches)) into result;
 return result;
end $$;

create or replace function public.restaurant_review_page(target_restaurant uuid,sort_by text default 'recent',
 after_id uuid default null,page_size integer default 20)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare cursor_row public.reviews; result jsonb; begin
 if target_restaurant is null or sort_by is null or sort_by not in ('recent','popular') or page_size is null or page_size not between 1 and 250 then raise exception 'Invalid review query.'; end if;
 if after_id is not null then
   select * into cursor_row from public.reviews where id=after_id and restaurant_id=target_restaurant and not is_hidden;
   if not found then raise exception 'Invalid review cursor. Refresh the list.'; end if;
 end if;
 with matches as (select * from public.reviews where restaurant_id=target_restaurant and not is_hidden),
 page as (select * from matches r where after_id is null
   or (sort_by='recent' and (r.created_at<cursor_row.created_at or (r.created_at=cursor_row.created_at and r.id>after_id)))
   or (sort_by='popular' and (r.like_count<cursor_row.like_count or (r.like_count=cursor_row.like_count and r.id>after_id)))
   order by case when sort_by='recent' then created_at end desc,case when sort_by='popular' then like_count end desc,id asc limit page_size+1)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(p) order by
   case when sort_by='recent' then p.created_at end desc,case when sort_by='popular' then p.like_count end desc,p.id asc)
   from page p),'[]'::jsonb),'total',(select count(*) from matches)) into result;
 return result;
end $$;

create or replace function public.restaurant_rating_distribution(target_restaurant uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('count',count(*),'average',coalesce(round(avg(rating),1),0),'buckets',jsonb_build_object(
   '1',count(*) filter(where rating=1),'2',count(*) filter(where rating=2),'3',count(*) filter(where rating=3),
   '4',count(*) filter(where rating=4),'5',count(*) filter(where rating=5)))
 from public.reviews where restaurant_id=target_restaurant and not is_hidden;
$$;
create or replace function public.restaurant_review_stats(target_ids uuid[])
returns table(restaurant_id uuid,count bigint,average numeric) language plpgsql stable security invoker set search_path='' as $$
begin
 if cardinality(target_ids)>100 then raise exception 'Too many restaurant IDs.'; end if;
 return query select r.id,count(v.id),coalesce(round(avg(v.rating),1),0) from public.restaurants r
   left join public.reviews v on v.restaurant_id=r.id and not v.is_hidden where r.id=any(target_ids) group by r.id;
end $$;
revoke all on function public.restaurant_page(jsonb,text,uuid,integer,boolean),public.restaurant_review_page(uuid,text,uuid,integer),
 public.restaurant_rating_distribution(uuid),public.restaurant_review_stats(uuid[]) from public;
grant execute on function public.restaurant_page(jsonb,text,uuid,integer,boolean),public.restaurant_review_page(uuid,text,uuid,integer),
 public.restaurant_rating_distribution(uuid),public.restaurant_review_stats(uuid[]) to anon,authenticated;
notify pgrst,'reload schema';
commit;
