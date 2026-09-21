create or replace function public.ensure_my_organization()
returns table(organization_id uuid, role text, organization_name text, organization_slug text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  org_id uuid;
  org_slug text;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  return query
    select m.organization_id, m.role, o.name, o.slug
    from public.organization_members m
    join public.organizations o on o.id=m.organization_id
    where m.user_id=actor and m.status='active'
    order by m.created_at
    limit 1;
  if found then return; end if;
  org_slug := 'entreprise-' || replace(actor::text,'-','');
  insert into public.organizations(name,slug,organization_type,created_by)
  values('Mon entreprise',org_slug,'importer',actor)
  returning id into org_id;
  insert into public.organization_members(organization_id,user_id,role,status)
  values(org_id,actor,'owner','active');
  return query select org_id, 'owner'::text, 'Mon entreprise'::text, org_slug;
end;
$$;
revoke all on function public.ensure_my_organization() from public, anon;
grant execute on function public.ensure_my_organization() to authenticated;
