-- Read-only after migration 25 and its rollback tests. Still disabled.
do $$declare tab text;p text;f text;begin
 foreach tab in array array['purchase_settings','purchase_intents','purchase_ledger']loop
  if not exists(select 1 from pg_class where oid=('public.'||tab)::regclass and relrowsecurity)then raise exception 'Purchase RLS missing';end if;
  foreach p in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']loop
   if has_table_privilege('anon','public.'||tab,p)or has_table_privilege('authenticated','public.'||tab,p)then raise exception 'Unsafe purchase table grant';end if;
  end loop;
  if has_any_column_privilege('authenticated','public.'||tab,'SELECT,INSERT,UPDATE,REFERENCES')or has_any_column_privilege('anon','public.'||tab,'SELECT,INSERT,UPDATE,REFERENCES')then raise exception 'Unsafe purchase column grant';end if;
 end loop;
 foreach f in array array['prepare_purchase_intent(uuid,uuid,text)','my_purchase_intent(uuid)','fulfill_verified_purchase(uuid,jsonb)']loop
  if not exists(select 1 from pg_proc where oid=('public.'||f)::regprocedure and prosecdef and 'search_path=""'=any(proconfig))then raise exception 'Unsafe purchase RPC settings';end if;
  if has_function_privilege('anon','public.'||f,'EXECUTE')then raise exception 'Anonymous purchase RPC grant';end if;
 end loop;
 if has_function_privilege('authenticated','public.fulfill_verified_purchase(uuid,jsonb)','EXECUTE')
  or not has_function_privilege('service_role','public.fulfill_verified_purchase(uuid,jsonb)','EXECUTE')then raise exception 'Unsafe fulfillment grant';end if;
 if not exists(select 1 from public.purchase_settings where id=true and not enabled and rc_project_id is null and allowed_apps='{}'and environment='SANDBOX')then raise exception 'Payments no longer disabled';end if;
 if exists(select 1 from auth.users where id::text like 'fc250000-%')or exists(select 1 from public.profiles where id::text like 'fc250000-%')
  or exists(select 1 from public.restaurants where id::text like 'fc254000-%')or exists(select 1 from public.purchase_intents where id::text like 'fc251000-%')
  or exists(select 1 from public.purchase_ledger where rc_project_id='proj-fixture-25')then raise exception 'Purchase fixtures remain';end if;
end $$;
select 'Purchase permissions, disabled settings and zero fixtures verified'as result;
