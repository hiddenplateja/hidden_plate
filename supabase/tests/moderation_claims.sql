-- Disposable auth/content fixtures only. All changes, notifications and queues
-- created by these tests are rolled back; no delivery function is invoked.
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,encrypted_password,raw_user_meta_data)
select ('f8000000-0000-4000-8000-00000000000'||n)::uuid,'authenticated','authenticated',
  'moderation-fixture-'||n||'@example.test',now(),'not-a-real-hash','{}'::jsonb
from generate_series(1,5) n;
delete from public.auth_signup_pending where user_id in
 ('f8000000-0000-4000-8000-000000000001','f8000000-0000-4000-8000-000000000002',
  'f8000000-0000-4000-8000-000000000003','f8000000-0000-4000-8000-000000000004');
update public.profiles set role='admin' where id='f8000000-0000-4000-8000-000000000001';
insert into public.restaurants(id,name,slug,address,parish,latitude,longitude,is_active)
values ('f8100000-0000-4000-8000-000000000001','Claim Fixture One','claim-fixture-one','Fixture Road','Kingston',18,-77,true),
 ('f8100000-0000-4000-8000-000000000002','Claim Fixture Two','claim-fixture-two','Fixture Road','Kingston',18,-77,true);
insert into public.reviews(id,restaurant_id,user_id,rating,comment) values
 ('f8200000-0000-4000-8000-000000000001','f8100000-0000-4000-8000-000000000001','f8000000-0000-4000-8000-000000000003',5,'Fixture review');
-- Existing interaction triggers require a caller even for privileged fixtures.
select set_config('request.jwt.claims','{"sub":"f8000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
insert into public.review_comments(id,review_id,user_id,text) values
 ('f8300000-0000-4000-8000-000000000001','f8200000-0000-4000-8000-000000000001','f8000000-0000-4000-8000-000000000003','Fixture comment');
insert into public.posts(id,user_id,text) values
 ('f8400000-0000-4000-8000-000000000001','f8000000-0000-4000-8000-000000000003','Fixture post');
insert into public.post_comments(id,post_id,user_id,text) values
 ('f8500000-0000-4000-8000-000000000001','f8400000-0000-4000-8000-000000000001','f8000000-0000-4000-8000-000000000003','Fixture post comment');
select set_config('request.jwt.claims','{"sub":"f8000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
do $$ declare first_claim uuid; duplicate_claim uuid; begin
  if has_table_privilege('authenticated','public.review_reports','INSERT')
    or has_table_privilege('authenticated','public.restaurant_claims','UPDATE')
    or has_table_privilege('authenticated','public.restaurant_claims','INSERT')
    or has_table_privilege('authenticated','public.restaurant_menus','UPDATE')
    or has_table_privilege('anon','public.review_reports','SELECT')
    or has_function_privilege('authenticated','public.require_active_account()','EXECUTE') then
    raise exception 'Unsafe direct grants'; end if;
  perform public.submit_content_report('review','f8200000-0000-4000-8000-000000000001','spam','Private note');
  perform public.submit_content_report('review','f8200000-0000-4000-8000-000000000001','spam','Duplicate');
  if (select count(*) from public.review_reports where review_id='f8200000-0000-4000-8000-000000000001')<>1 then
    raise exception 'Duplicate report counted'; end if;
  if (select is_hidden from public.reviews where id='f8200000-0000-4000-8000-000000000001') then raise exception 'Review hidden too soon'; end if;
  perform public.submit_content_report('comment','f8300000-0000-4000-8000-000000000001');
  if not exists(select 1 from public.comment_reports where comment_id='f8300000-0000-4000-8000-000000000001'
    and review_id='f8200000-0000-4000-8000-000000000001' and restaurant_id='f8100000-0000-4000-8000-000000000001'
    and reported_by_user_id=auth.uid()) then raise exception 'Comment parent/identity mismatch'; end if;
  perform public.submit_content_report('post','f8400000-0000-4000-8000-000000000001');
  perform public.submit_content_report('post_comment','f8500000-0000-4000-8000-000000000001');
  perform public.submit_bug_report('bug',' Fixture bug ','Fixture phone');
  if not exists(select 1 from public.bug_reports where user_id=auth.uid() and message='Fixture bug' and status='open') then raise exception 'Bug contract mismatch'; end if;
  begin perform public.submit_content_report('claim','f8200000-0000-4000-8000-000000000001');
    raise exception 'Unexpected report kind allowed'; exception when raise_exception then if sqlerrm<>'Invalid report.' then raise; end if; end;
  begin perform public.admin_dashboard_stats(); raise exception 'Member dashboard access';
    exception when raise_exception then if sqlerrm<>'Admin access required.' then raise; end if; end;
  begin perform public.admin_queue_page('review'); raise exception 'Member queue access';
    exception when raise_exception then if sqlerrm<>'Admin access required.' then raise; end if; end;
  begin perform public.admin_moderate_content('review','f8200000-0000-4000-8000-000000000001','hide'); raise exception 'Member moderation allowed';
    exception when raise_exception then if sqlerrm<>'Admin access required.' then raise; end if; end;
  begin perform public.admin_dismiss_report('review',gen_random_uuid()); raise exception 'Member dismissal allowed';
    exception when raise_exception then if sqlerrm<>'Admin access required.' then raise; end if; end;
  begin perform public.submit_restaurant_claim('{"restaurant_id":"f8100000-0000-4000-8000-000000000001","status":"approved"}');
    raise exception 'Forged claim status allowed'; exception when raise_exception then if sqlerrm<>'Invalid claim.' then raise; end if; end;
  select id into first_claim from public.submit_restaurant_claim('{"restaurant_id":"f8100000-0000-4000-8000-000000000001","contact_name":" Fixture Owner ","contact_phone":"8765551234","contact_email":"OWNER@EXAMPLE.TEST","claimant_role":"owner","proof_note":"Proof"}');
  select id into duplicate_claim from public.submit_restaurant_claim('{"restaurant_id":"f8100000-0000-4000-8000-000000000001","contact_name":"Fixture Owner","contact_phone":"8765551234","contact_email":"owner@example.test","claimant_role":"owner"}');
  if first_claim<>duplicate_claim then raise exception 'Duplicate pending claim'; end if;
  begin perform public.admin_review_claim(first_claim,'approved'); raise exception 'Member approved claim';
    exception when raise_exception then if sqlerrm<>'Admin access required.' then raise; end if; end;
end $$;
select set_config('request.jwt.claims','{"sub":"f8000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
do $$ begin
  if exists(select 1 from public.review_reports where reported_by_user_id<>'f8000000-0000-4000-8000-000000000003') then raise exception 'Private reports leaked'; end if;
  if exists(select 1 from public.restaurant_claims where user_id<>auth.uid()) then raise exception 'Private claims leaked'; end if;
  perform public.submit_content_report('review','f8200000-0000-4000-8000-000000000001');
  if (select is_hidden from public.reviews where id='f8200000-0000-4000-8000-000000000001') then raise exception 'Review hidden at two reports'; end if;
  perform public.submit_restaurant_claim('{"restaurant_id":"f8100000-0000-4000-8000-000000000001","contact_name":"Other Owner","contact_phone":"8765551234","contact_email":"other@example.test","claimant_role":"manager"}');
end $$;
select set_config('request.jwt.claims','{"sub":"f8000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select public.submit_content_report('review','f8200000-0000-4000-8000-000000000001');
reset role;
do $$ begin
  if not (select is_hidden from public.reviews where id='f8200000-0000-4000-8000-000000000001') then raise exception 'Three reports did not hide review'; end if;
  if (select review_count from public.restaurants where id='f8100000-0000-4000-8000-000000000001')<>0 then raise exception 'Hidden review counted in restaurant rating'; end if;
end $$;
-- Tied timestamps force use of the ID tie-breaker; fixtures sort above real rows.
update public.review_reports set created_at='2099-01-01' where review_id='f8200000-0000-4000-8000-000000000001';
insert into public.restaurant_menus(restaurant_id,owner_id,menu) values
 ('f8100000-0000-4000-8000-000000000001','f8000000-0000-4000-8000-000000000003','[{"title":"Mains","items":["Preserved dish"]}]');
select set_config('request.jwt.claims','{"sub":"f8000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$ declare claim_id uuid; conflicting_id uuid; bug_id uuid; page jsonb; cursor_id uuid; stats jsonb; begin
  page:=public.admin_queue_page('review',null,1);
  if jsonb_array_length(page)<>2 then raise exception 'Queue lookahead failed'; end if;
  cursor_id:=(page->0->>'id')::uuid;
  if (public.admin_queue_page('review',cursor_id,1)->0->>'id')<>(page->1->>'id') then raise exception 'Queue tie-breaker skipped row'; end if;
  select id into claim_id from public.restaurant_claims where restaurant_id='f8100000-0000-4000-8000-000000000001' and user_id='f8000000-0000-4000-8000-000000000002';
  select id into conflicting_id from public.restaurant_claims where restaurant_id='f8100000-0000-4000-8000-000000000001' and user_id='f8000000-0000-4000-8000-000000000003';
  perform public.admin_review_claim(claim_id,'approved'); perform public.admin_review_claim(claim_id,'approved');
  if not exists(select 1 from public.restaurants where id='f8100000-0000-4000-8000-000000000001'
    and owner_id='f8000000-0000-4000-8000-000000000002' and listing_paid_until>=now()+interval '30 days') then raise exception 'Claim ownership/grace missing'; end if;
  if not exists(select 1 from public.restaurant_claims where id=claim_id and status='approved' and reviewed_by=auth.uid() and reviewed_at is not null) then raise exception 'Claim approval metadata missing'; end if;
  if not exists(select 1 from public.restaurant_menus where restaurant_id='f8100000-0000-4000-8000-000000000001'
    and owner_id='f8000000-0000-4000-8000-000000000002' and menu->0->'items'->>0='Preserved dish') then raise exception 'Menu not preserved'; end if;
  begin perform public.admin_review_claim(conflicting_id,'approved'); raise exception 'Another owner replaced';
    exception when raise_exception then if sqlerrm<>'Restaurant already has another owner.' then raise; end if; end;
  if not exists(select 1 from public.restaurant_claims where id=conflicting_id and status='pending') then raise exception 'Failed approval partly committed'; end if;
  perform public.admin_review_claim(conflicting_id,'rejected');
  perform public.admin_moderate_content('review','f8200000-0000-4000-8000-000000000001','restore');
  if (select review_count from public.restaurants where id='f8100000-0000-4000-8000-000000000001')<>1 then raise exception 'Restored rating not recalculated'; end if;
  select id into bug_id from public.bug_reports where user_id='f8000000-0000-4000-8000-000000000002';
  perform public.admin_bug_report_status(bug_id,'resolved');
  if not exists(select 1 from public.bug_reports where id=bug_id and status='resolved') then raise exception 'Bug status failed'; end if;
  stats:=public.admin_dashboard_stats();
  if not stats ?& array['restaurantsTotal','restaurantsActive','restaurantsPending','reviews','users','reports','commentReports','postReports','postCommentReports','claims'] then raise exception 'Incomplete stats'; end if;
  perform public.admin_moderate_content('post_comment','f8500000-0000-4000-8000-000000000001','delete');
  if exists(select 1 from public.post_comment_reports where comment_id='f8500000-0000-4000-8000-000000000001') then raise exception 'Orphan report after content deletion'; end if;
  perform public.admin_dismiss_report('bug',bug_id);
end $$;
select set_config('request.jwt.claims','{"sub":"f8000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select public.update_owner_restaurant_menu('f8100000-0000-4000-8000-000000000001','[{"title":"Mains","items":["Updated dish"]}]');
do $$ begin
  begin perform public.update_owner_restaurant_menu('f8100000-0000-4000-8000-000000000001','[{"title":"Mains","items":[42]}]'); raise exception 'Invalid menu accepted';
    exception when raise_exception then if sqlerrm<>'Invalid menu item.' then raise; end if; end;
end $$;
select set_config('request.jwt.claims','{"sub":"f8000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
do $$ begin
  begin perform public.update_owner_restaurant_menu('f8100000-0000-4000-8000-000000000001','[]'); raise exception 'Wrong owner edited menu';
    exception when raise_exception then if sqlerrm<>'Only the current restaurant owner can edit this menu.' then raise; end if; end;
end $$;
reset role;
update public.profiles set is_banned=true where id='f8000000-0000-4000-8000-000000000004';
select set_config('request.jwt.claims','{"sub":"f8000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
do $$ begin
  begin perform public.submit_content_report('post','f8400000-0000-4000-8000-000000000001'); raise exception 'Banned user reported';
    exception when raise_exception then if sqlerrm<>'You must be signed in to an active account.' then raise; end if; end;
end $$;
select set_config('request.jwt.claims','{"sub":"f8000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
do $$ begin
  begin perform public.submit_bug_report('bug','Pending signup'); raise exception 'Pending signup submitted';
    exception when raise_exception then if sqlerrm<>'You must be signed in to an active account.' then raise; end if; end;
end $$;
reset role;
rollback;
select 'moderation/claims permission and transaction tests passed; all fixtures rolled back' as result;
