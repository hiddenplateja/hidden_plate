-- Disposable fixtures only. Single-connection checks; everything rolls back.
begin;
create function pg_temp.claim_payload(target uuid)returns jsonb language sql as $$
 select jsonb_build_object('restaurant_id',target,'contact_name','Fixture Owner',
 'contact_phone','8765551234','contact_email','claim@example.test','claimant_role','owner');
$$;
grant execute on function pg_temp.claim_payload(uuid)to authenticated;
insert into auth.users(id,email,email_confirmed_at,encrypted_password)values
 ('fa290000-0000-4000-8000-000000000001','claim-admin@example.test',now(),'fixture-hash'),
 ('fa290000-0000-4000-8000-000000000002','claim-a@example.test',now(),'fixture-hash'),
 ('fa290000-0000-4000-8000-000000000003','claim-b@example.test',now(),'fixture-hash');
delete from public.auth_signup_pending where user_id in('fa290000-0000-4000-8000-000000000001','fa290000-0000-4000-8000-000000000002','fa290000-0000-4000-8000-000000000003');
update public.profiles set role='admin'where id='fa290000-0000-4000-8000-000000000001';
insert into public.restaurants(id,name,slug,address,parish,latitude,longitude,is_active)values
 ('fa291000-0000-4000-8000-000000000001','Claim lifecycle','claim-lifecycle','Fixture Road','kingston',18,-77,true),
 ('fa291000-0000-4000-8000-000000000002','Other claim target','other-claim-target','Fixture Road','kingston',18,-77,true);
do $$begin
 if not exists(select 1 from pg_index where indexrelid='public.claims_one_pending'::regclass and indisunique and indpred is not null)then
  raise exception 'Missing concurrent pending-claim uniqueness protection';end if;
end $$;
select set_config('request.jwt.claims','{"sub":"fa290000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
do $$declare first_id uuid;again_id uuid;begin
 select id into first_id from public.submit_restaurant_claim(pg_temp.claim_payload('fa291000-0000-4000-8000-000000000001'));
 select id into again_id from public.submit_restaurant_claim(pg_temp.claim_payload('fa291000-0000-4000-8000-000000000001'));
 if first_id<>again_id or(select count(*)from public.restaurant_claims where restaurant_id='fa291000-0000-4000-8000-000000000001'and user_id=auth.uid()and status='pending')<>1 then
  raise exception 'Repeat submission created another pending claim';end if;
 perform public.submit_restaurant_claim(pg_temp.claim_payload('fa291000-0000-4000-8000-000000000002'));
end $$;
-- A different person can independently claim the same unclaimed restaurant.
select set_config('request.jwt.claims','{"sub":"fa290000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select public.submit_restaurant_claim(pg_temp.claim_payload('fa291000-0000-4000-8000-000000000001'));
select set_config('request.jwt.claims','{"sub":"fa290000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$declare target uuid;begin
 select id into target from public.restaurant_claims where restaurant_id='fa291000-0000-4000-8000-000000000001'and user_id='fa290000-0000-4000-8000-000000000002';
 perform public.admin_review_claim(target,'rejected');
end $$;
-- Rejection preserves history and opens exactly one new pending attempt.
select set_config('request.jwt.claims','{"sub":"fa290000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$declare next_id uuid;repeated_id uuid;begin
 select id into next_id from public.submit_restaurant_claim(pg_temp.claim_payload('fa291000-0000-4000-8000-000000000001'));
 select id into repeated_id from public.submit_restaurant_claim(pg_temp.claim_payload('fa291000-0000-4000-8000-000000000001'));
 if next_id<>repeated_id or(select count(*)from public.restaurant_claims where restaurant_id='fa291000-0000-4000-8000-000000000001'and user_id=auth.uid()and status='rejected')<>1
  or(select count(*)from public.restaurant_claims where restaurant_id='fa291000-0000-4000-8000-000000000001'and user_id=auth.uid()and status='pending')<>1 then raise exception 'Rejected claim retry contract failed';end if;
end $$;
select set_config('request.jwt.claims','{"sub":"fa290000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$declare target uuid;begin
 select id into target from public.restaurant_claims where restaurant_id='fa291000-0000-4000-8000-000000000001'and user_id='fa290000-0000-4000-8000-000000000002'and status='pending';
 perform public.admin_review_claim(target,'approved');
 if not exists(select 1 from public.restaurants where id='fa291000-0000-4000-8000-000000000001'and owner_id='fa290000-0000-4000-8000-000000000002')then raise exception 'Approval did not grant ownership';end if;
end $$;
-- Neither the successful owner nor another claimant can submit after ownership.
select set_config('request.jwt.claims','{"sub":"fa290000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$begin
 begin perform public.submit_restaurant_claim(pg_temp.claim_payload('fa291000-0000-4000-8000-000000000001'));raise exception 'Owner submitted another claim';
 exception when raise_exception then if sqlerrm<>'Restaurant is unavailable or already claimed.'then raise;end if;end;
end $$;
select set_config('request.jwt.claims','{"sub":"fa290000-0000-4000-8000-000000000003","role":"authenticated"}',true);
do $$begin
 begin perform public.submit_restaurant_claim(pg_temp.claim_payload('fa291000-0000-4000-8000-000000000001'));raise exception 'Another claimant submitted for an owned restaurant';
 exception when raise_exception then if sqlerrm<>'Restaurant is unavailable or already claimed.'then raise;end if;end;
end $$;
reset role;
rollback;
select 'claim lifecycle passed; all fixtures rolled back'as result;
