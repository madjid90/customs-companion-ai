-- Service-only wrapper used by Supabase cron and server-side operators.
-- User roles cannot execute it.

create or replace function public.run_online_legal_extraction_batch(batch_size integer default 10)
returns table(processed integer, completed integer, failed integer, remaining integer)
language sql security definer set search_path = '' as $$
  select * from private.run_legal_extraction_batch(batch_size)
$$;

revoke all on function public.run_online_legal_extraction_batch(integer) from public,anon,authenticated;
grant execute on function public.run_online_legal_extraction_batch(integer) to service_role;
comment on function public.run_online_legal_extraction_batch(integer) is 'Service-only trigger for candidate legal extraction batches. Does not publish canonical legal facts.';
