update public.worker_access_tokens
set revoked_at=now()
where name='full-ocr-campaign-20260926' and revoked_at is null;
