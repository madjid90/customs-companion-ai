drop policy hs_nodes_read on public.hs_nodes;
create policy hs_nodes_read on public.hs_nodes for select to authenticated
using (
  (select private.is_platform_admin())
  or (
    review_status = 'validated'
    and exists (
      select 1 from public.hs_nomenclatures n
      where n.id = nomenclature_id and n.status in ('published', 'superseded')
    )
  )
);
