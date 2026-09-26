-- Scoped credential for the first full OCR campaign. The raw token is never
-- stored in Git or Postgres. A follow-up migration revokes it after completion.
insert into public.worker_access_tokens(name,token_sha256,scopes,expires_at)
values (
  'full-ocr-campaign-20260926',
  '504e1c19fb30dea82551e28347914dd1c3dc0381235e641392f135af928bfb02',
  array['ocr_page'],
  now()+interval '36 hours'
);
