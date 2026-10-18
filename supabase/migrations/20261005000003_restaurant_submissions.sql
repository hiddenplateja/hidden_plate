create or replace function public.submit_restaurant(payload jsonb)
returns public.restaurants language plpgsql security definer set search_path=public as $$
declare r public.restaurants; result public.restaurants;
begin
  if auth.uid() is null or not exists(select 1 from profiles where id=auth.uid() and not is_banned) then raise exception 'Sign in to submit a restaurant.'; end if;
  r:=jsonb_populate_record(null::public.restaurants,payload);
  if length(trim(coalesce(r.name,'')))<2 or length(trim(coalesce(r.address,'')))=0 or r.parish is null or r.latitude is null or r.longitude is null or r.latitude not between -90 and 90 or r.longitude not between -180 and 180 or (r.latitude=0 and r.longitude=0) then raise exception 'Check the restaurant name, address and location.'; end if;
  insert into restaurants(name,slug,description,address,parish,city,latitude,longitude,phone_number,website_url,instagram_handle,price_range,cuisines,categories,image_paths,cover_image_path,opening_hours,menu,added_by,is_active,is_verified,is_featured,search_text)
  values(trim(r.name),regexp_replace(lower(trim(r.name)),'[^a-z0-9]+','-','g')||'-'||gen_random_uuid()::text,r.description,trim(r.address),r.parish,r.city,r.latitude,r.longitude,r.phone_number,r.website_url,r.instagram_handle,r.price_range,coalesce(r.cuisines,'{}'),coalesce(r.categories,'{}'),coalesce(r.image_paths,'{}'),r.cover_image_path,r.opening_hours,r.menu,auth.uid(),false,false,false,lower(concat_ws(' ',r.name,r.city,r.parish,array_to_string(r.cuisines,' '),array_to_string(r.categories,' ')))) returning * into result;
  return result;
end; $$;
revoke all on function public.submit_restaurant(jsonb) from public,anon;
grant execute on function public.submit_restaurant(jsonb) to authenticated;
