begin;

-- RLS does not guard TRUNCATE. Client reads stay under RLS; writes use RPCs.
revoke all on public.saved_restaurants,public.blocks,public.collections from public,anon,authenticated;
grant select on public.saved_restaurants,public.blocks,public.collections to authenticated;
do $$declare t text;cols text;begin
 foreach t in array array['saved_restaurants','blocks','collections'] loop
  select string_agg(quote_ident(column_name),',')into cols from information_schema.columns
   where table_schema='public'and table_name=t;
  execute format('revoke insert(%s),update(%s),references(%s) on public.%I from public,anon,authenticated',cols,cols,cols,t);
 end loop;
end $$;
alter table public.saved_restaurants enable row level security;
alter table public.blocks enable row level security;
alter table public.collections enable row level security;

create policy "saves active owner read" on public.saved_restaurants as restrictive for select to authenticated
 using(public.is_active_account()and user_id=auth.uid());
create policy "blocks active participant read" on public.blocks as restrictive for select to authenticated
 using(public.is_active_account()and(blocker_id=auth.uid()or blocked_id=auth.uid()));
-- Public collections were signed-in-only in Appwrite. Private ones remain private.
create policy "collections active member read" on public.collections as restrictive for select to authenticated
 using(public.is_active_account()and(owner_id=auth.uid()or public.is_admin()
  or(is_public and public.community_author_visible(owner_id))));

create function public.set_member_saved(target_restaurant uuid,saved_list text,should_save boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare caller uuid:=public.require_active_account();begin
 if target_restaurant is null or saved_list is null or saved_list not in('favorite','want_to_go','visited')or should_save is null then
  raise exception 'Invalid saved restaurant.';
 end if;
 -- Serialize all buckets for this member/restaurant, including concurrent adds.
 perform pg_advisory_xact_lock(hashtextextended(caller::text||':'||target_restaurant::text,22022));
 if should_save then
  if not exists(select 1 from public.restaurants where id=target_restaurant and is_active)then
   raise exception 'Restaurant unavailable.';
  end if;
  if saved_list in('visited','want_to_go')then
   delete from public.saved_restaurants where user_id=caller and restaurant_id=target_restaurant
    and list_type=case saved_list when 'visited'then 'want_to_go'else 'visited'end;
  end if;
  insert into public.saved_restaurants(user_id,restaurant_id,list_type)values(caller,target_restaurant,saved_list)
   on conflict(user_id,restaurant_id,list_type)do nothing;
 else
  -- Allow removal even if the restaurant has become inactive.
  delete from public.saved_restaurants where user_id=caller and restaurant_id=target_restaurant and list_type=saved_list;
 end if;
 return target_restaurant;
end $$;

create function public.set_member_block(target_user uuid,should_block boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare caller uuid:=public.require_active_account();begin
 if target_user is null or should_block is null then raise exception 'Invalid block.';end if;
 if target_user=caller then raise exception 'You can''t block yourself.';end if;
 if should_block then
  -- Blocking back and blocking a banned/pending profile must remain possible.
  if not exists(select 1 from public.profiles where id=target_user)then raise exception 'This account is unavailable.';end if;
  insert into public.blocks(blocker_id,blocked_id)values(caller,target_user)on conflict do nothing;
 else delete from public.blocks where blocker_id=caller and blocked_id=target_user;end if;
 return target_user;
end $$;

create function public.write_member_collection(target_collection uuid,collection_patch jsonb)
returns public.collections language plpgsql security definer set search_path='' as $$
declare caller uuid:=public.require_active_account();result public.collections;k text;v jsonb;begin
 if collection_patch is null or jsonb_typeof(collection_patch)<>'object'then raise exception 'Invalid collection.';end if;
 for k,v in select * from jsonb_each(collection_patch)loop
  if k not in('title','description','is_public')then raise exception 'Invalid collection field.';end if;
  if k='title'and(jsonb_typeof(v)<>'string'or char_length(btrim(v#>>'{}'))not between 2 and 100)then
   raise exception 'Collection title must be 2 to 100 characters.';
  end if;
  if k='description'and jsonb_typeof(v)not in('string','null')then raise exception 'Invalid description.';end if;
  if k='is_public'and jsonb_typeof(v)<>'boolean'then raise exception 'Invalid collection visibility.';end if;
 end loop;
 if target_collection is null then
  if not collection_patch?'title'then raise exception 'Enter a collection title.';end if;
  insert into public.collections(owner_id,title,description,is_public)
   values(caller,btrim(collection_patch->>'title'),nullif(btrim(collection_patch->>'description'),''),
    coalesce((collection_patch->>'is_public')::boolean,false))returning * into result;
 else
  select * into result from public.collections where id=target_collection and owner_id=caller for update;
  if not found then raise exception 'Collection not found or permission denied.';end if;
  if collection_patch?'title'then result.title:=btrim(collection_patch->>'title');end if;
  if collection_patch?'description'then result.description:=nullif(btrim(collection_patch->>'description'),'');end if;
  if collection_patch?'is_public'then result.is_public:=(collection_patch->>'is_public')::boolean;end if;
  update public.collections set title=result.title,description=result.description,is_public=result.is_public
   where id=target_collection and owner_id=caller returning * into result;
 end if;
 return result;
end $$;

create function public.delete_member_collection(target_collection uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare caller uuid:=public.require_active_account();begin
 if target_collection is null then raise exception 'Invalid collection.';end if;
 delete from public.collections where id=target_collection and owner_id=caller;
 if not found then raise exception 'Collection not found or permission denied.';end if;
 return target_collection;
end $$;

create or replace function public.change_collection_membership(collection_id uuid,restaurant_id uuid,should_add boolean)
returns public.collections language plpgsql security definer set search_path='' as $$
declare caller uuid:=public.require_active_account();result public.collections;begin
 if collection_id is null or restaurant_id is null or should_add is null then raise exception 'Invalid collection membership.';end if;
 select * into result from public.collections where id=collection_id and owner_id=caller for update;
 if not found then raise exception 'Collection not found or permission denied.';end if;
 if should_add then
  if not exists(select 1 from public.restaurants where id=restaurant_id and is_active)then raise exception 'Restaurant unavailable.';end if;
  if not restaurant_id=any(result.restaurant_ids)then result.restaurant_ids:=array_append(result.restaurant_ids,restaurant_id);end if;
 else result.restaurant_ids:=array_remove(result.restaurant_ids,restaurant_id);end if;
 if result.cover_restaurant_id is null or not result.cover_restaurant_id=any(result.restaurant_ids)then
  result.cover_restaurant_id:=result.restaurant_ids[1];
 end if;
 update public.collections set restaurant_ids=result.restaurant_ids,cover_restaurant_id=result.cover_restaurant_id
  where id=collection_id and owner_id=caller returning * into result;
 return result;
end $$;

revoke all on function public.set_member_saved(uuid,text,boolean),public.set_member_block(uuid,boolean),
 public.write_member_collection(uuid,jsonb),public.delete_member_collection(uuid),
 public.change_collection_membership(uuid,uuid,boolean)from public,anon,authenticated;
grant execute on function public.set_member_saved(uuid,text,boolean),public.set_member_block(uuid,boolean),
 public.write_member_collection(uuid,jsonb),public.delete_member_collection(uuid),
 public.change_collection_membership(uuid,uuid,boolean)to authenticated;
notify pgrst,'reload schema';
commit;
