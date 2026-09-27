-- Controlled legal promotion staging.
-- This creates auditable batches of extraction runs that are candidates for canonical promotion.
-- It does not insert into legal_instruments, legal_versions, legal_provisions or legal_relationships.

create table if not exists public.legal_promotion_batches (
  id uuid primary key default gen_random_uuid(),
  batch_name text not null,
  promotion_mode text not null check (promotion_mode in ('article_sample','circular_context_sample','mixed_sample')),
  status text not null default 'draft' check (status in ('draft','ready','promoted','rejected','superseded')),
  selection_criteria jsonb not null default '{}'::jsonb check (jsonb_typeof(selection_criteria) = 'object'),
  metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(metrics) = 'object'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.legal_promotion_batch_runs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.legal_promotion_batches(id) on delete cascade,
  extraction_run_id uuid not null references public.legal_extraction_runs(id) on delete restrict,
  source_document_id uuid not null references public.source_documents(id) on delete restrict,
  selection_bucket text not null,
  provision_count integer not null check (provision_count >= 0),
  article_count integer not null check (article_count >= 0),
  relationship_count integer not null check (relationship_count >= 0),
  fallback_count integer not null check (fallback_count >= 0),
  strong_article_count integer not null check (strong_article_count >= 0),
  strong_relationship_count integer not null check (strong_relationship_count >= 0),
  quality_score numeric(5,2) check (quality_score between 0 and 100),
  review_status text not null default 'queued' check (review_status in ('queued','accepted','rejected','needs_fix')),
  created_at timestamptz not null default now(),
  unique (batch_id, extraction_run_id)
);

create index if not exists legal_promotion_batches_status_idx on public.legal_promotion_batches(status, created_at desc);
create index if not exists legal_promotion_batch_runs_batch_idx on public.legal_promotion_batch_runs(batch_id, review_status, quality_score desc);
create index if not exists legal_promotion_batch_runs_run_idx on public.legal_promotion_batch_runs(extraction_run_id);

alter table public.legal_promotion_batches enable row level security;
alter table public.legal_promotion_batch_runs enable row level security;

revoke all on public.legal_promotion_batches, public.legal_promotion_batch_runs from public, anon;
grant select, insert, update, delete on public.legal_promotion_batches, public.legal_promotion_batch_runs to authenticated, service_role;

drop policy if exists legal_promotion_batches_admin_select on public.legal_promotion_batches;
drop policy if exists legal_promotion_batches_admin_insert on public.legal_promotion_batches;
drop policy if exists legal_promotion_batches_admin_update on public.legal_promotion_batches;
drop policy if exists legal_promotion_batches_admin_delete on public.legal_promotion_batches;
drop policy if exists legal_promotion_batch_runs_admin_select on public.legal_promotion_batch_runs;
drop policy if exists legal_promotion_batch_runs_admin_insert on public.legal_promotion_batch_runs;
drop policy if exists legal_promotion_batch_runs_admin_update on public.legal_promotion_batch_runs;
drop policy if exists legal_promotion_batch_runs_admin_delete on public.legal_promotion_batch_runs;

create policy legal_promotion_batches_admin_select on public.legal_promotion_batches for select to authenticated using ((select private.is_platform_admin()));
create policy legal_promotion_batches_admin_insert on public.legal_promotion_batches for insert to authenticated with check ((select private.is_platform_admin()));
create policy legal_promotion_batches_admin_update on public.legal_promotion_batches for update to authenticated using ((select private.is_platform_admin())) with check ((select private.is_platform_admin()));
create policy legal_promotion_batches_admin_delete on public.legal_promotion_batches for delete to authenticated using ((select private.is_platform_admin()));
create policy legal_promotion_batch_runs_admin_select on public.legal_promotion_batch_runs for select to authenticated using ((select private.is_platform_admin()));
create policy legal_promotion_batch_runs_admin_insert on public.legal_promotion_batch_runs for insert to authenticated with check ((select private.is_platform_admin()));
create policy legal_promotion_batch_runs_admin_update on public.legal_promotion_batch_runs for update to authenticated using ((select private.is_platform_admin())) with check ((select private.is_platform_admin()));
create policy legal_promotion_batch_runs_admin_delete on public.legal_promotion_batch_runs for delete to authenticated using ((select private.is_platform_admin()));

create or replace function private.refresh_legal_promotion_batch_metrics(target_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch_metrics jsonb;
begin
  select jsonb_build_object(
    'runs', count(*),
    'documents', count(distinct source_document_id),
    'provisions', coalesce(sum(provision_count), 0),
    'articles', coalesce(sum(article_count), 0),
    'relationships', coalesce(sum(relationship_count), 0),
    'fallback_candidates', coalesce(sum(fallback_count), 0),
    'strong_articles', coalesce(sum(strong_article_count), 0),
    'strong_relationships', coalesce(sum(strong_relationship_count), 0),
    'avg_quality_score', round(avg(quality_score)::numeric, 2),
    'selection_buckets', coalesce((
      select jsonb_object_agg(selection_bucket, bucket_count order by selection_bucket)
      from (
        select selection_bucket, count(*) as bucket_count
        from public.legal_promotion_batch_runs
        where batch_id = target_batch_id
        group by selection_bucket
      ) buckets
    ), '{}'::jsonb)
  ) into batch_metrics
  from public.legal_promotion_batch_runs
  where batch_id = target_batch_id;

  update public.legal_promotion_batches
  set metrics = coalesce(batch_metrics, '{}'::jsonb), updated_at = now()
  where id = target_batch_id;
end;
$$;

create or replace function public.create_legal_promotion_sample_batch(
  p_batch_name text default null,
  p_article_limit integer default 10,
  p_circular_limit integer default 20
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_batch_id uuid;
  safe_article_limit integer := greatest(0, least(coalesce(p_article_limit, 10), 50));
  safe_circular_limit integer := greatest(0, least(coalesce(p_circular_limit, 20), 100));
begin
  if (select auth.uid()) is null or not (select private.is_platform_admin()) then
    raise exception 'admin_required' using errcode = '42501';
  end if;

  insert into public.legal_promotion_batches(batch_name, promotion_mode, status, selection_criteria, created_by)
  values(
    coalesce(nullif(btrim(p_batch_name), ''), 'legal-promotion-sample-' || to_char(now(), 'YYYYMMDD-HH24MISS')),
    'mixed_sample',
    'ready',
    jsonb_build_object(
      'article_limit', safe_article_limit,
      'circular_limit', safe_circular_limit,
      'article_rule', 'completed runs with article candidates >= 90',
      'circular_rule', 'review_required fallback runs with >=10 fallback candidates and >=1 relationship',
      'publication_mode', 'staging_only_no_canonical_insert'
    ),
    (select auth.uid())
  ) returning id into new_batch_id;

  with scored as (
    select
      d.id as source_document_id,
      r.id as extraction_run_id,
      r.status as run_status,
      r.quality_score,
      r.provision_count,
      r.article_count,
      r.relationship_count,
      coalesce(p.fallback_count, 0)::integer as fallback_count,
      coalesce(p.strong_article_count, 0)::integer as strong_article_count,
      coalesce(rel.strong_relationship_count, 0)::integer as strong_relationship_count
    from public.legal_extraction_runs r
    join public.source_documents d on d.id = r.source_document_id
    left join lateral (
      select
        count(*) filter (where metadata->>'extraction_mode' = 'postgres_circular_fallback_v1') as fallback_count,
        count(*) filter (where provision_type = 'article' and extraction_confidence >= 90) as strong_article_count
      from public.legal_provision_candidates p
      where p.extraction_run_id = r.id
    ) p on true
    left join lateral (
      select count(*) filter (where confidence >= 75) as strong_relationship_count
      from public.legal_relationship_candidates rc
      where rc.extraction_run_id = r.id
    ) rel on true
  ), article_sample as (
    select *
    from scored
    where run_status = 'completed' and strong_article_count >= 1
    order by quality_score desc nulls last, strong_article_count desc, provision_count desc
    limit safe_article_limit
  ), circular_sample as (
    select *
    from scored
    where run_status = 'review_required'
      and fallback_count >= 10
      and relationship_count >= 1
      and extraction_run_id not in (select extraction_run_id from article_sample)
    order by quality_score desc nulls last, fallback_count desc, relationship_count desc
    limit safe_circular_limit
  ), selected as (
    select *, 'promotion_candidate_article_based'::text as selection_bucket from article_sample
    union all
    select *, 'review_candidate_circular_context'::text as selection_bucket from circular_sample
  )
  insert into public.legal_promotion_batch_runs(
    batch_id,
    extraction_run_id,
    source_document_id,
    selection_bucket,
    provision_count,
    article_count,
    relationship_count,
    fallback_count,
    strong_article_count,
    strong_relationship_count,
    quality_score
  )
  select
    new_batch_id,
    extraction_run_id,
    source_document_id,
    selection_bucket,
    provision_count,
    article_count,
    relationship_count,
    fallback_count,
    strong_article_count,
    strong_relationship_count,
    quality_score
  from selected;

  perform private.refresh_legal_promotion_batch_metrics(new_batch_id);

  if not exists (select 1 from public.legal_promotion_batch_runs where batch_id = new_batch_id) then
    update public.legal_promotion_batches
    set status = 'rejected', metrics = jsonb_build_object('runs', 0, 'reason', 'no_eligible_runs'), updated_at = now()
    where id = new_batch_id;
  end if;

  return new_batch_id;
end;
$$;

create or replace function public.get_legal_promotion_batch(target_batch_id uuid)
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
    'batch', row_to_json(b),
    'runs', coalesce((
      select jsonb_agg(row_to_json(run_row) order by selection_bucket, quality_score desc nulls last, provision_count desc)
      from (
        select
          br.id,
          br.extraction_run_id,
          br.source_document_id,
          d.title,
          d.official_reference,
          d.document_type,
          br.selection_bucket,
          br.provision_count,
          br.article_count,
          br.relationship_count,
          br.fallback_count,
          br.strong_article_count,
          br.strong_relationship_count,
          br.quality_score,
          br.review_status
        from public.legal_promotion_batch_runs br
        join public.source_documents d on d.id = br.source_document_id
        where br.batch_id = target_batch_id
      ) run_row
    ), '[]'::jsonb)
  ) into result
  from public.legal_promotion_batches b
  where b.id = target_batch_id;

  if result is null then
    raise exception 'batch_not_found' using errcode = 'P0002';
  end if;

  return result;
end;
$$;

revoke all on function private.refresh_legal_promotion_batch_metrics(uuid) from public, anon, authenticated;
revoke all on function public.create_legal_promotion_sample_batch(text, integer, integer) from public, anon, authenticated;
revoke all on function public.get_legal_promotion_batch(uuid) from public, anon, authenticated;
grant execute on function private.refresh_legal_promotion_batch_metrics(uuid) to service_role;
grant execute on function public.create_legal_promotion_sample_batch(text, integer, integer) to authenticated;
grant execute on function public.get_legal_promotion_batch(uuid) to authenticated;

comment on table public.legal_promotion_batches is 'Auditable staging batches for candidate legal promotion. Staging only; no canonical legal facts are inserted here.';
comment on table public.legal_promotion_batch_runs is 'Extraction runs selected for a legal promotion staging batch with benchmark metrics.';
comment on function public.create_legal_promotion_sample_batch(text, integer, integer) is 'Admin-only creation of a promotion sample batch from benchmarked legal extraction candidates. Does not publish canonical facts.';
comment on function public.get_legal_promotion_batch(uuid) is 'Admin-only read model for a legal promotion staging batch.';
