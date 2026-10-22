-- Explicit operational activation, not an automatically replayed migration.
-- Requires migration 28, deployed/authenticated email functions, saved Resend
-- sender and signing secrets, and an approved Send Email hook activation.
begin;
do $$
begin
  if (select count(*) from vault.secrets
      where name in ('push_sender_url','push_sender_apikey')) <> 2 then
    raise exception 'Welcome dispatcher credentials are not configured.';
  end if;
end $$;
update public.welcome_email_settings set enabled=true where id=true;
select cron.schedule('hidden-plate-welcome-email-retries','* * * * *',
  'select public.dispatch_welcome_emails();');
select public.dispatch_welcome_emails();
commit;
