-- Run 30-day history cleanup once daily at midnight in Manila.
create extension if not exists pg_cron with schema pg_catalog;
do $$
declare job record;
begin
  for job in select jobid from cron.job where jobname = 'admin-history-daily-cleanup' loop
    perform cron.unschedule(job.jobid);
  end loop;
end $$;
select cron.schedule(
  'admin-history-daily-cleanup',
  '0 16 * * *',
  $$select public.delete_expired_admin_history();$$
);
