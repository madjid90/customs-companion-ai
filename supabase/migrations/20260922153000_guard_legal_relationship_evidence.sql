create or replace function private.guard_legal_relationship_validation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.validation_status = 'validated' and old.validation_status is distinct from 'validated' then
    if new.validated_by is null or new.validated_at is null or new.effective_from is null then
      raise exception 'Legal relationship requires reviewer, timestamp, and verified effective date';
    end if;
    if new.evidence_provision_id is null or not exists (
      select 1 from public.legal_provisions p
      join public.legal_versions v on v.id = p.legal_version_id
      where p.id = new.evidence_provision_id
        and p.review_status = 'validated' and v.status = 'published'
        and v.instrument_id = new.source_instrument_id
    ) then
      raise exception 'Relationship evidence must be a validated provision of the published source instrument';
    end if;
    if not exists (
      select 1 from public.legal_versions v
      where v.instrument_id = new.target_instrument_id
        and v.status in ('published', 'superseded')
    ) then
      raise exception 'Target instrument must have a published or superseded version';
    end if;
  end if;
  return new;
end;
$$;
