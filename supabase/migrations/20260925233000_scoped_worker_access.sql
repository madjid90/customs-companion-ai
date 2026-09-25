-- REQ-01: short-lived, scoped credentials for external durable workers.
create table public.worker_access_tokens (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  token_sha256 text not null unique check (token_sha256 ~ '^[a-f0-9]{64}$'),
  scopes text[] not null check (cardinality(scopes)>0),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at>created_at)
);
create index worker_access_tokens_active_idx on public.worker_access_tokens(expires_at)
  where revoked_at is null;
alter table public.worker_access_tokens enable row level security;
revoke all on public.worker_access_tokens from public,anon,authenticated;
grant select,insert,update,delete on public.worker_access_tokens to service_role;
comment on table public.worker_access_tokens is 'Hashed, short-lived credentials for service workers; raw tokens are never stored.';
