begin;

create or replace function public.require_active_account()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare caller uuid := auth.uid(); begin
  if caller is null or not exists (select 1 from public.profiles where id=caller and not is_banned)
    or exists (select 1 from public.auth_signup_pending where user_id=caller) then
    raise exception 'You must be signed in to an active account.';
  end if;
  return caller;
end $$;
revoke all on function public.require_active_account() from public,anon,authenticated;

create table public.review_reports (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  reported_by_user_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check(reason in ('inappropriate','spam','fake','other')),
  notes text check(length(notes)<=2000), created_at timestamptz not null default now(),
  unique(review_id,reported_by_user_id)
);
create table public.comment_reports (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.review_comments(id) on delete cascade,
  review_id uuid not null references public.reviews(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  reported_by_user_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check(reason in ('inappropriate','spam','fake','other')),
  notes text check(length(notes)<=2000), created_at timestamptz not null default now(),
  unique(comment_id,reported_by_user_id)
);
create table public.post_reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  reported_by_user_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check(reason in ('inappropriate','spam','fake','other')),
  notes text check(length(notes)<=2000), created_at timestamptz not null default now(),
  unique(post_id,reported_by_user_id)
);
create table public.post_comment_reports (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.post_comments(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  reported_by_user_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check(reason in ('inappropriate','spam','fake','other')),
  notes text check(length(notes)<=2000), created_at timestamptz not null default now(),
  unique(comment_id,reported_by_user_id)
);
create table public.bug_reports (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check(type in ('bug','suggestion','other')),
  message text not null check(length(btrim(message)) between 1 and 2000),
  device_info text not null default '' check(length(device_info)<=256),
  status text not null default 'open' check(status in ('open','resolved')),
  created_at timestamptz not null default now()
);
-- Match the checked-in Appwrite function's default. Dashboard overrides, if
-- any, must still be checked before final cutover.
create table public.moderation_config (
  id boolean primary key default true check(id),
  review_report_threshold integer check(review_report_threshold between 2 and 100)
);
insert into public.moderation_config(id,review_report_threshold) values(true,3);
alter table public.moderation_config enable row level security;
revoke all on public.moderation_config from public,anon,authenticated;
grant all on public.moderation_config to service_role;

do $$ declare tab text; owner_column text; begin
  foreach tab in array array['review_reports','comment_reports','post_reports','post_comment_reports','bug_reports'] loop
    owner_column := case when tab='bug_reports' then 'user_id' else 'reported_by_user_id' end;
    execute format('alter table public.%I enable row level security',tab);
    execute format('revoke all on public.%I from public,anon,authenticated',tab);
    execute format('grant select on public.%I to authenticated',tab);
    execute format('grant all on public.%I to service_role',tab);
    execute format('create policy %I on public.%I for select to authenticated using (%I=(select auth.uid()) or (select public.is_admin()))',tab||' private read',tab,owner_column);
    execute format('create index %I on public.%I (created_at desc,id desc)',tab||'_page',tab);
  end loop;
end $$;

create or replace function public.report_queue_table(queue_kind text)
returns text language sql immutable set search_path = '' as $$
  select case queue_kind when 'review' then 'review_reports' when 'comment' then 'comment_reports'
    when 'post' then 'post_reports' when 'post_comment' then 'post_comment_reports'
    when 'bug' then 'bug_reports' when 'claim' then 'restaurant_claims' end;
$$;
revoke all on function public.report_queue_table(text) from public,anon,authenticated;

create or replace function public.submit_content_report(report_kind text,target_id uuid,
  report_reason text default 'inappropriate',report_notes text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare caller uuid := public.require_active_account(); parent uuid; restaurant uuid;
  tab text := public.report_queue_table(report_kind); inserted_count integer; threshold integer;
begin
  if tab is null or report_kind not in ('review','comment','post','post_comment') or target_id is null
    or report_reason is null or report_reason not in ('inappropriate','spam','fake','other')
    or length(coalesce(report_notes,''))>2000 then raise exception 'Invalid report.'; end if;
  if report_kind='review' then
    select restaurant_id into restaurant from public.reviews where id=target_id for update;
    if not found then raise exception 'Review not found.'; end if;
    insert into public.review_reports(review_id,restaurant_id,reported_by_user_id,reason,notes)
      values(target_id,restaurant,caller,report_reason,report_notes) on conflict(review_id,reported_by_user_id) do nothing;
    get diagnostics inserted_count = row_count;
    if inserted_count>0 then
      select review_report_threshold into threshold from public.moderation_config where id=true;
      if threshold is not null and (select count(*) from public.review_reports where review_id=target_id)>=threshold then
        update public.reviews set is_hidden=true where id=target_id;
      end if;
    end if;
  elsif report_kind='comment' then
    select c.review_id,r.restaurant_id into parent,restaurant from public.review_comments c
      join public.reviews r on r.id=c.review_id where c.id=target_id;
    if not found then raise exception 'Comment not found.'; end if;
    insert into public.comment_reports(comment_id,review_id,restaurant_id,reported_by_user_id,reason,notes)
      values(target_id,parent,restaurant,caller,report_reason,report_notes) on conflict(comment_id,reported_by_user_id) do nothing;
  elsif report_kind='post' then
    perform 1 from public.posts where id=target_id;
    if not found then raise exception 'Post not found.'; end if;
    insert into public.post_reports(post_id,reported_by_user_id,reason,notes)
      values(target_id,caller,report_reason,report_notes) on conflict(post_id,reported_by_user_id) do nothing;
  else
    select post_id into parent from public.post_comments where id=target_id;
    if not found then raise exception 'Comment not found.'; end if;
    insert into public.post_comment_reports(comment_id,post_id,reported_by_user_id,reason,notes)
      values(target_id,parent,caller,report_reason,report_notes) on conflict(comment_id,reported_by_user_id) do nothing;
  end if;
end $$;

create or replace function public.submit_bug_report(report_type text,report_message text,report_device_info text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare caller uuid := public.require_active_account(); begin
  if report_type is null or report_type not in ('bug','suggestion','other') or length(btrim(coalesce(report_message,'')))=0 then
    raise exception 'Please describe the problem before sending.';
  end if;
  insert into public.bug_reports(user_id,type,message,device_info)
    values(caller,report_type,left(btrim(report_message),2000),left(coalesce(report_device_info,''),256));
end $$;

alter table public.restaurant_claims
  add column contact_name text check(length(contact_name)<=100),
  add column contact_phone text check(length(contact_phone)<=50),
  add column contact_email text check(length(contact_email)<=320),
  add column claimant_role text check(claimant_role in ('owner','manager')),
  add column proof_note text check(length(proof_note)<=2000),
  add column reviewed_at timestamptz,
  add column reviewed_by uuid references public.profiles(id) on delete set null;
-- Permit a new attempt after rejection, without concurrent duplicate pending claims.
alter table public.restaurant_claims drop constraint restaurant_claims_restaurant_id_user_id_key;
create unique index claims_one_pending on public.restaurant_claims(restaurant_id,user_id) where status='pending';
revoke all on public.restaurant_claims from public,anon,authenticated;
grant select on public.restaurant_claims to authenticated;

create table public.restaurant_menus (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  menu jsonb not null default '[]'::jsonb check(jsonb_typeof(menu)='array'),
  updated_at timestamptz not null default now()
);
alter table public.restaurant_menus enable row level security;
revoke all on public.restaurant_menus from public,anon,authenticated;
grant select on public.restaurant_menus to anon,authenticated;
grant all on public.restaurant_menus to service_role;
create policy "owner menus readable" on public.restaurant_menus for select to anon,authenticated using(true);

create or replace function public.validate_restaurant_menu(menu_value jsonb)
returns void language plpgsql immutable set search_path = '' as $$
declare section jsonb; item jsonb; begin
  if menu_value is null or jsonb_typeof(menu_value)<>'array' then raise exception 'Invalid menu.'; end if;
  if jsonb_array_length(menu_value)>100 then raise exception 'Menu is too long.'; end if;
  for section in select value from jsonb_array_elements(menu_value) loop
    if jsonb_typeof(section)<>'object' or jsonb_typeof(section->'title') is distinct from 'string'
      or length(btrim(section->>'title')) not between 1 and 100
      or jsonb_typeof(section->'items') is distinct from 'array' then raise exception 'Invalid menu section.'; end if;
    if jsonb_array_length(section->'items')>200 then raise exception 'Menu section is too long.'; end if;
    for item in select value from jsonb_array_elements(section->'items') loop
      if jsonb_typeof(item)<>'string' or length(item#>>'{}') not between 1 and 240 then raise exception 'Invalid menu item.'; end if;
    end loop;
  end loop;
end $$;
revoke all on function public.validate_restaurant_menu(jsonb) from public,anon,authenticated;

create or replace function public.submit_restaurant_claim(claim_payload jsonb)
returns public.restaurant_claims language plpgsql security definer set search_path = '' as $$
declare caller uuid := public.require_active_account(); target uuid; result public.restaurant_claims;
  contact_name_value text; phone text; email text; claimant_role_value text; proof text;
begin
  if claim_payload is null or jsonb_typeof(claim_payload)<>'object' or exists(select 1 from jsonb_object_keys(claim_payload) k
    where k not in ('restaurant_id','contact_name','contact_phone','contact_email','claimant_role','proof_note')) then raise exception 'Invalid claim.'; end if;
  if exists(select 1 from jsonb_each(claim_payload) e where jsonb_typeof(e.value)<>'string'
    and not (e.key='proof_note' and e.value='null'::jsonb)) then raise exception 'Invalid claim.'; end if;
  target := (claim_payload->>'restaurant_id')::uuid;
  contact_name_value := btrim(claim_payload->>'contact_name'); phone := btrim(claim_payload->>'contact_phone');
  email := lower(btrim(claim_payload->>'contact_email')); claimant_role_value := claim_payload->>'claimant_role';
  proof := nullif(btrim(claim_payload->>'proof_note'),'');
  if contact_name_value is null or length(contact_name_value) not between 2 and 100
    or phone is null or length(phone)>50 or length(regexp_replace(phone,'\D','','g'))<7
    or email is null or length(email)>320 or email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or claimant_role_value is null or claimant_role_value not in ('owner','manager') or length(coalesce(proof,''))>2000 then
    raise exception 'Check your contact details and restaurant role.';
  end if;
  perform 1 from public.restaurants where id=target and is_active and owner_id is null for update;
  if not found then raise exception 'Restaurant is unavailable or already claimed.'; end if;
  insert into public.restaurant_claims(restaurant_id,user_id,contact_name,contact_phone,contact_email,claimant_role,proof_note)
    values(target,caller,contact_name_value,phone,email,claimant_role_value,proof)
    on conflict(restaurant_id,user_id) where status='pending' do nothing returning * into result;
  if result.id is null then select * into result from public.restaurant_claims where restaurant_id=target and user_id=caller and status='pending'; end if;
  return result;
end $$;

create or replace function public.admin_review_claim(claim_id uuid,decision text)
returns void language plpgsql security definer set search_path = '' as $$
declare claim public.restaurant_claims; restaurant public.restaurants; begin
  if not public.is_admin() then raise exception 'Admin access required.'; end if;
  if decision is null or decision not in ('approved','rejected') then raise exception 'Invalid claim decision.'; end if;
  select * into claim from public.restaurant_claims where id=claim_id for update;
  if not found then raise exception 'Claim not found.'; end if;
  if claim.status::text=decision then return; end if;
  if claim.status<>'pending' then raise exception 'This claim was already reviewed.'; end if;
  if decision='approved' then
    if not exists(select 1 from public.profiles where id=claim.user_id and not is_banned)
      or exists(select 1 from public.auth_signup_pending where user_id=claim.user_id) then raise exception 'Claimant account is not active.'; end if;
    select * into restaurant from public.restaurants where id=claim.restaurant_id for update;
    if not found then raise exception 'Restaurant not found.'; end if;
    if restaurant.owner_id is not null and restaurant.owner_id<>claim.user_id then raise exception 'Restaurant already has another owner.'; end if;
    update public.restaurants set owner_id=claim.user_id,
      listing_paid_until=greatest(coalesce(listing_paid_until,now()),now()+interval '30 days') where id=claim.restaurant_id;
    insert into public.restaurant_menus(restaurant_id,owner_id) values(claim.restaurant_id,claim.user_id)
      on conflict(restaurant_id) do update set owner_id=excluded.owner_id;
  end if;
  update public.restaurant_claims set status=decision::public.claim_status,reviewed_at=now(),reviewed_by=auth.uid(),updated_at=now() where id=claim_id;
end $$;

create or replace function public.update_owner_restaurant_menu(target_restaurant uuid,menu_value jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare caller uuid := public.require_active_account(); begin
  perform public.validate_restaurant_menu(menu_value);
  perform 1 from public.restaurants where id=target_restaurant and owner_id=caller for update;
  if not found then raise exception 'Only the current restaurant owner can edit this menu.'; end if;
  update public.restaurant_menus set menu=menu_value,updated_at=now() where restaurant_id=target_restaurant;
  if not found then raise exception 'Menu editing is not set up yet. Please contact an admin.'; end if;
end $$;

create or replace function public.admin_queue_page(queue_kind text,after_id uuid default null,
  page_size integer default 50,filter_status text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare tab text := public.report_queue_table(queue_kind); after_created timestamptz; rows jsonb; predicate text := 'true'; begin
  if not public.is_admin() then raise exception 'Admin access required.'; end if;
  if tab is null or page_size is null or page_size not between 1 and 100 then raise exception 'Invalid queue or page size.'; end if;
  if filter_status is not null then
    if queue_kind<>'claim' or filter_status not in ('pending','approved','rejected') then raise exception 'Invalid queue status.'; end if;
    predicate := format('status::text=%L',filter_status);
  end if;
  if after_id is not null then
    execute format('select created_at from public.%I where id=$1',tab) into after_created using after_id;
    if after_created is null then raise exception 'Invalid queue cursor. Refresh the list.'; end if;
  end if;
  execute format('select coalesce(jsonb_agg(to_jsonb(p)),''[]''::jsonb) from (select * from public.%I where %s and ($1 is null or (created_at,id)<($2,$1)) order by created_at desc,id desc limit $3) p',tab,predicate)
    into rows using after_id,after_created,page_size+1;
  return rows;
end $$;

create or replace function public.admin_dismiss_report(queue_kind text,report_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare tab text := public.report_queue_table(queue_kind); begin
  if not public.is_admin() then raise exception 'Admin access required.'; end if;
  if tab is null or queue_kind='claim' or report_id is null then raise exception 'Invalid report.'; end if;
  execute format('delete from public.%I where id=$1',tab) using report_id;
end $$;

create or replace function public.admin_bug_report_status(report_id uuid,new_status text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Admin access required.'; end if;
  if new_status is null or new_status not in ('open','resolved') then raise exception 'Invalid report status.'; end if;
  update public.bug_reports set status=new_status where id=report_id;
  if not found then raise exception 'Report not found.'; end if;
end $$;

create or replace function public.admin_dashboard_stats()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Admin access required.'; end if;
  return jsonb_build_object('restaurantsTotal',(select count(*) from public.restaurants),
    'restaurantsActive',(select count(*) from public.restaurants where is_active),
    'restaurantsPending',(select count(*) from public.restaurants where not is_active),
    'reviews',(select count(*) from public.reviews),'users',(select count(*) from public.public_profiles),
    'reports',(select count(*) from public.review_reports),'commentReports',(select count(*) from public.comment_reports),
    'postReports',(select count(*) from public.post_reports),'postCommentReports',(select count(*) from public.post_comment_reports),
    'claims',(select count(*) from public.restaurant_claims where status='pending'));
end $$;

create or replace function public.admin_moderate_content(content_kind text,target_id uuid,moderation_action text)
returns void language plpgsql security definer set search_path = '' as $$
declare tab text; affected integer; begin
  if not public.is_admin() then raise exception 'Admin access required.'; end if;
  tab := case content_kind when 'review' then 'reviews' when 'comment' then 'review_comments'
    when 'post' then 'posts' when 'post_comment' then 'post_comments' end;
  if tab is null or target_id is null or moderation_action is null then raise exception 'Invalid moderation action.'; end if;
  if content_kind='review' and moderation_action in ('hide','restore') then
    update public.reviews set is_hidden=(moderation_action='hide') where id=target_id;
    get diagnostics affected=row_count;
  elsif moderation_action='delete' then
    execute format('delete from public.%I where id=$1',tab) using target_id;
    get diagnostics affected=row_count;
  else raise exception 'Invalid moderation action.'; end if;
  if affected=0 then raise exception 'Content not found.'; end if;
end $$;

revoke all on function public.submit_content_report(text,uuid,text,text),public.submit_bug_report(text,text,text),
  public.submit_restaurant_claim(jsonb),public.admin_review_claim(uuid,text),public.update_owner_restaurant_menu(uuid,jsonb),
  public.admin_queue_page(text,uuid,integer,text),public.admin_dismiss_report(text,uuid),
  public.admin_bug_report_status(uuid,text),public.admin_dashboard_stats(),
  public.admin_moderate_content(text,uuid,text) from public,anon;
grant execute on function public.submit_content_report(text,uuid,text,text),public.submit_bug_report(text,text,text),
  public.submit_restaurant_claim(jsonb),public.admin_review_claim(uuid,text),public.update_owner_restaurant_menu(uuid,jsonb),
  public.admin_queue_page(text,uuid,integer,text),public.admin_dismiss_report(text,uuid),
  public.admin_bug_report_status(uuid,text),public.admin_dashboard_stats(),
  public.admin_moderate_content(text,uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
