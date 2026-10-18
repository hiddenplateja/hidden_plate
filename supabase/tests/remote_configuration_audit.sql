-- Read-only after migration 24 and rollback tests.
do $$declare tab text;p text;f text;begin
 foreach tab in array array['app_control','app_config']loop
  if not exists(select 1 from pg_class where oid=('public.'||tab)::regclass and relrowsecurity)then raise exception 'Config RLS missing';end if;
  foreach p in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']loop
   if has_table_privilege('anon','public.'||tab,p)or has_table_privilege('authenticated','public.'||tab,p)then raise exception 'Unsafe config grants: % %',tab,p;end if;
  end loop;
  if has_any_column_privilege('anon','public.'||tab,'INSERT,UPDATE,REFERENCES')or has_any_column_privilege('authenticated','public.'||tab,'INSERT,UPDATE,REFERENCES')then raise exception 'Unsafe config column grants';end if;
  if not has_table_privilege('anon','public.'||tab,'SELECT')or not has_table_privilege('authenticated','public.'||tab,'SELECT')then raise exception 'Public configuration read missing';end if;
 end loop;
 foreach f in array array['public_app_configuration()','admin_patch_app_control(jsonb)','admin_patch_display_plans(jsonb)']loop
  if not exists(select 1 from pg_proc where oid=('public.'||f)::regprocedure and prosecdef and 'search_path=""'=any(proconfig))then raise exception 'Unsafe config function settings';end if;
  if not has_function_privilege('authenticated','public.'||f,'EXECUTE')then raise exception 'Config RPC unavailable';end if;
 end loop;
 if not has_function_privilege('anon','public.public_app_configuration()','EXECUTE')
  or has_function_privilege('anon','public.admin_patch_app_control(jsonb)','EXECUTE')
  or has_function_privilege('anon','public.admin_patch_display_plans(jsonb)','EXECUTE')
  or has_function_privilege('authenticated','public.validate_display_plans(jsonb,text)','EXECUTE')then raise exception 'Unsafe config RPC grants';end if;
 if exists(select 1 from auth.users where id::text like 'fc240000-%')or exists(select 1 from public.profiles where id::text like 'fc240000-%')then raise exception 'Config fixtures remain';end if;
end $$;
select 'Remote configuration grants/settings and zero synthetic profiles verified'as result;
