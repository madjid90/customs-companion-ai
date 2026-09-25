-- The bootstrap worker completed its validation batch. Revoke immediately rather
-- than relying only on expiry; a durable host will receive a separate token.
update public.worker_access_tokens
set revoked_at=now()
where name='local-ocr-bootstrap-20260925' and revoked_at is null;
