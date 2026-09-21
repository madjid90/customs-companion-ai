create or replace function public.promote_reviewed_hs_candidate(
  candidate_id uuid,
  target_nomenclature_id uuid
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  candidate public.hs_extraction_candidates%rowtype;
  nomenclature public.hs_nomenclatures%rowtype;
  node_id uuid;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'Platform administrator required';
  end if;
  select * into candidate from public.hs_extraction_candidates where id = candidate_id for update;
  if not found or candidate.review_status <> 'validated' then
    raise exception 'Candidate must be validated first';
  end if;
  if candidate.source_document_id is null or candidate.source_page_id is null then
    raise exception 'Candidate must be linked to a source PDF and page';
  end if;
  select * into nomenclature from public.hs_nomenclatures where id = target_nomenclature_id for update;
  if not found or nomenclature.status not in ('draft', 'review') then
    raise exception 'Target nomenclature must be a draft or in review';
  end if;
  if nomenclature.digits <> 10 or nomenclature.jurisdiction_code <> 'MA' then
    raise exception 'Candidate requires a Moroccan 10-digit nomenclature';
  end if;
  if exists (
    select 1 from public.hs_nodes n
    where n.nomenclature_id = target_nomenclature_id and n.code = candidate.code
      and n.description_official <> candidate.description_fragment
  ) then
    raise exception 'Conflicting reviewed descriptions for this SH code';
  end if;
  insert into public.hs_nodes (
    nomenclature_id, code, level, description_official, description_resolved,
    chapter_number, sequence_number, source_page, source_page_id,
    extraction_confidence, review_status
  ) values (
    target_nomenclature_id, candidate.code, 'national_line',
    candidate.description_fragment, candidate.description_fragment,
    candidate.chapter_number, candidate.page_number, candidate.page_number,
    candidate.source_page_id, candidate.confidence, 'validated'
  ) on conflict (nomenclature_id, code) do update set
    source_page_id = excluded.source_page_id,
    extraction_confidence = greatest(public.hs_nodes.extraction_confidence, excluded.extraction_confidence)
  returning id into node_id;
  return node_id;
end;
$$;
revoke all on function public.promote_reviewed_hs_candidate(uuid, uuid) from public;
grant execute on function public.promote_reviewed_hs_candidate(uuid, uuid) to authenticated;
