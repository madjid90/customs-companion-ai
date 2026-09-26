create or replace function private.guard_regulatory_measure_validation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.validation_status = 'validated' and old.validation_status is distinct from 'validated' then
    if new.validated_by is null or new.validated_at is null then
      raise exception 'Regulatory measure requires reviewer and timestamp';
    end if;
    if not exists (
      select 1 from public.legal_provisions p
      join public.legal_versions v on v.id = p.legal_version_id
      where p.id = new.legal_provision_id and p.review_status = 'validated' and v.status = 'published'
    ) then
      raise exception 'Regulatory measure requires a validated provision in a published legal version';
    end if;
    if new.hs_node_id is not null and not exists (
      select 1 from public.hs_nodes h
      join public.hs_nomenclatures n on n.id = h.nomenclature_id
      where h.id = new.hs_node_id and h.review_status = 'validated' and n.status = 'published'
    ) then
      raise exception 'Regulatory measure requires a validated SH node in a published nomenclature';
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_regulatory_measure_validation before update on public.regulatory_measures
for each row execute function private.guard_regulatory_measure_validation();

create or replace function private.guard_legal_relationship_validation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.validation_status = 'validated' and old.validation_status is distinct from 'validated' then
    if new.validated_by is null or new.validated_at is null then
      raise exception 'Legal relationship requires reviewer and timestamp';
    end if;
    if not exists (
      select 1 from public.legal_provisions p
      join public.legal_versions v on v.id = p.legal_version_id
      where p.id = new.evidence_provision_id and p.review_status = 'validated' and v.status = 'published'
    ) then
      raise exception 'Legal relationship requires a validated evidence provision in a published version';
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_legal_relationship_validation before update on public.legal_relationships
for each row execute function private.guard_legal_relationship_validation();
