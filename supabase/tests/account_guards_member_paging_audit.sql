-- Read-only after migration 23 and rollback tests.
do $$declare f text;p text;begin
 foreach f in array array['write_review(jsonb,uuid)','register_push_token(text,text)','member_saved_page(text,uuid,integer)','member_saved_count()',
  'member_hidden_user_page(uuid,integer)','member_blocked_profile_page(uuid,integer)','member_collection_page(uuid,boolean,uuid,integer)']loop
  if has_function_privilege('anon','public.'||f,'EXECUTE')or not has_function_privilege('authenticated','public.'||f,'EXECUTE')then raise exception 'Unsafe RPC grants: %',f;end if;
  if not exists(select 1 from pg_proc where oid=('public.'||f)::regprocedure and prosecdef and 'search_path=""'=any(proconfig))then raise exception 'Unsafe RPC settings: %',f;end if;
 end loop;
 foreach p in array array['INSERT','UPDATE','TRUNCATE','REFERENCES','TRIGGER']loop
  if has_table_privilege('authenticated','public.push_tokens',p)or has_table_privilege('anon','public.push_tokens',p)then raise exception 'Unsafe token grants: %',p;end if;
 end loop;
 if has_any_column_privilege('authenticated','public.push_tokens','INSERT,UPDATE,REFERENCES')or has_any_column_privilege('anon','public.push_tokens','INSERT,UPDATE,REFERENCES')then raise exception 'Unsafe token column grants';end if;
 if has_table_privilege('anon','public.push_tokens','SELECT,DELETE')
  or not has_table_privilege('authenticated','public.push_tokens','SELECT')
  or not has_table_privilege('authenticated','public.push_tokens','DELETE')then raise exception 'Unsafe token cleanup grants';end if;
 if not exists(select 1 from pg_policy where polrelid='public.reviews'::regclass and polname='reviews active member delete'and not polpermissive and polcmd='d')then raise exception 'Review DELETE guard missing';end if;
 if exists(select 1 from auth.users where id::text like 'fc230000-%')or exists(select 1 from public.profiles where id::text like 'fc230000-%')
  or exists(select 1 from public.restaurants where id::text like 'fc234000-%')or exists(select 1 from public.collections where id::text like 'fc235000-%')
  or exists(select 1 from public.reviews where id::text like 'fc236000-%')then raise exception 'Paging fixtures remain';end if;
end $$;
select 'Account guard/paging RPC grants, push cleanup/review delete permissions and zero fixtures verified'as result;
