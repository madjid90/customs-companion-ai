-- Fix circular fallback repair to avoid helper execute privileges during line compaction/hash calculation.
-- Replaces the same candidate-only service function; no canonical legal facts are published.

create or replace function private.run_legal_circular_fallback_batch(batch_size integer default 50)
returns table(processed integer, repaired integer, unchanged integer, remaining integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target record;
  safe_batch integer := greatest(1, least(coalesce(batch_size, 50), 500));
  inserted_count integer;
  provision_count_value integer;
  article_count_value integer;
  relationship_count_value integer;
  quality_score_value numeric;
begin
  processed := 0;
  repaired := 0;
  unchanged := 0;

  for target in
    select
      r.id as run_id,
      r.source_document_id,
      r.relationship_count,
      d.document_type
    from public.legal_extraction_runs r
    join public.source_documents d on d.id = r.source_document_id
    where r.status = 'rejected'
      and r.provision_count = 0
      and d.document_type in ('circular','agreement','technical_control','instruction','procedure','authorization','origin_rule','tax_rule')
    order by r.relationship_count desc, r.created_at desc
    limit safe_batch
  loop
    processed := processed + 1;

    with lines as (
      select
        p.id as source_page_id,
        p.page_number,
        line.line_index::integer as line_index,
        btrim(regexp_replace(coalesce(line.line_text,''), '[[:space:]]+', ' ', 'g')) as line_clean
      from public.source_pages p
      cross join lateral regexp_split_to_table(coalesce(p.text_content, ''), E'\n') with ordinality as line(line_text, line_index)
      where p.source_document_id = target.source_document_id
        and p.review_status <> 'rejected'
    ), candidates as (
      select
        source_page_id,
        page_number,
        line_index,
        line_clean,
        case
          when line_clean ~* '^(objet|objet[[:space:]]*:|r[ée]f[ée]rences?|r[ée]f\.?|annexes?|pi[èe]ces[[:space:]]+jointes?|p\.?j\.?|base[[:space:]]+l[ée]gale|dispositions?|mesures?|proc[ée]dures?|modalit[ée]s?|champ[[:space:]]+d.?application|r[ée]gime|origine|tarif|droits?|taxes?)\M' then 'section'
          when line_clean ~* '^([IVXLCDM]+|[0-9]+|[A-Z])[\.)°-][[:space:]]+' then 'paragraph'
          else 'paragraph'
        end as provision_type,
        case
          when line_clean ~* '^(objet|objet[[:space:]]*:|r[ée]f[ée]rences?|r[ée]f\.?|annexes?|pi[èe]ces[[:space:]]+jointes?|p\.?j\.?)\M' then 74
          when line_clean ~* '\m(importation|exportation|douane|d[ée]claration|certificat|origine|autorisation|contr[ôo]le|interdit|soumis|subordonn[ée]|b[ée]n[ée]ficie|exon[ée]ration|droit|taxe|tarif|contingent|accord|circulaire|note|code[[:space:]]+des[[:space:]]+douanes|article)\M' then 70
          else 62
        end as confidence,
        case
          when line_clean ~* '^(objet|objet[[:space:]]*:|r[ée]f[ée]rences?|r[ée]f\.?|annexes?|pi[èe]ces[[:space:]]+jointes?|p\.?j\.?)\M' then 'explicit_heading'
          when line_clean ~* '^([IVXLCDM]+|[0-9]+|[A-Z])[\.)°-][[:space:]]+' then 'numbered_clause'
          when line_clean ~* '\m(importation|exportation|douane|d[ée]claration|certificat|origine|autorisation|contr[ôo]le|interdit|soumis|subordonn[ée]|b[ée]n[ée]ficie|exon[ée]ration|droit|taxe|tarif|contingent|accord|circulaire|note|code[[:space:]]+des[[:space:]]+douanes|article)\M' then 'regulatory_keyword'
          else 'long_legal_paragraph'
        end as candidate_reason
      from lines
      where length(line_clean) between 40 and 4000
        and (
          line_clean ~* '^(objet|objet[[:space:]]*:|r[ée]f[ée]rences?|r[ée]f\.?|annexes?|pi[èe]ces[[:space:]]+jointes?|p\.?j\.?|base[[:space:]]+l[ée]gale|dispositions?|mesures?|proc[ée]dures?|modalit[ée]s?|champ[[:space:]]+d.?application|r[ée]gime|origine|tarif|droits?|taxes?)\M'
          or line_clean ~* '^([IVXLCDM]+|[0-9]+|[A-Z])[\.)°-][[:space:]]+'
          or line_clean ~* '\m(importation|exportation|douane|d[ée]claration|certificat|origine|autorisation|contr[ôo]le|interdit|soumis|subordonn[ée]|b[ée]n[ée]ficie|exon[ée]ration|droit|taxe|tarif|contingent|accord|circulaire|note|code[[:space:]]+des[[:space:]]+douanes|article)\M'
          or length(line_clean) >= 140
        )
    ), ranked as (
      select
        *,
        row_number() over (order by page_number, line_index) as sequence_number
      from candidates
      limit 250
    ), inserted as (
      insert into public.legal_provision_candidates(
        extraction_run_id,
        source_document_id,
        source_page_id,
        provision_type,
        number,
        heading,
        body_text,
        hierarchy_path,
        parent_hierarchy_path,
        sequence_number,
        page_start,
        page_end,
        extraction_confidence,
        validation_status,
        publication_status,
        evidence_sha256,
        metadata
      )
      select
        target.run_id,
        target.source_document_id,
        source_page_id,
        provision_type,
        null,
        case when provision_type = 'section' then left(line_clean, 240) else null end,
        line_clean,
        'fallback:p' || page_number::text || ':l' || line_index::text,
        null,
        sequence_number::integer,
        page_number,
        page_number,
        confidence,
        'proposed',
        'candidate',
        encode(pg_catalog.sha256(convert_to(coalesce(line_clean,''), 'UTF8')), 'hex'),
        jsonb_build_object(
          'extraction_mode', 'postgres_circular_fallback_v1',
          'candidate_reason', candidate_reason,
          'document_type', target.document_type,
          'source', 'rejected_legal_run_repair'
        )
      from ranked
      on conflict(extraction_run_id, hierarchy_path) do nothing
      returning 1
    )
    select count(*) into inserted_count from inserted;

    select count(*), count(*) filter (where provision_type = 'article')
    into provision_count_value, article_count_value
    from public.legal_provision_candidates
    where extraction_run_id = target.run_id;

    select count(*) into relationship_count_value
    from public.legal_relationship_candidates
    where extraction_run_id = target.run_id;

    quality_score_value := case
      when provision_count_value >= 10 and relationship_count_value >= 1 then 70
      when provision_count_value >= 10 then 66
      when provision_count_value >= 3 and relationship_count_value >= 1 then 62
      when provision_count_value >= 3 then 58
      else 0
    end;

    update public.legal_extraction_runs
    set
      status = case when provision_count_value >= 3 then 'review_required' else 'rejected' end,
      provision_count = provision_count_value,
      article_count = article_count_value,
      relationship_count = relationship_count_value,
      quality_score = quality_score_value,
      metrics = coalesce(metrics, '{}'::jsonb) || jsonb_build_object(
        'fallback_extraction_mode', 'postgres_circular_fallback_v1',
        'fallback_inserted_candidates', inserted_count,
        'fallback_candidate_threshold', 'candidate_only_review_required_not_canonical',
        'provisions', provision_count_value,
        'articles', article_count_value,
        'relationships', relationship_count_value
      )
    where id = target.run_id;

    if provision_count_value >= 3 then
      repaired := repaired + 1;
    else
      unchanged := unchanged + 1;
    end if;
  end loop;

  select count(*) into remaining
  from public.legal_extraction_runs r
  join public.source_documents d on d.id = r.source_document_id
  where r.status = 'rejected'
    and r.provision_count = 0
    and d.document_type in ('circular','agreement','technical_control','instruction','procedure','authorization','origin_rule','tax_rule');

  return next;
end;
$$;

create or replace function public.repair_rejected_legal_extraction_batch(batch_size integer default 50)
returns table(processed integer, repaired integer, unchanged integer, remaining integer)
language sql
security definer
set search_path = ''
as $$
  select * from private.run_legal_circular_fallback_batch(batch_size)
$$;

revoke all on function private.run_legal_circular_fallback_batch(integer) from public, anon, authenticated;
revoke all on function public.repair_rejected_legal_extraction_batch(integer) from public, anon, authenticated;
grant execute on function private.run_legal_circular_fallback_batch(integer) to service_role;
grant execute on function public.repair_rejected_legal_extraction_batch(integer) to service_role;

comment on function public.repair_rejected_legal_extraction_batch(integer) is 'Service-only candidate repair for rejected legal circular/agreement extraction runs. Does not publish canonical legal facts.';
