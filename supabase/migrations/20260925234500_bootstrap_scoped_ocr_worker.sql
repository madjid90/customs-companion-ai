-- Temporary bootstrap credential. Only its SHA-256 is stored; the raw token is
-- held outside the repository and this row expires automatically.
insert into public.worker_access_tokens(name,token_sha256,scopes,expires_at)
values (
  'local-ocr-bootstrap-20260925',
  '97a3dc566b82850a7ead92c9fe4afc54653bb29be1227f22a1004242a6d98c50',
  array['ocr_page'],
  now()+interval '6 hours'
);
