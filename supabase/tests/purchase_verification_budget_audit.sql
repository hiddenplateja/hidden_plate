-- Read-only after migration 26 plus rollback tests. Payments remain disabled.
do $$declare p text;begin
 if not exists(select 1 from pg_class where oid='public.purchase_verification_budgets'::regclass and relrowsecurity)then raise exception 'Budget RLS missing';end if;
 foreach p in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']loop
  if has_table_privilege('anon','public.purchase_verification_budgets',p)or has_table_privilege('authenticated','public.purchase_verification_budgets',p)then raise exception 'Unsafe budget grant';end if;
 end loop;
 if has_any_column_privilege('anon','public.purchase_verification_budgets','SELECT,INSERT,UPDATE,REFERENCES')or has_any_column_privilege('authenticated','public.purchase_verification_budgets','SELECT,INSERT,UPDATE,REFERENCES')then raise exception 'Unsafe budget column grant';end if;
 if has_function_privilege('anon','public.take_purchase_verification_slot(uuid)','EXECUTE')or has_function_privilege('authenticated','public.take_purchase_verification_slot(uuid)','EXECUTE')
  or not has_function_privilege('service_role','public.take_purchase_verification_slot(uuid)','EXECUTE')then raise exception 'Unsafe budget RPC grant';end if;
 if not exists(select 1 from pg_proc where oid='public.take_purchase_verification_slot(uuid)'::regprocedure and prosecdef and 'search_path=""'=any(proconfig))then raise exception 'Unsafe budget function settings';end if;
 if exists(select 1 from public.purchase_verification_budgets)or exists(select 1 from auth.users where id::text like 'fc260000-%')or exists(select 1 from public.profiles where id::text like 'fc260000-%')then raise exception 'Budget fixtures remain';end if;
 if not exists(select 1 from public.purchase_settings where id=true and not enabled and rc_project_id is null and allowed_apps='{}')then raise exception 'Payments enabled unexpectedly';end if;
end $$;
select 'Verification budget permissions, disabled payments and zero fixtures verified'as result;
