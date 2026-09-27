-- Audited review workflow for canonical draft legal provisions.
-- Official source documents remain accepted; this audits whether extracted structured provisions are usable.

create table if not exists public.legal_provision_review_events (
  id uuid primary key default gen_random_uuid(),
  legal_provision_id uuid not null references public.legal_provisions(id) on delete cascade,
  legal_version_id uuid not null references public.legal_versions(id) on delete cascade,
  previous_status text,
  new_status text not null check (new_status in ('unreviewed','needs_review','validated','rejected')),
  reviewer_id uuid references auth.users(id) on delete set null,
  review_note text,
  review_reason text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists legal_provision_review_events_provision_idx
  on public.legal_provision_review_events(legal_provision_id, created_at desc);
create index if not exists legal_provision_review_events_version_idx
  on public.legal_provision_review_events(legal_version_id, new_status, created_at desc);

alter table public.legal_provision_review_events enable row level security;
revoke all on public.legal_provision_review_events from public, anon;
grant select, insert on public.legal_provision_review_events to authenticated, service_role;

drop policy if exists legal_provision_review_events_admin_select on public.legal_provision_review_events;
drop policy if exists legal_provision_review_events_admin_insert on public.legal_provision_review_events;
create policy legal_provision_review_events_admin_select on public.legal_provision_review_events for select to authenticated using ((select private.is_platform_admin()));
create policy legal_provision_review_events_admin_insert on public.legal_provision_review_events for insert to authenticated with check ((select private.is_platform_admin()));

create or replace function private.audit_legal_provision_review_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.legal_provision_review_events(
      legal_provision_id,
      legal_version_id,
      previous_status,
      new_status,
      reviewer_id,
      review_reason,
      metadata
    ) values (
      new.id,
      new.legal_version_id,
      null,
      new.review_status,
      null,
      'initial_status',
      jsonb_build_object('source', 'trigger', 'operation', tg_op)
    );
    return new;
  end if;

  if new.review_status is distinct from old.review_status then
    insert into public.legal_provision_review_events(
      legal_provision_id,
      legal_version_id,
      previous_status,
      new_status,
      reviewer_id,
      review_reason,
      metadata
    ) values (
      new.id,
      new.legal_version_id,
      old.review_status,
      new.review_status,
      (select auth.uid()),
      'status_changed',
      jsonb_build_object('source', 'trigger', 'operation', tg_op)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists audit_legal_provision_review_status_insert on public.legal_provisions;
drop trigger if exists audit_legal_provision_review_status_update on public.legal_provisions;
create trigger audit_legal_provision_review_status_insert
after insert on public.legal_provisions
for each row execute function private.audit_legal_provision_review_status();
create trigger audit_legal_provision_review_status_update
after update of review_status on public.legal_provisions
for each row execute function private.audit_legal_provision_review_status();

create or replace function public.review_legal_provision(
  target_provision_id uuid,
  target_status text,
  review_note text default null,
  review_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_status text;
  version_status text;
  provision_version_id uuid;
  result jsonb;
begin
  if (select auth.uid()) is null or not (select private.is_platform_admin()) then
    raise exception 'admin_required' using errcode = '42501';
  end if;

  if target_status not in ('needs_review','validated','rejected') then
    raise exception 'invalid_review_status' using errcode = '22023';
  end if;

  select p.review_status, p.legal_version_id, v.status
  into previous_status, provision_version_id, version_status
  from public.legal_provisions p
  join public.legal_versions v on v.id = p.legal_version_id
  where p.id = target_provision_id;

  if previous_status is null then
    raise exception 'provision_not_found' using errcode = 'P0002';
  end if;

  if version_status = 'published' then
    raise exception 'published_provision_review_is_immutable' using errcode = '22023';
  end if;

  update public.legal_provisions
  set review_status = target_status
  where id = target_provision_id;

  insert into public.legal_provision_review_events(
    legal_provision_id,
    legal_version_id,
    previous_status,
    new_status,
    reviewer_id,
    review_note,
    review_reason,
    metadata
  ) values (
    target_provision_id,
    provision_version_id,
    previous_status,
    target_status,
    (select auth.uid()),
    nullif(btrim(review_note), ''),
    coalesce(nullif(btrim(review_reason), ''), 'manual_admin_review'),
    jsonb_build_object('source', 'review_legal_provision_rpc')
  );

  result := jsonb_build_object(
    'legal_provision_id', target_provision_id,
    'previous_status', previous_status,
    'new_status', target_status,
    'publication_status', 'not_published_review_only'
  );

  return result;
end;
$$;

create or replace function public.get_legal_version_review_summary(target_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if (select auth.uid()) is null or not (select private.is_platform_admin()) then
    raise exception 'admin_required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'version', row_to_json(v),
    'instrument', row_to_json(i),
    'provisions_by_status', coalesce((
      select jsonb_object_agg(review_status, provision_count order by review_status)
      from (
        select review_status, count(*) as provision_count
        from public.legal_provisions
        where legal_version_id = target_version_id
        group by review_status
      ) statuses
    ), '{}'::jsonb),
    'provisions_by_type', coalesce((
      select jsonb_object_agg(provision_type, provision_count order by provision_type)
      from (
        select provision_type, count(*) as provision_count
        from public.legal_provisions
        where legal_version_id = target_version_id
        group by provision_type
      ) types
    ), '{}'::jsonb),
    'publication_blockers', coalesce((
      select jsonb_agg(blocker)
      from (
        select 'version_not_review'::text as blocker
        where v.status <> 'review'
        union all
        select 'unvalidated_provisions'::text
        where exists (
          select 1 from public.legal_provisions p
          where p.legal_version_id = target_version_id and p.review_status <> 'validated'
        )
        union all
        select 'source_document_not_published'::text
        where not exists (
          select 1 from public.source_documents d
          where d.id = v.source_document_id and d.lifecycle_status = 'published'
        )
      ) blockers
    ), '[]'::jsonb),
    'recent_events', coalesce((
      select jsonb_agg(row_to_json(event_row) order by created_at desc)
      from (
        select id, legal_provision_id, previous_status, new_status, reviewer_id, review_reason, review_note, created_at
        from public.legal_provision_review_events
        where legal_version_id = target_version_id
        order by created_at desc
        limit 25
      ) event_row
    ), '[]'::jsonb)
  ) into result
  from public.legal_versions v
  join public.legal_instruments i on i.id = v.instrument_id
  where v.id = target_version_id;

  if result is null then
    raise exception 'version_not_found' using errcode = 'P0002';
  end if;

  return result;
end;
$$;

revoke all on function private.audit_legal_provision_review_status() from public, anon, authenticated;
revoke all on function public.review_legal_provision(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.get_legal_version_review_summary(uuid) from public, anon, authenticated;
grant execute on function public.review_legal_provision(uuid, text, text, text) to authenticated;
grant execute on function public.get_legal_version_review_summary(uuid) to authenticated;

comment on table public.legal_provision_review_events is 'Audit trail for review decisions on structured legal provisions extracted from official documents.';
comment on function public.review_legal_provision(uuid, text, text, text) is 'Admin-only audited review action for draft legal provisions. Does not publish legal facts.';
comment on function public.get_legal_version_review_summary(uuid) is 'Admin-only review summary and publication blockers for a draft legal version.';
