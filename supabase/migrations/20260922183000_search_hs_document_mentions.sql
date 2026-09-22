-- Return short, access-controlled excerpts. This avoids transmitting entire
-- PDF pages to the browser for a ten-digit code search.
create function public.search_hs_document_mentions(search_code text, result_limit integer default 8)
returns table (
  source_page_id uuid,
  code text,
  title text,
  file_title text,
  document_type text,
  lifecycle_status text,
  storage_bucket text,
  storage_path text,
  page_number integer,
  excerpt text
)
language sql stable security invoker set search_path = '' as $$
  with per_document as (
    select distinct on (d.id)
      p.id as source_page_id, m.code,
      coalesce(d.metadata #>> '{auto_profile,heading}', d.title) as title,
      d.title as file_title, d.document_type, d.lifecycle_status,
      d.storage_bucket, d.storage_path, p.page_number,
      substring(p.text_content from greatest(1, strpos(p.text_content, m.code) - 120) for 450) as excerpt
    from public.source_page_hs_mentions m
    join public.source_pages p on p.id = m.source_page_id
    join public.source_documents d on d.id = p.source_document_id
    join public.regulatory_sources s on s.id = d.source_id
    where search_code ~ '^[0-9]{10}$' and m.code = search_code
      and p.review_status <> 'rejected'
      and d.lifecycle_status in ('extracted','quality_review','legal_review','published')
      and s.code = 'MA_MANUAL_CORPUS'
    order by d.id, p.page_number
  )
  select * from per_document
  order by case document_type when 'other' then 0 when 'circular' then 1 when 'agreement' then 2 else 3 end,
    file_title
  limit least(greatest(coalesce(result_limit,8),1),20);
$$;
revoke all on function public.search_hs_document_mentions(text,integer) from public, anon;
grant execute on function public.search_hs_document_mentions(text,integer) to authenticated, service_role;
