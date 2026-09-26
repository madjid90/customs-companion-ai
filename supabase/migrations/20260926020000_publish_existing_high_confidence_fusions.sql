-- Apply already measured decisions through the same guarded publication function.
do $$
declare candidate record;
begin
  for candidate in
    select d.id from public.page_fusion_decisions d
    join public.source_pages p on p.id=d.source_page_id
    join public.source_documents s on s.id=p.source_document_id
    where d.status='selected' and d.selected_score>=80
      and p.review_status<>'validated'
      and s.lifecycle_status not in ('published','rejected','superseded')
    order by d.created_at
  loop
    perform public.publish_selected_page_fusion(candidate.id,80);
  end loop;
end $$;
