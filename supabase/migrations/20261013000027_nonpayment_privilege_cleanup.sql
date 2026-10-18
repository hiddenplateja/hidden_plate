-- Applied/tested with approval on 2026-10-13. No data changes/payments.
begin;
do $$declare tab text;cols text;begin
 for tab in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public'and c.relkind in('r','p')loop
  execute format('revoke truncate,references,trigger,maintain on public.%I from public,anon,authenticated',tab);
  select string_agg(quote_ident(a.attname),','order by a.attnum)into cols from pg_attribute a
   where a.attrelid=('public.'||quote_ident(tab))::regclass and a.attnum>0 and not a.attisdropped;
  execute format('revoke references(%s)on public.%I from public,anon,authenticated',cols,tab);
 end loop;
end $$;
revoke delete on public.notifications from public,anon;
-- App-owned public objects only. Do not alter managed supabase_admin defaults.
alter default privileges for role postgres in schema public
 revoke truncate,references,trigger,maintain on tables from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
