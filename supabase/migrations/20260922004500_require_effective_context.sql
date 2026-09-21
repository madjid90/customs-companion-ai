create or replace function private.guard_regulatory_measure_validation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.validation_status = 'validated' and old.validation_status is distinct from 'validated' then
    if new.validated_by is null or new.validated_at is null then
      raise exception 'Regulatory measure requires reviewer and timestamp';
    end if;
    if new.effective_from is null then
      raise exception 'Regulatory measure requires a verified effective date';
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
    if new.hs_prefix is not null and not exists (
      select 1 from public.hs_nodes h
      join public.hs_nomenclatures n on n.id = h.nomenclature_id
      where h.code like new.hs_prefix || '%' and h.review_status = 'validated' and n.status = 'published'
    ) then
      raise exception 'Regulatory measure requires a matching code in a published nomenclature';
    end if;
  end if;
  return new;
end;
$$;
