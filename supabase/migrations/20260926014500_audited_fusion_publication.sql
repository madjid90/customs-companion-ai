-- REQ-02/REQ-06: atomically apply a high-confidence fusion decision while
-- retaining the previous canonical text and blocking unsafe replacement.
create table public.page_publication_revisions (
  id uuid primary key default gen_random_uuid(),
  source_page_id uuid not null references public.source_pages(id) on delete restrict,
  fusion_decision_id uuid not null unique references public.page_fusion_decisions(id) on delete restrict,
  previous_text text not null,
  previous_sha256 text not null check(previous_sha256 ~ '^[a-f0-9]{64}$'),
  published_text text not null,
  published_sha256 text not null check(published_sha256 ~ '^[a-f0-9]{64}$'),
  previous_extraction_method text not null,
  published_extraction_method text not null,
  confidence numeric(5,2) not null check(confidence between 0 and 100),
  created_at timestamptz not null default now(),
  check(previous_sha256<>published_sha256)
);
create index page_publication_revisions_page_idx on public.page_publication_revisions(source_page_id,created_at desc);
alter table public.page_publication_revisions enable row level security;
revoke all on public.page_publication_revisions from public,anon,authenticated;
grant select,insert on public.page_publication_revisions to service_role;

create or replace function public.publish_selected_page_fusion(target_decision_id uuid, minimum_score numeric default 80)
returns uuid language plpgsql security invoker set search_path=public,extensions,pg_temp as $$
declare d public.page_fusion_decisions%rowtype; p public.source_pages%rowtype; output public.page_engine_outputs%rowtype; document_status text; next_text text; next_method text;
begin
  if minimum_score<0 or minimum_score>100 then raise exception 'invalid minimum score'; end if;
  select * into d from public.page_fusion_decisions where id=target_decision_id for update;
  if not found or d.status<>'selected' or d.selected_score<minimum_score or d.selected_source in ('none','hybrid') then raise exception 'publishable selected decision required'; end if;
  select * into p from public.source_pages where id=d.source_page_id for update;
  if p.review_status='validated' then raise exception 'human validated page is immutable'; end if;
  select lifecycle_status into document_status from public.source_documents where id=p.source_document_id;
  if document_status in ('published','rejected','superseded') then raise exception 'document is immutable'; end if;
  if exists(select 1 from public.page_publication_revisions where fusion_decision_id=d.id) then return p.id; end if;
  if d.selected_source='native_pdf' then next_text:=p.text_content; next_method:='native_pdf';
  else
    select * into output from public.page_engine_outputs where id=d.selected_engine_output_id and source_page_id=p.id;
    if not found or output.output_sha256<>d.selected_text_sha256 or output.text_content is null then raise exception 'selected output evidence mismatch'; end if;
    next_text:=btrim(output.text_content); next_method:=case when d.selected_source='ocr' then 'ocr' else 'native_pdf' end;
  end if;
  if encode(digest(convert_to(next_text,'UTF8'),'sha256'),'hex')<>d.selected_text_sha256 then raise exception 'selected text hash mismatch'; end if;
  if p.text_sha256=d.selected_text_sha256 then return p.id; end if;
  insert into public.page_publication_revisions(source_page_id,fusion_decision_id,previous_text,previous_sha256,published_text,published_sha256,previous_extraction_method,published_extraction_method,confidence)
  values(p.id,d.id,p.text_content,p.text_sha256,next_text,d.selected_text_sha256,p.extraction_method,next_method,d.selected_score);
  update public.source_pages set text_content=next_text,text_sha256=d.selected_text_sha256,extraction_method=next_method,extraction_confidence=d.selected_score,
    review_status='needs_review',metadata=metadata||jsonb_build_object('fusion_decision_id',d.id,'automatic_fusion_at',now(),'automatic_fusion_version',d.algorithm_version),updated_at=now()
  where id=p.id;
  return p.id;
end; $$;
revoke all on function public.publish_selected_page_fusion(uuid,numeric) from public,anon,authenticated;
grant execute on function public.publish_selected_page_fusion(uuid,numeric) to service_role;

