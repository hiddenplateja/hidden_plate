begin;
-- All client restaurant writes go through bounded, caller-checked functions.
revoke insert,update,delete on public.restaurants from public,anon,authenticated;
create or replace function public.is_active_account()
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(select 1 from public.profiles where id=auth.uid() and not is_banned)
    and not exists(select 1 from public.auth_signup_pending where user_id=auth.uid());
$$;
revoke all on function public.is_active_account() from public;
grant execute on function public.is_active_account() to anon,authenticated;
drop policy if exists "restaurants read active" on public.restaurants;
create policy "restaurants read active" on public.restaurants for select to anon,authenticated
  using(is_active or (select public.is_admin()) or (owner_id=(select auth.uid()) and (select public.is_active_account())));

create or replace function public.restaurant_search_value(r public.restaurants)
returns text language sql immutable set search_path='' as $$
  select btrim(regexp_replace(lower(concat_ws(' ',r.name,array_to_string(r.cuisines,' '),
    array_to_string(r.categories,' '),replace(r.parish,'_',' '),r.city)),'\s+',' ','g'));
$$;
revoke all on function public.restaurant_search_value(public.restaurants) from public,anon,authenticated;

create or replace function public.checked_restaurant_patch(current_row public.restaurants,payload jsonb,admin_mode boolean)
returns public.restaurants language plpgsql set search_path='' as $restaurant$
declare r public.restaurants; k text; v jsonb; tag text; day jsonb; slot jsonb; image text; begin
  if payload is null or jsonb_typeof(payload)<>'object' then raise exception 'Invalid restaurant details.'; end if;
  for k,v in select key,value from jsonb_each(payload) loop
    if k not in ('name','description','address','parish','city','latitude','longitude','phone_number','website_url',
      'instagram_handle','price_range','cuisines','categories','image_paths','cover_image_path','opening_hours','menu')
      and not (admin_mode and k in ('is_active','is_verified','is_featured')) then raise exception 'Invalid restaurant field: %',k; end if;
    if k in ('latitude','longitude') and jsonb_typeof(v)<>'number' then raise exception 'Invalid location.';
    elsif k in ('is_active','is_verified','is_featured') and jsonb_typeof(v)<>'boolean' then raise exception 'Invalid restaurant flag.';
    elsif k in ('cuisines','categories','image_paths') then
      if jsonb_typeof(v)<>'array' or exists(select 1 from jsonb_array_elements(v) e where jsonb_typeof(e)<>'string') then raise exception 'Invalid restaurant tags or images.'; end if;
    elsif k in ('name','address','parish') and jsonb_typeof(v)<>'string' then raise exception 'Invalid restaurant details.';
    elsif k in ('description','city','phone_number','website_url','instagram_handle','price_range','cover_image_path')
      and jsonb_typeof(v) not in ('string','null') then raise exception 'Invalid restaurant details.'; end if;
  end loop;
  r:=jsonb_populate_record(current_row,payload);
  r.name:=btrim(r.name); r.address:=btrim(r.address);
  r.description:=nullif(btrim(r.description),''); r.city:=nullif(btrim(r.city),'');
  r.phone_number:=nullif(btrim(r.phone_number),''); r.website_url:=nullif(btrim(r.website_url),'');
  r.instagram_handle:=nullif(regexp_replace(btrim(r.instagram_handle),'^@+',''),'');
  if r.name is null or length(r.name) not between 2 and 160 or r.address is null or length(r.address) not between 1 and 500
    or r.parish is null or r.parish not in ('kingston','st_andrew','st_thomas','portland','st_mary','st_ann','trelawny',
      'st_james','hanover','westmoreland','st_elizabeth','manchester','clarendon','st_catherine')
    or r.latitude is null or r.longitude is null or r.latitude not between -90 and 90 or r.longitude not between -180 and 180
    or (r.latitude=0 and r.longitude=0) then raise exception 'Check the restaurant name, address, parish and location.'; end if;
  if length(coalesce(r.description,''))>4000 or length(coalesce(r.city,''))>160 or length(coalesce(r.phone_number,''))>100
    or length(coalesce(r.instagram_handle,''))>100 or length(coalesce(r.website_url,''))>2048
    or (r.website_url is not null and r.website_url !~* '^https?://[^[:space:]]+$')
    or (r.price_range is not null and r.price_range not in ('$','$$','$$$','$$$$')) then raise exception 'Check the restaurant contact details.'; end if;
  if cardinality(coalesce(r.cuisines,'{}'))>100 or cardinality(coalesce(r.categories,'{}'))>100 then raise exception 'Too many tags.'; end if;
  foreach tag in array coalesce(r.cuisines,'{}')||coalesce(r.categories,'{}') loop
    if tag is null or length(btrim(tag))>80 then raise exception 'Invalid restaurant tag.'; end if;
  end loop;
  select coalesce(array_agg(t order by first_pos),'{}') into r.cuisines from
    (select lower(btrim(value)) t,min(pos) first_pos from unnest(coalesce(r.cuisines,'{}')) with ordinality a(value,pos)
      where btrim(value)<>'' group by lower(btrim(value))) s;
  select coalesce(array_agg(t order by first_pos),'{}') into r.categories from
    (select lower(btrim(value)) t,min(pos) first_pos from unnest(coalesce(r.categories,'{}')) with ordinality a(value,pos)
      where btrim(value)<>'' group by lower(btrim(value))) s;
  if cardinality(r.cuisines)+cardinality(r.categories)=0 then raise exception 'Please pick at least one cuisine or category.'; end if;
  r.image_paths:=coalesce(r.image_paths,'{}');
  if cardinality(r.image_paths)>20 then raise exception 'Too many restaurant images.'; end if;
  foreach image in array r.image_paths||case when r.cover_image_path is null then '{}'::text[] else array[r.cover_image_path] end loop
    if image is null or image !~ '^rest/[0-9a-fA-F-]{36}/[a-zA-Z0-9._-]+\.(jpg|png|webp)$'
      or (not admin_mode and split_part(image,'/',2)<>auth.uid()::text) then raise exception 'Invalid restaurant image.'; end if;
  end loop;
  if current_row.id is null and not (payload ? 'cover_image_path') then r.cover_image_path:=r.image_paths[1]; end if;
  r.menu:=coalesce(nullif(r.menu,'null'::jsonb),'[]'::jsonb);
  perform public.validate_restaurant_menu(r.menu);
  if r.opening_hours='null'::jsonb then r.opening_hours:=null; end if;
  if r.opening_hours is not null then
    if jsonb_typeof(r.opening_hours)<>'object' or exists(select 1 from jsonb_object_keys(r.opening_hours) d
      where d not in ('mon','tue','wed','thu','fri','sat','sun')) then raise exception 'Invalid opening hours.'; end if;
    for day in select value from jsonb_each(r.opening_hours) loop
      if jsonb_typeof(day)<>'array' then raise exception 'Invalid opening hours.'; end if;
      if jsonb_array_length(day)>10 then raise exception 'Too many opening-hour intervals.'; end if;
      for slot in select value from jsonb_array_elements(day) loop
        if jsonb_typeof(slot)<>'object' or slot->>'open' is null or slot->>'close' is null
          or slot->>'open' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or slot->>'close' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Invalid opening hours.'; end if;
      end loop;
    end loop;
  end if;
  r.search_text:=public.restaurant_search_value(r);
  return r;
end $restaurant$;
revoke all on function public.checked_restaurant_patch(public.restaurants,jsonb,boolean) from public,anon,authenticated;

create or replace function public.submit_restaurant(payload jsonb)
returns public.restaurants language plpgsql security definer set search_path='' as $$
declare caller uuid:=public.require_active_account(); r public.restaurants; result public.restaurants; begin
  r:=public.checked_restaurant_patch(r,payload,false);
  insert into public.restaurants(name,slug,description,address,parish,city,latitude,longitude,phone_number,website_url,
    instagram_handle,price_range,cuisines,categories,image_paths,cover_image_path,opening_hours,menu,added_by,search_text)
  values(r.name,regexp_replace(lower(r.name),'[^a-z0-9]+','-','g')||'-'||gen_random_uuid()::text,r.description,r.address,r.parish,
    r.city,r.latitude,r.longitude,r.phone_number,r.website_url,r.instagram_handle,r.price_range,r.cuisines,r.categories,
    r.image_paths,r.cover_image_path,r.opening_hours,r.menu,caller,r.search_text) returning * into result;
  return result;
end $$;

create or replace function public.admin_write_restaurant(payload jsonb,target_id uuid default null)
returns public.restaurants language plpgsql security definer set search_path='' as $$
declare r public.restaurants; result public.restaurants; begin
  if not public.is_admin() then raise exception 'Admin access required.'; end if;
  if target_id is not null then
    select * into r from public.restaurants where id=target_id for update;
    if not found then raise exception 'Restaurant not found.'; end if;
  end if;
  r:=public.checked_restaurant_patch(r,payload,true);
  if target_id is null then
    insert into public.restaurants(name,slug,description,address,parish,city,latitude,longitude,phone_number,website_url,
      instagram_handle,price_range,cuisines,categories,image_paths,cover_image_path,opening_hours,menu,added_by,search_text,is_active,is_verified,is_featured)
    values(r.name,regexp_replace(lower(r.name),'[^a-z0-9]+','-','g')||'-'||gen_random_uuid()::text,r.description,r.address,r.parish,
      r.city,r.latitude,r.longitude,r.phone_number,r.website_url,r.instagram_handle,r.price_range,r.cuisines,r.categories,
      r.image_paths,r.cover_image_path,r.opening_hours,r.menu,auth.uid(),r.search_text,coalesce(r.is_active,false),coalesce(r.is_verified,false),coalesce(r.is_featured,false)) returning * into result;
  else
    update public.restaurants set name=r.name,description=r.description,address=r.address,parish=r.parish,city=r.city,
      latitude=r.latitude,longitude=r.longitude,phone_number=r.phone_number,website_url=r.website_url,instagram_handle=r.instagram_handle,
      price_range=r.price_range,cuisines=r.cuisines,categories=r.categories,image_paths=r.image_paths,cover_image_path=r.cover_image_path,
      opening_hours=r.opening_hours,menu=r.menu,search_text=r.search_text,is_active=r.is_active,is_verified=r.is_verified,is_featured=r.is_featured
      where id=target_id returning * into result;
  end if;
  return result;
end $$;

create or replace function public.admin_restaurant_page(search_term text default '',filter_status text default 'all',
  after_id uuid default null,page_size integer default 25,claimed_only boolean default false)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare cursor_row public.restaurants; result jsonb; begin
  if not public.is_admin() then raise exception 'Admin access required.'; end if;
  if page_size is null or page_size not between 1 and 100 or filter_status is null or filter_status not in ('all','active','pending')
    or length(coalesce(search_term,''))>200 or claimed_only is null then raise exception 'Invalid restaurant query.'; end if;
  if after_id is not null then
    select * into cursor_row from public.restaurants where id=after_id;
    if not found then raise exception 'Invalid restaurant cursor. Refresh the list.'; end if;
  end if;
  with matches as (select * from public.restaurants r where
    (filter_status='all' or r.is_active=(filter_status='active')) and (not claimed_only or r.owner_id is not null)
    and strpos(r.search_text,lower(btrim(coalesce(search_term,''))))>0),
  page as (select * from matches where after_id is null or (created_at,id)<(cursor_row.created_at,after_id)
    order by created_at desc,id desc limit page_size+1)
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc,p.id desc) from page p),'[]'::jsonb),
    'total',(select count(*) from matches)) into result;
  return result;
end $$;

create or replace function public.admin_set_restaurant_owner(target_id uuid,new_owner uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Admin access required.'; end if;
  if new_owner is not null and (not exists(select 1 from public.profiles where id=new_owner and not is_banned)
    or exists(select 1 from public.auth_signup_pending where user_id=new_owner)) then raise exception 'Owner account is not active.'; end if;
  perform 1 from public.restaurants where id=target_id for update;
  if not found then raise exception 'Restaurant not found.'; end if;
  update public.restaurants set owner_id=new_owner where id=target_id;
  if new_owner is null then delete from public.restaurant_menus where restaurant_id=target_id;
  else insert into public.restaurant_menus(restaurant_id,owner_id) values(target_id,new_owner)
    on conflict(restaurant_id) do update set owner_id=excluded.owner_id; end if;
end $$;

create or replace function public.admin_set_listing_expiry(target_id uuid,paid_until timestamptz)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Admin access required.'; end if;
  update public.restaurants set listing_paid_until=paid_until where id=target_id;
  if not found then raise exception 'Restaurant not found.'; end if;
end $$;

create or replace function public.admin_rebuild_restaurant_search()
returns jsonb language plpgsql security definer set search_path='' as $$
declare scanned bigint; updated bigint; begin
  if not public.is_admin() then raise exception 'Admin access required.'; end if;
  select count(*) into scanned from public.restaurants;
  update public.restaurants r set search_text=public.restaurant_search_value(r)
    where search_text is distinct from public.restaurant_search_value(r);
  get diagnostics updated=row_count;
  return jsonb_build_object('scanned',scanned,'updated',updated);
end $$;

alter table public.app_config add column spot_date date,add column plate_image_path text;
revoke insert,update,delete on public.app_config from public,anon,authenticated;
create or replace function public.admin_set_spot_of_day(restaurant_id uuid,pin_date date default null,plate_path text default null)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Admin access required.'; end if;
  if restaurant_id is not null then
    perform 1 from public.restaurants where id=restaurant_id and is_active for update;
    if not found then raise exception 'Choose an active restaurant for the spotlight.'; end if;
    if plate_path is not null and plate_path !~ '^(rest|rev)/[0-9a-fA-F-]{36}/[a-zA-Z0-9._-]+\.(jpg|png|webp)$' then raise exception 'Invalid spotlight image.'; end if;
  end if;
  insert into public.app_config(id,spot_of_day_restaurant_id,spot_date,plate_image_path,updated_at)
    values(true,restaurant_id,case when restaurant_id is null then null else pin_date end,
      case when restaurant_id is null then null else plate_path end,now())
    on conflict(id) do update set spot_of_day_restaurant_id=excluded.spot_of_day_restaurant_id,
      spot_date=excluded.spot_date,plate_image_path=excluded.plate_image_path,updated_at=now();
end $$;

create or replace function public.admin_delete_restaurant(target_id uuid)
returns text[] language plpgsql security definer set search_path='' as $$
declare images text[]; r public.restaurants; begin
  if not public.is_admin() then raise exception 'Admin access required.'; end if;
  select * into r from public.restaurants where id=target_id for update;
  if not found then raise exception 'Restaurant not found.'; end if;
  select coalesce(array_agg(distinct image),'{}') into images from unnest(r.image_paths||array[r.cover_image_path,r.plate_image_path]) image where image is not null;
  update public.app_config set spot_of_day_restaurant_id=null,spot_date=null,plate_image_path=null,updated_at=now()
    where spot_of_day_restaurant_id=target_id;
  delete from public.restaurants where id=target_id;
  return images;
end $$;

revoke all on function public.submit_restaurant(jsonb),public.admin_write_restaurant(jsonb,uuid),
  public.admin_restaurant_page(text,text,uuid,integer,boolean),public.admin_set_restaurant_owner(uuid,uuid),
  public.admin_set_listing_expiry(uuid,timestamptz),public.admin_rebuild_restaurant_search(),
  public.admin_set_spot_of_day(uuid,date,text),public.admin_delete_restaurant(uuid) from public,anon;
grant execute on function public.submit_restaurant(jsonb),public.admin_write_restaurant(jsonb,uuid),
  public.admin_restaurant_page(text,text,uuid,integer,boolean),public.admin_set_restaurant_owner(uuid,uuid),
  public.admin_set_listing_expiry(uuid,timestamptz),public.admin_rebuild_restaurant_search(),
  public.admin_set_spot_of_day(uuid,date,text),public.admin_delete_restaurant(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
