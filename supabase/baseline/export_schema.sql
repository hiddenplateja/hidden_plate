-- READ ONLY. Captures public application DDL, never application/Auth rows.
-- Webhook trigger arguments, cron commands, Vault, roles/passwords and external
-- schemas are deliberately excluded. This is a recovery candidate, not pg_dump.
with tables as (
 select c.* from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public'and c.relkind='r'
), functions as (
 select p.*,pg_get_functiondef(p.oid)as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public'and p.prokind='f'
 and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
), views as (
 select c.* from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'and c.relkind='v'
), rows as (
 select 0 phase,'header'kind,'recovery_candidate'::text object_name,
 '-- Snapshot of public application schema. No data, credentials or webhook/cron setup.'||E'\n'||
 '-- Do not replay migrations 1-25 on top of this current-state snapshot.'||E'\n'||
 '-- Review grants and restore/test on a DISPOSABLE Supabase project first.'||E'\n'||
 'begin; set local search_path=public,extensions; set local check_function_bodies=false;'as ddl
 union all
 select 10,'enum',t.typname,format('create type public.%I as enum (%s);',t.typname,string_agg(quote_literal(e.enumlabel),','order by e.enumsortorder))
 from pg_type t join pg_namespace n on n.oid=t.typnamespace join pg_enum e on e.enumtypid=t.oid where n.nspname='public'group by t.oid,t.typname
 union all
 select 20,'table',c.relname,format('create table public.%I (%s);',c.relname,string_agg(
 format('%I %s%s%s',a.attname,format_type(a.atttypid,a.atttypmod),
 case when a.attgenerated='s'then ' generated always as ('||pg_get_expr(d.adbin,d.adrelid)||') stored'
 when a.attidentity<>''then ' generated '||case when a.attidentity='a'then 'always'else 'by default'end||' as identity'
 when d.oid is not null then ' default '||pg_get_expr(d.adbin,d.adrelid)else ''end,
 case when a.attnotnull then ' not null'else ''end),E',\n'order by a.attnum))
 from tables c join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
 left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum group by c.oid,c.relname
 union all
 select case when k.contype='f'then 35 else 30 end,'constraint',c.relname||'.'||k.conname,
 format('alter table public.%I add constraint %I %s;',c.relname,k.conname,pg_get_constraintdef(k.oid))
 from tables c join pg_constraint k on k.conrelid=c.oid
 union all
 select 40,'index',i.relname,pg_get_indexdef(i.oid)||';'from tables c join pg_index x on x.indrelid=c.oid join pg_class i on i.oid=x.indexrelid
 where not exists(select 1 from pg_constraint k where k.conindid=i.oid)
 union all
 select 50,'function',p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',p.definition from functions p
 union all
 -- The public view supplies composite return types used by four functions.
 select 45,'view',c.relname,format('create view public.%I%s as %s;',c.relname,
 case when c.reloptions is null then ''else ' with ('||array_to_string(c.reloptions,',')||')'end,trim(trailing ';'from pg_get_viewdef(c.oid,true)))from views c
 union all
 select 70,'rls',c.relname,format('alter table public.%I %s row level security;%s',c.relname,
 case when c.relrowsecurity then 'enable'else 'disable'end,
 case when c.relforcerowsecurity then format(' alter table public.%I force row level security;',c.relname)else ''end)from tables c
 union all
 select 80,'policy',c.relname||'.'||p.polname,format('create policy %I on public.%I as %s for %s to %s%s%s;',p.polname,c.relname,
 case when p.polpermissive then 'permissive'else 'restrictive'end,
 case p.polcmd when '*'then 'all'when 'r'then 'select'when 'a'then 'insert'when 'w'then 'update'when 'd'then 'delete'end,
 (select string_agg(case when r=0 then 'public'else quote_ident(pg_get_userbyid(r))end,','order by r)from unnest(p.polroles)r),
 case when p.polqual is null then ''else ' using ('||pg_get_expr(p.polqual,p.polrelid)||')'end,
 case when p.polwithcheck is null then ''else ' with check ('||pg_get_expr(p.polwithcheck,p.polrelid)||')'end)
 from tables c join pg_policy p on p.polrelid=c.oid
 union all
 select 90,'trigger',n.nspname||'.'||c.relname||'.'||t.tgname,pg_get_triggerdef(t.oid)||';'
 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
 join pg_proc p on p.oid=t.tgfoid join pg_namespace fn on fn.oid=p.pronamespace
 where not t.tgisinternal and t.tgnargs=0 and fn.nspname='public'
 and(n.nspname='public'or(n.nspname='auth'and c.relname='users'))
 union all
 select 100,'table_grant_reset',c.relname,format('revoke all on public.%I from public,anon,authenticated,service_role;',c.relname)
 from(select oid,relname,relacl,relowner from tables union all select oid,relname,relacl,relowner from views)c
 union all
 select 101,'table_grant',c.relname||'.'||a.grantee||'.'||a.privilege_type,
 format('grant %s on public.%I to %s%s;',a.privilege_type,c.relname,case when a.grantee=0 then 'public'else quote_ident(pg_get_userbyid(a.grantee))end,case when a.is_grantable then ' with grant option'else ''end)
 from(select oid,relname,relacl,relowner from tables union all select oid,relname,relacl,relowner from views)c
 cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a
 union all
 select 102,'column_grant',c.relname||'.'||col.attname||'.'||a.grantee||'.'||a.privilege_type,
 format('grant %s (%I) on public.%I to %s%s;',a.privilege_type,col.attname,c.relname,case when a.grantee=0 then 'public'else quote_ident(pg_get_userbyid(a.grantee))end,case when a.is_grantable then ' with grant option'else ''end)
 from tables c join pg_attribute col on col.attrelid=c.oid and col.attnum>0 and not col.attisdropped cross join lateral aclexplode(col.attacl)a
 union all
 select 110,'function_grant_reset',p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
 format('revoke all on function public.%I(%s)from public,anon,authenticated,service_role;',p.proname,pg_get_function_identity_arguments(p.oid))from functions p
 union all
 select 111,'function_grant',p.proname||'('||pg_get_function_identity_arguments(p.oid)||').' ||a.grantee,
 format('grant execute on function public.%I(%s)to %s%s;',p.proname,pg_get_function_identity_arguments(p.oid),case when a.grantee=0 then 'public'else quote_ident(pg_get_userbyid(a.grantee))end,case when a.is_grantable then ' with grant option'else ''end)
 from functions p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a
 union all
 select 999,'footer','recovery_candidate','commit; -- Seeds, extensions, credentials, webhook, cron and Edge deployment are separate.'
)
select phase,kind,object_name,
 case when ddl~'(sb_secret_[A-Za-z0-9_-]{16,}|sk_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}|Bearer [A-Za-z0-9_.-]{30,})'
 then '-- BLOCKED: potential credential in schema definition; manual review required.'else ddl end as ddl
from rows order by phase,kind,object_name;
