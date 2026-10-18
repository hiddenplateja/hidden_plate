begin;

-- Configuration is public before login, but client mutations must be checked.
alter table public.app_config add column feature_plans jsonb,add column listing_plans jsonb;
alter table public.app_control enable row level security;
alter table public.app_config enable row level security;
do $$declare tab text;cols text;begin
 foreach tab in array array['app_control','app_config']loop
  execute format('revoke all on public.%I from public,anon,authenticated',tab);
  select string_agg(quote_ident(column_name),',')into cols from information_schema.columns where table_schema='public'and table_name=tab;
  execute format('revoke insert(%s),update(%s),references(%s) on public.%I from public,anon,authenticated',cols,cols,cols,tab);
  execute format('grant select on public.%I to anon,authenticated',tab);
 end loop;
end $$;

create function public.public_app_configuration()
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('control',(select jsonb_build_object(
  'maintenance',maintenance,'maintenance_message',maintenance_message,'min_version',min_version,'latest_version',latest_version,
  'update_message',update_message,'ios_url',ios_url,'android_url',android_url)from public.app_control where id=true),
  'feature_plans',(select feature_plans from public.app_config where id=true),
  'listing_plans',(select listing_plans from public.app_config where id=true));
$$;

-- Null/empty catalogs intentionally mean the built-in defaults, as in Appwrite.
-- Prices here are display-only; the store/RevenueCat remain payment authority.
create function public.validate_display_plans(plans jsonb,plan_kind text)
returns void language plpgsql immutable set search_path='' as $$
declare p jsonb;k text;v jsonb;ids text[]:='{}';products text[]:='{}';begin
 if plans is null or plans='null'::jsonb then return;end if;
 if jsonb_typeof(plans)<>'array'then raise exception 'Invalid plan catalog.';end if;
 if jsonb_array_length(plans)>50 then raise exception 'Too many plans.';end if;
 for p in select value from jsonb_array_elements(plans)loop
  if jsonb_typeof(p)<>'object'then raise exception 'Invalid plan.';end if;
  for k,v in select * from jsonb_each(p)loop
   if k not in('id','label','days','amount','currency','badge','productId')then raise exception 'Invalid plan field.';end if;
  end loop;
  if jsonb_typeof(p->'id')is distinct from 'string'or length(btrim(p->>'id'))<1 or length(p->>'id')>100
   or jsonb_typeof(p->'label')is distinct from 'string'or length(btrim(p->>'label'))<1 or length(p->>'label')>100
   or jsonb_typeof(p->'currency')is distinct from 'string'or(p->>'currency')!~'^[A-Z]{3}$'
   or jsonb_typeof(p->'days')is distinct from 'number'or jsonb_typeof(p->'amount')is distinct from 'number'then raise exception 'Invalid plan details.';end if;
  if(p->>'days')::numeric not between 1 and 3650 or(p->>'days')::numeric<>trunc((p->>'days')::numeric)
   or(p->>'amount')::numeric not between 0 and 1000000000 then raise exception 'Invalid plan duration or amount.';end if;
  if p?'badge'and(jsonb_typeof(p->'badge')<>'string'or length(p->>'badge')>100)then raise exception 'Invalid plan badge.';end if;
  if plan_kind='listing'and not p?'productId'then raise exception 'Listing product is required.';end if;
  if p?'productId'and(jsonb_typeof(p->'productId')<>'string'or length(p->>'productId')not between 1 and 200
   or(p->>'productId')!~'^[A-Za-z0-9._-]+$')then raise exception 'Invalid plan product.';end if;
  if(p->>'id')=any(ids)or(p?'productId'and(p->>'productId')=any(products))then raise exception 'Duplicate plan ID or product.';end if;
  ids:=array_append(ids,p->>'id');if p?'productId'then products:=array_append(products,p->>'productId');end if;
 end loop;
end $$;

create function public.admin_patch_app_control(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare caller uuid:=public.require_active_account();r public.app_control;k text;v jsonb;begin
 if not public.is_admin()then raise exception 'Admin access required.';end if;
 if payload is null or jsonb_typeof(payload)<>'object'then raise exception 'Invalid app control.';end if;
 for k,v in select * from jsonb_each(payload)loop
  if k not in('maintenance','maintenance_message','min_version','latest_version','update_message','ios_url','android_url')then raise exception 'Invalid app control field.';end if;
  if k='maintenance'then
   if jsonb_typeof(v)<>'boolean'then raise exception 'Invalid maintenance flag.';end if;
  elsif jsonb_typeof(v)not in('string','null')then raise exception 'Invalid app control value.';end if;
  if k in('maintenance_message','update_message')and length(v#>>'{}')>500 then raise exception 'App message too long.';end if;
  if k in('min_version','latest_version')and v<>'null'::jsonb and(v#>>'{}')<>''
   and(length(v#>>'{}')>20 or(v#>>'{}')!~'^[0-9]+([.][0-9]+)*$')then raise exception 'Invalid app version.';end if;
  if k in('ios_url','android_url')and v<>'null'::jsonb and(v#>>'{}')<>''
   and(length(v#>>'{}')>512 or(v#>>'{}')!~'^https://[^[:space:]]+$')then raise exception 'Invalid store URL.';end if;
 end loop;
 insert into public.app_control(id)values(true)on conflict(id)do nothing;
 select * into r from public.app_control where id=true for update;
 r:=jsonb_populate_record(r,payload);
 update public.app_control set maintenance=r.maintenance,maintenance_message=r.maintenance_message,min_version=r.min_version,
  latest_version=r.latest_version,update_message=r.update_message,ios_url=r.ios_url,android_url=r.android_url,updated_at=now()where id=true;
 return public.public_app_configuration()->'control';
end $$;

create function public.admin_patch_display_plans(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare caller uuid:=public.require_active_account();r public.app_config;k text;v jsonb;feature_products text[];listing_products text[];begin
 if not public.is_admin()then raise exception 'Admin access required.';end if;
 if payload is null or jsonb_typeof(payload)<>'object'then raise exception 'Invalid plan catalog.';end if;
 for k,v in select * from jsonb_each(payload)loop
  if k not in('feature_plans','listing_plans')then raise exception 'Invalid plan catalog field.';end if;
  perform public.validate_display_plans(v,case when k='feature_plans'then 'feature'else 'listing'end);
 end loop;
 insert into public.app_config(id)values(true)on conflict(id)do nothing;
 select * into r from public.app_config where id=true for update;
 r:=jsonb_populate_record(r,payload);
 -- Defaults remain enabled in fulfillment unless overridden, as in Appwrite.
 select array_agg(value->>'productId')into feature_products from jsonb_array_elements(coalesce(r.feature_plans,'[]'))where value?'productId';
 select array_agg(value->>'productId')into listing_products from jsonb_array_elements(coalesce(r.listing_plans,'[]'))where value?'productId';
 if exists(select 1 from unnest(coalesce(feature_products,'{}')||array['feature_7d','feature_30d'])p
  where p=any(coalesce(listing_products,'{}')||array['listing_1yr']))then raise exception 'Product cannot be both feature and listing.';end if;
 update public.app_config set feature_plans=r.feature_plans,listing_plans=r.listing_plans,updated_at=now()where id=true;
 return jsonb_build_object('feature_plans',r.feature_plans,'listing_plans',r.listing_plans);
end $$;

revoke all on function public.public_app_configuration(),public.validate_display_plans(jsonb,text),
 public.admin_patch_app_control(jsonb),public.admin_patch_display_plans(jsonb)from public,anon,authenticated;
grant execute on function public.public_app_configuration()to anon,authenticated;
grant execute on function public.admin_patch_app_control(jsonb),public.admin_patch_display_plans(jsonb)to authenticated;
notify pgrst,'reload schema';
commit;
