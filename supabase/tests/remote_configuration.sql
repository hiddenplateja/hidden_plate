-- After migration 24. All configuration edits and synthetic profiles roll back.
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,encrypted_password,raw_user_meta_data)
select ('fc240000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated',
 'config-fixture-'||n||'@example.test',now(),'not-a-real-hash','{}'::jsonb from generate_series(1,4)n;
delete from public.auth_signup_pending where user_id::text like 'fc240000-%'and user_id<>'fc240000-0000-4000-8000-000000000004';
update public.profiles set preferences='{"notificationsEnabled":false}',
 role=case when id='fc240000-0000-4000-8000-000000000001'then 'admin'::public.app_role else 'user'::public.app_role end,
 is_banned=(id='fc240000-0000-4000-8000-000000000003')where id::text like 'fc240000-%';
create function pg_temp.must_fail(statement text,expected text)returns void language plpgsql as $$declare denied boolean:=false;begin
 begin execute statement;exception when others then if position(expected in sqlerrm)=0 then raise;end if;denied:=true;end;
 if not denied then raise exception 'Expected denial: %',statement;end if;
end $$;

set local role anon;
do $$declare config jsonb;begin
 config:=public.public_app_configuration();
 if not config?'control'or not config?'feature_plans'or not config?'listing_plans'then raise exception 'Public config contract failed';end if;
 if config?'profiles'or config?'plate_image_path'or(config->'control')?'updated_at'then raise exception 'Public projection leaked fields';end if;
 perform pg_temp.must_fail($q$select public.admin_patch_app_control('{"maintenance":true}')$q$,'permission denied');
 perform pg_temp.must_fail($q$select public.admin_patch_display_plans('{}')$q$,'permission denied');
 perform pg_temp.must_fail('truncate public.app_control','permission denied');
 perform pg_temp.must_fail('truncate public.app_config','permission denied');
 perform pg_temp.must_fail('update public.app_control set maintenance=true','permission denied');
end $$;
reset role;

select set_config('request.jwt.claims','{"sub":"fc240000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$declare p jsonb;q jsonb;begin
 p:=public.admin_patch_app_control('{"maintenance":true,"maintenance_message":"Fixture maintenance","min_version":"2.0","latest_version":"3.1.0","ios_url":"https://apps.apple.com/test","android_url":"https://play.google.com/test"}');
 if p->>'maintenance'<>'true'or p->>'maintenance_message'<>'Fixture maintenance'then raise exception 'Admin control write failed';end if;
 q:=public.admin_patch_app_control('{"maintenance":false}');
 if q->>'maintenance'<>'false'or q->>'min_version'<>'2.0'then raise exception 'Control partial patch lost fields';end if;
 perform pg_temp.must_fail($q$select public.admin_patch_app_control('{"maintenance":null}')$q$,'Invalid maintenance');
 perform pg_temp.must_fail($q$select public.admin_patch_app_control('{"id":false}')$q$,'Invalid app control field');
 perform pg_temp.must_fail($q$select public.admin_patch_app_control('{"min_version":"2.beta"}')$q$,'Invalid app version');
 perform pg_temp.must_fail($q$select public.admin_patch_app_control('{"android_url":"javascript:bad"}')$q$,'Invalid store URL');
 perform pg_temp.must_fail(format('select public.admin_patch_app_control(%L::jsonb)',jsonb_build_object('update_message',repeat('x',501))::text),'message too long');
 p:=public.admin_patch_display_plans('{"feature_plans":[{"id":"14d","label":"14 days","days":14,"amount":100,"currency":"JMD","productId":"feature_14d"}],"listing_plans":[{"id":"2yr","label":"2 years","days":730,"amount":9000,"currency":"JMD","productId":"listing_2yr"}]}');
 if p->'feature_plans'->0->>'days'<>'14'or p->'listing_plans'->0->>'days'<>'730'then raise exception 'Catalog write failed';end if;
 q:=public.admin_patch_display_plans('{"feature_plans":null}');
 if q->'feature_plans'<>'null'::jsonb or q->'listing_plans'<>p->'listing_plans'then raise exception 'Catalog partial/reset contract failed';end if;
 perform public.admin_patch_display_plans('{"feature_plans":[]}');
 perform pg_temp.must_fail($q$select public.admin_patch_display_plans('{"spot_date":"2026-01-01"}')$q$,'Invalid plan catalog field');
 perform pg_temp.must_fail($q$select public.admin_patch_display_plans('{"feature_plans":{}}')$q$,'Invalid plan catalog');
 perform pg_temp.must_fail($q$select public.admin_patch_display_plans('{"feature_plans":[{"id":"bad","label":"Bad","days":1.5,"amount":100,"currency":"JMD"}]}')$q$,'Invalid plan duration');
 perform pg_temp.must_fail($q$select public.admin_patch_display_plans('{"listing_plans":[{"id":"bad","label":"Bad","days":1,"amount":100,"currency":"JMD"}]}')$q$,'Listing product is required');
 perform pg_temp.must_fail($q$select public.admin_patch_display_plans('{"listing_plans":[{"id":"bad","label":"Bad","days":1,"amount":100,"currency":"JMD","productId":"feature_7d"}]}')$q$,'both feature and listing');
 perform pg_temp.must_fail($q$select public.admin_patch_display_plans('{"feature_plans":[{"id":"a","label":"A","days":1,"amount":0,"currency":"JMD"},{"id":"a","label":"A","days":1,"amount":0,"currency":"JMD"}]}')$q$,'Duplicate plan');
 perform pg_temp.must_fail('update public.app_config set feature_plans=null','permission denied');
 perform pg_temp.must_fail('truncate public.app_config','permission denied');
end $$;
reset role;

do $$declare uid text;expected text;begin
 foreach uid in array array['fc240000-0000-4000-8000-000000000002','fc240000-0000-4000-8000-000000000003','fc240000-0000-4000-8000-000000000004','fc240000-0000-4000-8000-999999999999']loop
  perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true);execute 'set local role authenticated';
  expected:=case when uid='fc240000-0000-4000-8000-000000000002'then 'Admin access required'else 'active account'end;
  perform pg_temp.must_fail($q$select public.admin_patch_app_control('{"maintenance":true}')$q$,expected);
  perform pg_temp.must_fail($q$select public.admin_patch_display_plans('{}')$q$,expected);
  perform pg_temp.must_fail('update public.app_control set maintenance=true','permission denied');
  perform public.public_app_configuration();
  execute 'reset role';
 end loop;
end $$;
select set_config('request.jwt.claims','{}',true);
set local role anon;
do $$declare config jsonb;begin
 config:=public.public_app_configuration();
 if config->'control'->>'maintenance'<>'false'or config->'control'->>'min_version'<>'2.0'
  or config->'listing_plans'->0->>'days'<>'730'then raise exception 'Pre-auth reads lost config';end if;
end $$;
reset role;
select 'Remote configuration: public reads, active-admin patches, validation and direct-write/TRUNCATE denial passed (rolled back)'as result;
rollback;
