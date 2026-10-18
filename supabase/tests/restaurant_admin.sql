-- Rollback-only fixtures; no media or email requests are made.
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,encrypted_password,raw_user_meta_data)
select ('f9000000-0000-4000-8000-00000000000'||n)::uuid,'authenticated','authenticated',
 'restaurant-admin-fixture-'||n||'@example.test',now(),'not-a-real-hash','{}'::jsonb from generate_series(1,4) n;
delete from public.auth_signup_pending where user_id in
 ('f9000000-0000-4000-8000-000000000001','f9000000-0000-4000-8000-000000000002','f9000000-0000-4000-8000-000000000003');
update public.profiles set role='admin' where id='f9000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims','{"sub":"f9000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
do $$ declare r public.restaurants; begin
 if has_table_privilege('authenticated','public.restaurants','INSERT') or has_column_privilege('authenticated','public.restaurants','is_active','UPDATE')
   or has_table_privilege('authenticated','public.app_config','UPDATE') then raise exception 'Unsafe direct writes'; end if;
 begin perform public.admin_write_restaurant('{}'); raise exception 'Member admin write allowed';
   exception when raise_exception then if sqlerrm<>'Admin access required.' then raise; end if; end;
 begin perform public.admin_restaurant_page(); raise exception 'Member admin browse allowed';
   exception when raise_exception then if sqlerrm<>'Admin access required.' then raise; end if; end;
 begin perform public.admin_set_spot_of_day(null); raise exception 'Member spotlight allowed';
   exception when raise_exception then if sqlerrm<>'Admin access required.' then raise; end if; end;
 begin perform public.submit_restaurant('{"name":"Forged","is_active":true}'); raise exception 'Public publishing allowed';
   exception when raise_exception then if sqlerrm<>'Invalid restaurant field: is_active' then raise; end if; end;
 begin perform public.submit_restaurant('{"name":"Bad tags","address":"Road","parish":"kingston","latitude":18,"longitude":-77}'); raise exception 'Missing tags allowed';
   exception when raise_exception then if sqlerrm<>'Please pick at least one cuisine or category.' then raise; end if; end;
 begin perform public.submit_restaurant('{"name":"Wrong image","address":"Road","parish":"kingston","latitude":18,"longitude":-77,"cuisines":["jamaican"],"image_paths":["rest/f9000000-0000-4000-8000-000000000003/foreign.jpg"]}'); raise exception 'Foreign submission image allowed';
   exception when raise_exception then if sqlerrm<>'Invalid restaurant image.' then raise; end if; end;
 r:=public.submit_restaurant('{"name":" Admin Fixture Pending ","address":" Road ","parish":"kingston","latitude":18,"longitude":-77,"cuisines":[" Jamaican ","jamaican"],"categories":[],"image_paths":["rest/f9000000-0000-4000-8000-000000000002/photo.jpg"],"menu":null}');
 if r.is_active or r.is_verified or r.is_featured or r.owner_id is not null or r.review_count<>0 or r.added_by<>auth.uid()
   or r.name<>'Admin Fixture Pending' or r.cuisines<>array['jamaican'] or r.cover_image_path<>r.image_paths[1] then raise exception 'Submission defaults/normalization wrong'; end if;
end $$;
select set_config('request.jwt.claims','{"sub":"f9000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$ declare r public.restaurants; old_slug text; result jsonb; first_id uuid; begin
 r:=public.admin_write_restaurant('{"name":"Admin Fixture Active","address":"Road","parish":"st_andrew","latitude":18,"longitude":-77,"cuisines":["Jamaican"],"is_active":true,"is_verified":true,"is_featured":true,"instagram_handle":"@@fixture","opening_hours":{"mon":[{"open":"09:00","close":"22:00"}]},"menu":[{"title":"Mains","items":["Chicken"]}]}');
 old_slug:=r.slug;
 if not r.is_active or not r.is_verified or not r.is_featured or r.instagram_handle<>'fixture' then raise exception 'Admin flags/handle lost'; end if;
 r:=public.admin_write_restaurant('{"name":"Admin Fixture Renamed","city":null,"is_featured":false}',r.id);
 if r.slug<>old_slug or r.is_featured or r.name<>'Admin Fixture Renamed' or strpos(r.search_text,'renamed')=0 then raise exception 'Partial edit/search/slug wrong'; end if;
 begin perform public.admin_write_restaurant('{"owner_id":"f9000000-0000-4000-8000-000000000003"}',r.id); raise exception 'Generic ownership edit allowed';
   exception when raise_exception then if sqlerrm<>'Invalid restaurant field: owner_id' then raise; end if; end;
 begin perform public.admin_write_restaurant('{"average_rating":5}',r.id); raise exception 'Forged rating allowed';
   exception when raise_exception then if sqlerrm<>'Invalid restaurant field: average_rating' then raise; end if; end;
 begin perform public.admin_write_restaurant('{"parish":"invalid"}',r.id); raise exception 'Invalid parish allowed';
   exception when raise_exception then if sqlerrm<>'Check the restaurant name, address, parish and location.' then raise; end if; end;
 begin perform public.admin_write_restaurant('{"opening_hours":{"mon":[{"open":"bad","close":"22:00"}]}}',r.id); raise exception 'Invalid hours allowed';
   exception when raise_exception then if sqlerrm<>'Invalid opening hours.' then raise; end if; end;
 begin perform public.admin_set_restaurant_owner(r.id,'f9000000-0000-4000-8000-000000000004'); raise exception 'Pending owner accepted';
   exception when raise_exception then if sqlerrm<>'Owner account is not active.' then raise; end if; end;
 perform public.admin_set_restaurant_owner(r.id,'f9000000-0000-4000-8000-000000000002');
 perform public.admin_set_listing_expiry(r.id,'2099-01-01');
 if not exists(select 1 from public.restaurant_menus where restaurant_id=r.id and owner_id='f9000000-0000-4000-8000-000000000002') then raise exception 'Owner menu not seeded'; end if;
 perform public.admin_set_spot_of_day(r.id,'2026-10-07','rest/f9000000-0000-4000-8000-000000000001/plate.jpg');
 if not exists(select 1 from public.app_config where id and spot_of_day_restaurant_id=r.id and spot_date='2026-10-07' and plate_image_path is not null) then raise exception 'Spotlight fields missing'; end if;
 perform public.admin_set_spot_of_day(null,'2026-10-07','bad');
 if exists(select 1 from public.app_config where id and (spot_of_day_restaurant_id is not null or spot_date is not null or plate_image_path is not null)) then raise exception 'Clear pin left stale fields'; end if;
 result:=public.admin_restaurant_page('admin fixture','all',null,1);
 if (result->>'total')::integer<>2 or jsonb_array_length(result->'items')<>2 then raise exception 'Search/count/lookahead mismatch'; end if;
 first_id:=(result->'items'->0->>'id')::uuid;
 if (public.admin_restaurant_page('admin fixture','all',first_id,1)->'items'->0->>'id')<>(result->'items'->1->>'id') then raise exception 'Keyset page skipped row'; end if;
 if (public.admin_restaurant_page('%','all')->>'total')::integer<>0 then raise exception 'Search wildcard interpreted'; end if;
 if (public.admin_restaurant_page('admin fixture','pending')->>'total')::integer<>1 then raise exception 'Pending filter mismatch'; end if;
 if (public.admin_restaurant_page('admin fixture','all',null,25,true)->>'total')::integer<>1 then raise exception 'Claimed filter mismatch'; end if;
end $$;
select set_config('request.jwt.claims','{"sub":"f9000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$ declare restaurant_id uuid; begin
 select id into restaurant_id from public.restaurants where name='Admin Fixture Renamed';
 perform public.update_owner_restaurant_menu(restaurant_id,'[{"title":"Mains","items":["Owner dish"]}]');
 perform public.write_review(jsonb_build_object('restaurant_id',restaurant_id,'rating',4,'comment','Fixture review'));
end $$;
reset role;
update public.restaurants set created_at='2099-01-01',search_text='stale' where name like 'Admin Fixture%';
select set_config('request.jwt.claims','{"sub":"f9000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$ declare r public.restaurants; result jsonb; old_slug text; begin
 select * into r from public.restaurants where name='Admin Fixture Renamed'; old_slug:=r.slug;
 r:=public.admin_write_restaurant('{"description":"Updated"}',r.id);
 if r.review_count<>1 or r.average_rating<>4 or r.slug<>old_slug or r.owner_id<>'f9000000-0000-4000-8000-000000000002' then raise exception 'Admin edit overwrote derived fields'; end if;
 result:=public.admin_rebuild_restaurant_search();
 if (result->>'updated')::integer<1 then raise exception 'Search rebuild did not fix stale data'; end if;
 if (public.admin_rebuild_restaurant_search()->>'updated')::integer<>0 then raise exception 'Rebuild not idempotent'; end if;
 result:=public.admin_restaurant_page('admin fixture','all',null,1);
 if (public.admin_restaurant_page('admin fixture','all',(result->'items'->0->>'id')::uuid,1)->'items'->0->>'id')<>(result->'items'->1->>'id') then raise exception 'Tied date pagination failed'; end if;
 perform public.admin_set_restaurant_owner(r.id,'f9000000-0000-4000-8000-000000000003');
 if not exists(select 1 from public.restaurant_menus where restaurant_id=r.id and owner_id='f9000000-0000-4000-8000-000000000003' and menu->0->'items'->>0='Owner dish') then raise exception 'Ownership transfer lost menu'; end if;
 perform public.admin_write_restaurant('{"is_active":false}',r.id);
end $$;
select set_config('request.jwt.claims','{"sub":"f9000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$ begin
 if exists(select 1 from public.restaurants where name='Admin Fixture Renamed') then raise exception 'Old owner reads inactive listing'; end if;
end $$;
select set_config('request.jwt.claims','{"sub":"f9000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
do $$ declare target uuid; begin
 select id into target from public.restaurants where name='Admin Fixture Renamed';
 if target is null then raise exception 'Current owner cannot read inactive listing'; end if;
 perform public.update_owner_restaurant_menu(target,'[]');
end $$;
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true); set local role anon;
do $$ begin
 if exists(select 1 from public.restaurants where name like 'Admin Fixture%') then raise exception 'Anonymous inactive listing leaked'; end if;
 perform count(*) from public.app_config;
 if has_function_privilege('anon','public.admin_write_restaurant(jsonb,uuid)','EXECUTE') then raise exception 'Anonymous admin RPC'; end if;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"f9000000-0000-4000-8000-000000000001","role":"authenticated"}',true); set local role authenticated;
do $$ declare target uuid; begin
 select id into target from public.restaurants where name='Admin Fixture Renamed';
 perform public.admin_set_restaurant_owner(target,null);
 if exists(select 1 from public.restaurant_menus where restaurant_id=target) then raise exception 'Released menu remains'; end if;
 perform public.admin_write_restaurant('{"is_active":true}',target); perform public.admin_set_spot_of_day(target);
 perform public.admin_delete_restaurant(target);
 if exists(select 1 from public.reviews where restaurant_id=target) or exists(select 1 from public.app_config where spot_of_day_restaurant_id=target) then raise exception 'Delete cascade/config cleanup failed'; end if;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"f9000000-0000-4000-8000-000000000004","role":"authenticated"}',true); set local role authenticated;
do $$ begin
 begin perform public.submit_restaurant('{}'); raise exception 'Pending signup submission allowed';
   exception when raise_exception then if sqlerrm<>'You must be signed in to an active account.' then raise; end if; end;
end $$;
reset role;
update public.profiles set is_banned=true where id='f9000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims','{"sub":"f9000000-0000-4000-8000-000000000001","role":"authenticated"}',true); set local role authenticated;
do $$ begin
 begin perform public.admin_rebuild_restaurant_search(); raise exception 'Banned admin maintenance allowed';
   exception when raise_exception then if sqlerrm<>'Admin access required.' then raise; end if; end;
end $$;
reset role;
rollback;
select 'restaurant admin permissions, ownership, pagination and spotlight tests passed; fixtures rolled back' as result;
