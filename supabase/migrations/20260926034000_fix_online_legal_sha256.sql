-- Supabase keeps pgcrypto digest() in the extensions schema on this project,
-- while online legal extraction uses an empty search_path for safety. Use the
-- pg_catalog SHA-256 primitive explicitly.

create or replace function private.legal_sha256(input text)
returns text language sql immutable as $$
  select encode(pg_catalog.sha256(convert_to(coalesce(input,''), 'UTF8')), 'hex')
$$;

update public.ingestion_jobs
set status='queued', locked_at=null, locked_by=null, heartbeat_at=null, scheduled_at=now(), last_error_code=null, last_error_message=null
where job_type='extract_legal' and status='retry_wait' and last_error_code='42883';
