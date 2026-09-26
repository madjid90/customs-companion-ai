-- Run candidate-only legal extraction online. This keeps development moving when
-- no external worker host is configured. The batch is intentionally small.

do $$
declare existing_job bigint;
begin
  for existing_job in select jobid from cron.job where jobname = 'douane-ai-online-legal-extraction' loop
    perform cron.unschedule(existing_job);
  end loop;
end $$;

select cron.schedule(
  'douane-ai-online-legal-extraction',
  '* * * * *',
  $$select public.run_online_legal_extraction_batch(10);$$
);
