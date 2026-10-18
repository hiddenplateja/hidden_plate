begin;
-- Staged and disabled. Only a future trusted verifier may submit proof to fulfill.
create table public.purchase_settings(
 id boolean primary key default true check(id),enabled boolean not null default false,
 rc_project_id text check(rc_project_id is null or length(rc_project_id)between 1 and 255),
 allowed_apps jsonb not null default '{}'check(jsonb_typeof(allowed_apps)='object'),
 environment text not null default 'SANDBOX'check(environment in('SANDBOX','PRODUCTION'))
);
insert into public.purchase_settings(id)values(true);
create table public.purchase_intents(
 id uuid primary key,buyer_id uuid not null references public.profiles(id)on delete cascade,
 restaurant_id uuid not null references public.restaurants(id)on delete cascade,
 product_id text not null,kind text not null check(kind in('feature','listing')),
 days integer not null check(days between 1 and 3650),created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default(clock_timestamp()+interval '2 hours'),
 fulfilled_at timestamptz
);
create index purchase_intents_buyer_created_idx on public.purchase_intents(buyer_id,created_at desc);
create table public.purchase_ledger(
 id uuid primary key default gen_random_uuid(),intent_id uuid unique references public.purchase_intents(id)on delete set null,
 buyer_id uuid references public.profiles(id)on delete set null,restaurant_id uuid references public.restaurants(id)on delete set null,
 rc_project_id text not null,rc_purchase_id text not null,app_id text not null,store text not null,
 environment text not null,store_transaction_id text not null,product_id text not null,
 kind text not null check(kind in('feature','listing')),days integer not null check(days between 1 and 3650),
 purchased_at timestamptz not null,granted_until timestamptz not null,created_at timestamptz not null default clock_timestamp(),
 unique(rc_project_id,rc_purchase_id),unique(app_id,store,environment,store_transaction_id)
);
do $$declare tab text;begin
 foreach tab in array array['purchase_settings','purchase_intents','purchase_ledger']loop
  execute format('alter table public.%I enable row level security',tab);
  execute format('revoke all on public.%I from public,anon,authenticated',tab);
  execute format('grant all on public.%I to service_role',tab);
 end loop;
end $$;

create function public.purchase_product_terms(store_product text)
returns jsonb language plpgsql stable set search_path='' as $$
declare feature jsonb;listing jsonb;plan jsonb;kind text;days integer;begin
 if store_product is null or length(store_product)not between 1 and 200 or store_product!~'^[A-Za-z0-9._-]+$'then raise exception 'Invalid purchase product.';end if;
 select feature_plans,listing_plans into feature,listing from public.app_config where id=true;
 perform public.validate_display_plans(feature,'feature');perform public.validate_display_plans(listing,'listing');
 for plan in select value from jsonb_array_elements(coalesce(feature,'[]'))where value->>'productId'=store_product loop
  kind:='feature';days:=(plan->>'days')::integer;
 end loop;
 for plan in select value from jsonb_array_elements(coalesce(listing,'[]'))where value->>'productId'=store_product loop
  if kind is not null then raise exception 'Ambiguous purchase product.';end if;
  kind:='listing';days:=(plan->>'days')::integer;
 end loop;
 if kind is null then
  if store_product='feature_7d'then kind:='feature';days:=7;
  elsif store_product='feature_30d'then kind:='feature';days:=30;
  elsif store_product='listing_1yr'then kind:='listing';days:=365;
  else raise exception 'Unknown purchase product.';end if;
 end if;
 if(store_product in('feature_7d','feature_30d')and kind<>'feature')or(store_product='listing_1yr'and kind<>'listing')then raise exception 'Ambiguous purchase product.';end if;
 return jsonb_build_object('kind',kind,'days',days);
end $$;

create function public.prepare_purchase_intent(request_id uuid,target_restaurant uuid,store_product text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare caller uuid:=public.require_active_account();terms jsonb;r public.purchase_intents;begin
 if not exists(select 1 from public.purchase_settings where id=true and enabled)then raise exception 'Payments are not enabled.';end if;
 if request_id is null or target_restaurant is null then raise exception 'Invalid purchase intent.';end if;
 perform pg_advisory_xact_lock(hashtextextended(request_id::text,25));
 if not exists(select 1 from public.restaurants where id=target_restaurant and owner_id=caller and is_active)then raise exception 'Active restaurant ownership required.';end if;
 select * into r from public.purchase_intents where id=request_id;
 if found then
  if r.buyer_id<>caller or r.restaurant_id<>target_restaurant or r.product_id is distinct from store_product then raise exception 'Purchase intent conflict.';end if;
  return jsonb_build_object('id',r.id,'product_id',r.product_id,'kind',r.kind,'days',r.days,'expires_at',r.expires_at,'fulfilled',r.fulfilled_at is not null);
 end if;
 terms:=public.purchase_product_terms(store_product);
 insert into public.purchase_intents(id,buyer_id,restaurant_id,product_id,kind,days)
  values(request_id,caller,target_restaurant,store_product,terms->>'kind',(terms->>'days')::integer)returning * into r;
 return jsonb_build_object('id',r.id,'product_id',r.product_id,'kind',r.kind,'days',r.days,'expires_at',r.expires_at,'fulfilled',false);
end $$;

create function public.my_purchase_intent(target_intent uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare caller uuid:=public.require_active_account();r public.purchase_intents;until timestamptz;begin
 select * into r from public.purchase_intents where id=target_intent and buyer_id=caller;
 if not found then return null;end if;
 select granted_until into until from public.purchase_ledger where intent_id=r.id;
 return jsonb_build_object('id',r.id,'product_id',r.product_id,'kind',r.kind,'days',r.days,'expires_at',r.expires_at,'fulfilled',r.fulfilled_at is not null,'granted_until',until);
end $$;

-- Privileged verifier contract, NOT a user-provided receipt endpoint. A future
-- Edge Function must independently verify RevenueCat purchase/product/customer,
-- consumable ownership/status/quantity and app/store/environment before calling.
create function public.fulfill_verified_purchase(target_intent uuid,proof jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare intent public.purchase_intents;s public.purchase_settings;ledger public.purchase_ledger;
 restaurant public.restaurants;purchased timestamptz;until timestamptz;k text;v jsonb;begin
 if proof is null or jsonb_typeof(proof)<>'object'then raise exception 'Invalid verified purchase.';end if;
 for k,v in select * from jsonb_each(proof)loop
  if k not in('rc_project_id','rc_purchase_id','buyer_id','app_id','store','environment','store_transaction_id','product_id','purchased_at')
   or jsonb_typeof(v)<>'string'or length(v#>>'{}')not between 1 and 255 then raise exception 'Invalid verified purchase field.';end if;
 end loop;
 if not proof?&array['rc_project_id','rc_purchase_id','buyer_id','app_id','store','environment','store_transaction_id','product_id','purchased_at']then raise exception 'Incomplete verified purchase.';end if;
 select * into s from public.purchase_settings where id=true for share;
 if not found or not s.enabled or s.rc_project_id is distinct from proof->>'rc_project_id'
  or s.environment is distinct from proof->>'environment'or proof->>'store'not in('APP_STORE','PLAY_STORE')
  or(s.allowed_apps->>(proof->>'app_id'))is distinct from proof->>'store'then raise exception 'Purchase route is not enabled for this app/store/environment.';end if;
 -- Global verified purchase lock, then buyer, intent and restaurant. Pin the
 -- buyer before intent locks so profile deletion/cascades cannot invert them.
 -- Unique constraints remain the final transaction-identity defense.
 perform pg_advisory_xact_lock(hashtextextended((proof->>'rc_project_id')||'/'||(proof->>'rc_purchase_id'),25));
 perform 1 from public.profiles where id=(proof->>'buyer_id')::uuid for share;
 if not found then raise exception 'Buyer needs an active account.';end if;
 select * into intent from public.purchase_intents where id=target_intent for update;
 if not found then raise exception 'Purchase intent is unavailable.';end if;
 if intent.buyer_id::text is distinct from proof->>'buyer_id'or intent.product_id is distinct from proof->>'product_id'then raise exception 'Verified purchase does not match intent.';end if;
 select * into ledger from public.purchase_ledger where(rc_project_id=proof->>'rc_project_id'and rc_purchase_id=proof->>'rc_purchase_id')
  or(app_id=proof->>'app_id'and store=proof->>'store'and environment=proof->>'environment'and store_transaction_id=proof->>'store_transaction_id');
 if found then
  if ledger.intent_id is distinct from intent.id or ledger.buyer_id is distinct from intent.buyer_id
   or ledger.product_id is distinct from intent.product_id or ledger.rc_purchase_id is distinct from proof->>'rc_purchase_id'
   or ledger.app_id is distinct from proof->>'app_id'or ledger.store is distinct from proof->>'store'
   or ledger.environment is distinct from proof->>'environment'or ledger.store_transaction_id is distinct from proof->>'store_transaction_id'then raise exception 'Purchase was already assigned or proof changed.';end if;
  return jsonb_build_object('fulfilled',true,'granted_until',ledger.granted_until);
 end if;
 if intent.fulfilled_at is not null then raise exception 'Purchase intent was already fulfilled.';end if;
 purchased:=(proof->>'purchased_at')::timestamptz;
 -- Delivery may be delayed: expire by verified purchase time, not delivery time.
 if not isfinite(purchased)or purchased<intent.created_at-interval '5 minutes'or purchased>intent.expires_at
  or purchased>clock_timestamp()+interval '5 minutes'then raise exception 'Purchase time does not match intent.';end if;
 perform 1 from public.profiles where id=intent.buyer_id and not is_banned for share;
 if not found or exists(select 1 from public.auth_signup_pending where user_id=intent.buyer_id)then raise exception 'Buyer needs an active account.';end if;
 select * into restaurant from public.restaurants where id=intent.restaurant_id for update;
 if not found or restaurant.owner_id is distinct from intent.buyer_id or not restaurant.is_active then raise exception 'Active restaurant ownership required.';end if;
 until:=greatest(clock_timestamp(),case when intent.kind='feature'then restaurant.featured_until else restaurant.listing_paid_until end)
  +make_interval(days=>intent.days);
 if not isfinite(until)then raise exception 'Paid window is not finite.';end if;
 insert into public.purchase_ledger(intent_id,buyer_id,restaurant_id,rc_project_id,rc_purchase_id,app_id,store,environment,store_transaction_id,product_id,kind,days,purchased_at,granted_until)
  values(intent.id,intent.buyer_id,intent.restaurant_id,proof->>'rc_project_id',proof->>'rc_purchase_id',proof->>'app_id',proof->>'store',proof->>'environment',proof->>'store_transaction_id',intent.product_id,intent.kind,intent.days,purchased,until);
 if intent.kind='feature'then update public.restaurants set is_featured=true,featured_until=until,updated_at=now()where id=intent.restaurant_id;
 else update public.restaurants set listing_paid_until=until,updated_at=now()where id=intent.restaurant_id;end if;
 update public.purchase_intents set fulfilled_at=clock_timestamp()where id=intent.id;
 return jsonb_build_object('fulfilled',true,'granted_until',until);
end $$;

revoke all on function public.purchase_product_terms(text),public.prepare_purchase_intent(uuid,uuid,text),
 public.my_purchase_intent(uuid),public.fulfill_verified_purchase(uuid,jsonb)from public,anon,authenticated;
grant execute on function public.prepare_purchase_intent(uuid,uuid,text),public.my_purchase_intent(uuid)to authenticated;
grant execute on function public.fulfill_verified_purchase(uuid,jsonb)to service_role;
notify pgrst,'reload schema';
commit;
