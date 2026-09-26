-- REQ-01: recover work after a worker crash or controlled shutdown.
create or replace function public.recover_expired_ingestion_jobs(lease_timeout interval default interval '15 minutes')
returns integer language plpgsql security invoker set search_path=public,pg_temp as $$
declare recovered integer;
begin
  if lease_timeout < interval '1 minute' or lease_timeout > interval '2 hours' then
    raise exception 'invalid lease timeout';
  end if;
  update public.ingestion_jobs
  set status=case when attempts>=max_attempts then 'quarantined' else 'retry_wait' end,
      scheduled_at=case when attempts>=max_attempts then scheduled_at else now() end,
      locked_at=null,locked_by=null,heartbeat_at=null,updated_at=now(),
      last_error_code='worker_lease_expired',
      last_error_message='Worker stopped without completing the leased task'
  where status='running' and coalesce(heartbeat_at,locked_at,started_at,created_at)<now()-lease_timeout;
  get diagnostics recovered=row_count;
  return recovered;
end; $$;

revoke all on function public.recover_expired_ingestion_jobs(interval) from public,anon,authenticated;
grant execute on function public.recover_expired_ingestion_jobs(interval) to service_role;

create or replace function public.claim_ingestion_jobs(worker_id text, accepted_types text[], batch_size integer default 10)
returns setof public.ingestion_jobs
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if worker_id is null or length(worker_id) not between 3 and 120 or batch_size not between 1 and 50 then
    raise exception 'invalid worker claim';
  end if;
  perform public.recover_expired_ingestion_jobs(interval '15 minutes');
  return query
  with candidates as (
    select id from public.ingestion_jobs
    where status in ('queued','retry_wait') and scheduled_at<=now()
      and (accepted_types is null or job_type=any(accepted_types))
    order by priority desc,scheduled_at,created_at
    for update skip locked limit batch_size
  )
  update public.ingestion_jobs j set status='running',attempts=j.attempts+1,
    locked_at=now(),locked_by=worker_id,heartbeat_at=now(),
    started_at=coalesce(j.started_at,now()),updated_at=now()
  from candidates c where j.id=c.id returning j.*;
end; $$;

revoke all on function public.claim_ingestion_jobs(text,text[],integer) from public,anon,authenticated;
grant execute on function public.claim_ingestion_jobs(text,text[],integer) to service_role;

