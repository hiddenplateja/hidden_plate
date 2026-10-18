-- After approved migration 27. Synthetic rows/HTTP queues roll back completely.
-- Never TRUNCATE a real table; only metadata checks test those privileges.
begin;
create table public.privilege_fixture_27(id integer primary key);
alter table public.privilege_fixture_27 enable row level security;
do $$declare r text;p text;begin
 foreach r in array array['anon','authenticated']loop
  foreach p in array array['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']loop
   if has_table_privilege(r,'public.privilege_fixture_27',p)then raise exception 'Unsafe postgres public table default';end if;
  end loop;
 end loop;
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,encrypted_password,raw_user_meta_data)
select ('fc270000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated',
 'permission-fixture-'||n||'@example.test',now(),'not-a-real-hash','{}'::jsonb from generate_series(1,2)n;
delete from public.auth_signup_pending where user_id::text like 'fc270000-%';
update public.profiles set preferences='{"notificationsEnabled":false}'where id::text like 'fc270000-%';
insert into public.notifications(id,user_id,actor_id,type,title,body,data)values
 ('fc271000-0000-4000-8000-000000000001','fc270000-0000-4000-8000-000000000001',null,'broadcast','Fixture','Fixture','{}'),
 ('fc271000-0000-4000-8000-000000000002','fc270000-0000-4000-8000-000000000002',null,'broadcast','Fixture','Fixture','{}');
create function pg_temp.must_fail(statement text,expected text)returns void language plpgsql as $$declare denied boolean:=false;begin
 begin execute statement;exception when others then if position(expected in sqlerrm)=0 then raise;end if;denied:=true;end;
 if not denied then raise exception 'Expected denial: %',statement;end if;
end $$;
select set_config('request.jwt.claims','{"sub":"fc270000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$declare changed integer;begin
 if(select count(*)from public.notifications where id::text like 'fc271000-%')<>1 then raise exception 'Inbox privacy failed';end if;
 update public.notifications set is_read=true where id='fc271000-0000-4000-8000-000000000001';get diagnostics changed=row_count;
 if changed<>1 then raise exception 'Owner mark-read denied';end if;
 perform pg_temp.must_fail($q$update public.notifications set body='tampered'where id='fc271000-0000-4000-8000-000000000001'$q$,'permission denied');
 delete from public.notifications where id='fc271000-0000-4000-8000-000000000002';get diagnostics changed=row_count;
 if changed<>0 then raise exception 'Other inbox deletion allowed';end if;
 delete from public.notifications where id='fc271000-0000-4000-8000-000000000001';get diagnostics changed=row_count;
 if changed<>1 then raise exception 'Owner inbox deletion denied';end if;
end $$;
reset role;
set local role anon;
do $$begin perform pg_temp.must_fail($q$delete from public.notifications where id='fc271000-0000-4000-8000-000000000002'$q$,'permission denied');end $$;
reset role;
select 'Ordinary table defaults and owner-only inbox read/mark/delete contracts passed (rolled back)'as result;
rollback;
