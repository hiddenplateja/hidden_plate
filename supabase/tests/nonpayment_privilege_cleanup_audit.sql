-- Read only, after approved migration 27 plus rollback tests.
do $$declare tab record;r text;p text;begin
 for tab in select c.oid,c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'and c.relkind in('r','p')loop
  if not tab.relrowsecurity then raise exception 'Public table RLS missing: %',tab.relname;end if;
  foreach r in array array['anon','authenticated']loop
   foreach p in array array['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']loop
    if has_table_privilege(r,tab.oid,p)then raise exception 'Ordinary administrative grant remains on %',tab.relname;end if;
   end loop;
   if has_any_column_privilege(r,tab.oid,'REFERENCES')then raise exception 'Ordinary column REFERENCES remains';end if;
  end loop;
 end loop;
 if has_table_privilege('anon','public.notifications','DELETE')then raise exception 'Anonymous inbox deletion remains';end if;
 if not has_table_privilege('authenticated','public.notifications','DELETE')or not has_column_privilege('authenticated','public.notifications','is_read','UPDATE')then raise exception 'Owner inbox actions missing';end if;
 if has_table_privilege('authenticated','public.notifications','UPDATE')or has_column_privilege('authenticated','public.notifications','body','UPDATE')then raise exception 'Inbox UPDATE is not column limited';end if;
 if not has_table_privilege('authenticated','public.reviews','DELETE')or not has_table_privilege('authenticated','public.push_tokens','DELETE')then raise exception 'Owner delete actions missing';end if;
 if not has_function_privilege('authenticated','public.admin_write_restaurant(jsonb,uuid)','EXECUTE')or not has_function_privilege('authenticated','public.admin_moderate_content(text,uuid,text)','EXECUTE')then raise exception 'Server-checked admin functions missing';end if;
 if not has_table_privilege('service_role','public.restaurants','TRUNCATE')or not has_table_privilege('service_role','public.notifications','TRUNCATE')then raise exception 'Trusted role grant changed';end if;
 if not exists(select 1 from public.purchase_settings where id=true and not enabled)then raise exception 'Payments enabled unexpectedly';end if;
 if to_regclass('public.privilege_fixture_27')is not null or exists(select 1 from auth.users where id::text like 'fc270000-%')or exists(select 1 from public.profiles where id::text like 'fc270000-%')or exists(select 1 from public.notifications where id::text like 'fc271000-%')then raise exception 'Permission fixtures remain';end if;
end $$;
select 'Non-payment administrative grants revoked; owner/admin/server actions preserved; zero fixtures verified'as result;
