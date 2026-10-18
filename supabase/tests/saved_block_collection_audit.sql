-- Read-only audit after applying migration 22 and completing rollback tests.
do $$declare t text;p text;f text;begin
 foreach t in array array['saved_restaurants','blocks','collections']loop
  if not(select relrowsecurity from pg_class where oid=('public.'||t)::regclass)then raise exception 'RLS missing: %',t;end if;
  if not has_table_privilege('authenticated','public.'||t,'SELECT')or has_table_privilege('anon','public.'||t,'SELECT')then raise exception 'Unsafe read grants: %',t;end if;
  foreach p in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']loop
   if has_table_privilege('authenticated','public.'||t,p)or has_table_privilege('anon','public.'||t,p)then raise exception 'Unsafe table grants: % %',t,p;end if;
  end loop;
  if has_any_column_privilege('authenticated','public.'||t,'INSERT,UPDATE,REFERENCES')or has_any_column_privilege('anon','public.'||t,'INSERT,UPDATE,REFERENCES')then raise exception 'Unsafe column grants: %',t;end if;
  if not exists(select 1 from pg_policy where polrelid=('public.'||t)::regclass and not polpermissive and polcmd='r')then raise exception 'Restrictive read policy missing: %',t;end if;
 end loop;
 foreach f in array array['set_member_saved(uuid,text,boolean)','set_member_block(uuid,boolean)','write_member_collection(uuid,jsonb)',
  'delete_member_collection(uuid)','change_collection_membership(uuid,uuid,boolean)']loop
  if has_function_privilege('anon','public.'||f,'EXECUTE')or not has_function_privilege('authenticated','public.'||f,'EXECUTE')then raise exception 'Unsafe RPC grants: %',f;end if;
  if not exists(select 1 from pg_proc where oid=('public.'||f)::regprocedure and prosecdef and 'search_path=""'=any(proconfig))then raise exception 'Unsafe RPC execution settings: %',f;end if;
 end loop;
 if exists(select 1 from auth.users where id::text like 'fc220000-%')or exists(select 1 from public.profiles where id::text like 'fc220000-%')
  or exists(select 1 from public.collections where id::text like 'fc225000-%')or exists(select 1 from public.restaurants where id::text like 'fc224000-%')then raise exception 'Relationship fixtures remain';end if;
end $$;
select 'Saves/blocks/collections RLS, restricted grants, server-checked RPCs and zero fixtures verified'as result;
