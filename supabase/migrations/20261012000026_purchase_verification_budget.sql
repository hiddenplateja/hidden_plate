-- Local only: approval required before applying. No payment activation.
begin;
create table public.purchase_verification_budgets(
 id text primary key,owner_id uuid unique references public.profiles(id)on delete cascade,
 window_started timestamptz not null,attempts integer not null check(attempts>=0),
 check((id='global'and owner_id is null)or(id=owner_id::text and owner_id is not null))
);
alter table public.purchase_verification_budgets enable row level security;
revoke all on public.purchase_verification_budgets from public,anon,authenticated;
grant all on public.purchase_verification_budgets to service_role;
create function public.take_purchase_verification_slot(buyer uuid)
returns boolean language plpgsql security definer set search_path=''as $$
declare stamp timestamptz;global_budget public.purchase_verification_budgets;user_budget public.purchase_verification_budgets;begin
 -- Invoked only by the authenticated Edge verifier with its network-checked JWT
 -- buyer, not an HTTP target user. Lock order: buyer then global/user budgets.
 perform 1 from public.profiles where id=buyer and not is_banned for share;
 if not found or exists(select 1 from public.auth_signup_pending where user_id=buyer)then raise exception 'Buyer needs an active account.';end if;
 stamp:=clock_timestamp();
 insert into public.purchase_verification_budgets(id,window_started,attempts)values('global',stamp,0)on conflict do nothing;
 select * into global_budget from public.purchase_verification_budgets where id='global'for update;
 insert into public.purchase_verification_budgets(id,owner_id,window_started,attempts)values(buyer::text,buyer,stamp,0)on conflict do nothing;
 select * into user_budget from public.purchase_verification_budgets where id=buyer::text for update;
 stamp:=clock_timestamp();
 if global_budget.window_started<=stamp-interval '1 minute'then global_budget.window_started:=stamp;global_budget.attempts:=0;end if;
 if user_budget.window_started<=stamp-interval '1 minute'then user_budget.window_started:=stamp;user_budget.attempts:=0;end if;
 -- Fixed windows, bounded across isolates: 30 project/5 buyer per minute.
 if global_budget.attempts>=30 or user_budget.attempts>=5 then return false;end if;
 update public.purchase_verification_budgets set window_started=global_budget.window_started,attempts=global_budget.attempts+1 where id='global';
 update public.purchase_verification_budgets set window_started=user_budget.window_started,attempts=user_budget.attempts+1 where id=buyer::text;
 return true;
end $$;
revoke all on function public.take_purchase_verification_slot(uuid)from public,anon,authenticated;
grant execute on function public.take_purchase_verification_slot(uuid)to service_role;
notify pgrst,'reload schema';
commit;
