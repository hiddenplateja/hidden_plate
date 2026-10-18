create or replace function public.change_collection_membership(collection_id uuid, restaurant_id uuid, should_add boolean)
returns public.collections language plpgsql security invoker set search_path=public as $$
declare result public.collections;
begin
  select * into result from collections where id=collection_id and owner_id=auth.uid() for update;
  if not found then raise exception 'Collection not found or permission denied.'; end if;
  if should_add then
    if not exists(select 1 from restaurants where id=restaurant_id and is_active) then raise exception 'Restaurant unavailable.'; end if;
    if not restaurant_id=any(result.restaurant_ids) then result.restaurant_ids:=array_append(result.restaurant_ids,restaurant_id); end if;
  else
    result.restaurant_ids:=array_remove(result.restaurant_ids,restaurant_id);
    if result.cover_restaurant_id=restaurant_id then result.cover_restaurant_id:=result.restaurant_ids[1]; end if;
  end if;
  update collections set restaurant_ids=result.restaurant_ids,cover_restaurant_id=result.cover_restaurant_id where id=collection_id returning * into result;
  return result;
end; $$;
revoke all on function public.change_collection_membership(uuid,uuid,boolean) from public,anon;
grant execute on function public.change_collection_membership(uuid,uuid,boolean) to authenticated;
