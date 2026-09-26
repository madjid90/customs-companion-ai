-- Controlled shutdown: return unfinished local validation work immediately.
update public.ingestion_jobs
set status='retry_wait',attempts=greatest(attempts-1,0),scheduled_at=now(),
    locked_at=null,locked_by=null,heartbeat_at=null,updated_at=now(),
    last_error_code='controlled_worker_shutdown',
    last_error_message='Local validation worker stopped before durable deployment'
where status='running' and locked_by like 'ocr-full-local-%';
