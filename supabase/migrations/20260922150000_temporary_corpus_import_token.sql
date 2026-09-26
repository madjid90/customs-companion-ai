create table private.corpus_import_tokens (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  disabled_at timestamptz,
  purpose text not null,
  created_at timestamptz not null default now()
);
revoke all on private.corpus_import_tokens from public, anon, authenticated;

create or replace function public.verify_corpus_import_token(input_hash text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.corpus_import_tokens t
    where t.token_hash = input_hash
      and t.expires_at > now()
      and t.disabled_at is null
      and t.purpose = 'initial_local_corpus'
  );
$$;
revoke all on function public.verify_corpus_import_token(text) from public, anon, authenticated;
grant execute on function public.verify_corpus_import_token(text) to service_role;
