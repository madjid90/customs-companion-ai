-- The browser only calls these two administrative reporting RPCs directly.
-- Run them as the caller so their underlying RLS policies remain effective.
do $$
declare
  fn record;
begin
  for fn in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  loop
    execute format(
      'revoke execute on function %I.%I(%s) from authenticated',
      fn.nspname, fn.proname, fn.args
    );
  end loop;

  for fn in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('get_circulars_missing_chunks','get_legal_source_stats')
  loop
    execute format(
      'alter function %I.%I(%s) security invoker',
      fn.nspname, fn.proname, fn.args
    );
    execute format(
      'grant execute on function %I.%I(%s) to authenticated',
      fn.nspname, fn.proname, fn.args
    );
  end loop;
end $$;
