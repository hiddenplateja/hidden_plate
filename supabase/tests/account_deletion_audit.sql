begin read only;
do $$declare f text;t text;begin
 if not exists(select 1 from pg_class where oid='public.account_deletion_jobs'::regclass and relrowsecurity)then raise exception 'Deletion job RLS missing';end if;
 if has_table_privilege('anon','public.account_deletion_jobs','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')or has_table_privilege('authenticated','public.account_deletion_jobs','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')then raise exception 'Deletion jobs exposed';end if;
 foreach f in array array['prepare_account_deletion(uuid)','complete_account_deletion(uuid)','pending_account_deletions()']loop
  if has_function_privilege('anon','public.'||f,'EXECUTE')or has_function_privilege('authenticated','public.'||f,'EXECUTE')or not has_function_privilege('service_role','public.'||f,'EXECUTE')then raise exception 'Unsafe privileged deletion function: %',f;end if;
 end loop;
 foreach t in array array['reviews','review_comments','posts','post_comments']loop
  if not exists(select 1 from pg_constraint where conrelid=('public.'||t)::regclass and conname=t||'_user_id_fkey'and confdeltype='n')then raise exception 'Missing retained-content FK: %',t;end if;
  if has_table_privilege('anon','public.'||t,'TRUNCATE')or has_table_privilege('authenticated','public.'||t,'TRUNCATE')then raise exception 'Unsafe truncate grant: %',t;end if;
 end loop;
 if exists(select 1 from auth.users where id::text like 'fd000000-%')or exists(select 1 from public.profiles where id::text like 'fd000000-%')or exists(select 1 from public.account_deletion_jobs where user_id::text like 'fd000000-%')or exists(select 1 from public.restaurants where id::text like 'fd400000-%')or exists(select 1 from public.posts where id::text like 'fd100000-%')then raise exception 'Deletion fixtures remain';end if;
end $$;
select 'Deletion jobs private, service-only functions, retention FKs and zero fixtures verified'as result;
commit;
