-- Online legal extraction batch runner for environments where no external worker
-- is available. It writes candidate-only legal provisions and relationships and
-- never promotes them to canonical legal facts.

create or replace function private.legal_compact(input text)
returns text language sql immutable as $$
  select btrim(regexp_replace(coalesce(input,''), '[[:space:]]+', ' ', 'g'))
$$;

create or replace function private.legal_normalize_number(input text)
returns text language sql immutable as $$
  select case lower(private.legal_compact(input))
    when 'premier' then '1'
    when 'première' then '1'
    when 'premiere' then '1'
    else regexp_replace(lower(private.legal_compact(input)), '[[:space:]]+', '', 'g')
  end
$$;

create or replace function private.legal_sha256(input text)
returns text language sql immutable as $$
  select encode(pg_catalog.sha256(convert_to(coalesce(input,''), 'UTF8')), 'hex')
$$;

create or replace function private.legal_relationship_hint(context_text text)
returns text language sql immutable as $$
  select case
    when coalesce(context_text,'') ~* '\m(abroge|abrogée|abrogee|annule|supprime)\M' then 'repeals'
    when coalesce(context_text,'') ~* '\m(remplace|substitue)\M' then 'replaces'
    when coalesce(context_text,'') ~* '\m(modifie|modifiée|modifiee|rectifie|corrige)\M' then 'amends'
    when coalesce(context_text,'') ~* '\m(complète|complete|complétée|completee)\M' then 'complements'
    when coalesce(context_text,'') ~* '\m(application|applique)\M' then 'implements'
    when coalesce(context_text,'') ~* '\m(suspend|suspendu|proroge|prolonge)\M' then 'suspends'
    else 'mentions'
  end
$$;

create or replace function private.run_legal_extraction_batch(batch_size integer default 10)
returns table(processed integer, completed integer, failed integer, remaining integer)
language plpgsql security definer set search_path = '' as $$
declare
  worker_id text := 'online-legal-extractor';
  job public.ingestion_jobs%rowtype;
  run_id uuid;
  input_signature text;
  source_text text;
  line_row record;
  line_clean text;
  match text[];
  heading_type text;
  number_value text;
  heading_path text;
  prefix_path text;
  book_path text;
  title_path text;
  chapter_path text;
  section_path text;
  article_path text;
  paragraph_path text;
  article_number text;
  article_heading text;
  article_body text;
  article_page_start integer;
  article_page_end integer;
  article_source_page_id uuid;
  article_sequence integer;
  paragraph_number text;
  paragraph_body text;
  paragraph_page_start integer;
  paragraph_page_end integer;
  paragraph_source_page_id uuid;
  paragraph_sequence integer;
  sequence_counter integer;
  provision_count_value integer;
  article_count_value integer;
  relationship_count_value integer;
  quality_score_value numeric;
  inserted_count integer;
  ref_match text[];
  ref_index integer;
  ref_start integer;
  ref_context text;
  ref_type text;
  ref_raw text;
  ref_norm text;
  rel_type text;
  date_match text[];
begin
  processed := 0; completed := 0; failed := 0;

  for job in select * from public.claim_ingestion_jobs(worker_id, array['extract_legal'], greatest(1, least(coalesce(batch_size,10), 50))) loop
    processed := processed + 1;
    begin
      select private.legal_sha256(string_agg(p.page_number::text || ':' || p.text_sha256, '|' order by p.page_number))
      into input_signature
      from public.source_pages p
      where p.source_document_id = job.source_document_id and p.review_status <> 'rejected';

      select string_agg(p.text_content, E'\n' order by p.page_number)
      into source_text
      from public.source_pages p
      where p.source_document_id = job.source_document_id and p.review_status <> 'rejected';

      if input_signature is null or private.legal_compact(source_text) = '' then
        raise exception 'no_source_pages';
      end if;

      insert into public.legal_extraction_runs(source_document_id,pipeline_version_id,input_signature_sha256,status,metrics)
      values(job.source_document_id,'legal-structure-extractor-v1',input_signature,'review_required',jsonb_build_object('extraction_mode','postgres_online_hierarchy'))
      on conflict(source_document_id,pipeline_version_id,input_signature_sha256) do update
        set created_at = public.legal_extraction_runs.created_at
      returning id into run_id;

      select count(*) into inserted_count from public.legal_provision_candidates where extraction_run_id = run_id;
      if inserted_count = 0 then
        book_path := null; title_path := null; chapter_path := null; section_path := null;
        article_path := null; paragraph_path := null;
        article_body := null; paragraph_body := null; sequence_counter := 0;

        for line_row in
          select p.id as source_page_id, p.page_number, line.line_text, line.line_index
          from public.source_pages p
          cross join lateral regexp_split_to_table(p.text_content, E'\n') with ordinality as line(line_text,line_index)
          where p.source_document_id = job.source_document_id and p.review_status <> 'rejected'
          order by p.page_number, line.line_index
        loop
          line_clean := private.legal_compact(line_row.line_text);
          if line_clean = '' then continue; end if;

          heading_type := null; number_value := null;
          if line_clean ~* '^livre[[:space:]]+' then heading_type := 'book'; match := regexp_match(line_clean, '(?i)^livre[[:space:]]+([IVXLCDM]+|[0-9]+|premier|première|premiere)\M');
          elsif line_clean ~* '^titre[[:space:]]+' then heading_type := 'title'; match := regexp_match(line_clean, '(?i)^titre[[:space:]]+([IVXLCDM]+|[0-9]+|premier|première|premiere)\M');
          elsif line_clean ~* '^chapitre[[:space:]]+' then heading_type := 'chapter'; match := regexp_match(line_clean, '(?i)^chapitre[[:space:]]+([IVXLCDM]+|[0-9]+|premier|première|premiere)\M');
          elsif line_clean ~* '^section[[:space:]]+' then heading_type := 'section'; match := regexp_match(line_clean, '(?i)^section[[:space:]]+([IVXLCDM]+|[0-9]+|premier|première|premiere)\M');
          elsif line_clean ~* '^annexe\M' then heading_type := 'annex'; match := regexp_match(line_clean, '(?i)^annexe[[:space:]]*([A-Z0-9IVXLCDM-]+)?\M');
          elsif line_clean ~* '^(article|art\.)[[:space:]]+' then heading_type := 'article'; match := regexp_match(line_clean, '(?i)^(?:article|art\.)[[:space:]]+([0-9]+[[:space:]]*(?:bis|ter|quater)?|premier|première|premiere)\M');
          end if;

          if heading_type is not null and match is not null then
            if paragraph_path is not null then
              insert into public.legal_provision_candidates(extraction_run_id,source_document_id,source_page_id,provision_type,number,body_text,hierarchy_path,parent_hierarchy_path,sequence_number,page_start,page_end,extraction_confidence,evidence_sha256,metadata)
              values(run_id,job.source_document_id,paragraph_source_page_id,'paragraph',paragraph_number,private.legal_compact(paragraph_body),paragraph_path,article_path,paragraph_sequence,paragraph_page_start,paragraph_page_end,88,private.legal_sha256(paragraph_body),jsonb_build_object('extraction_mode','postgres_online_hierarchy'))
              on conflict(extraction_run_id,hierarchy_path) do nothing;
              paragraph_path := null; paragraph_body := null;
            end if;
            if article_path is not null then
              insert into public.legal_provision_candidates(extraction_run_id,source_document_id,source_page_id,provision_type,number,heading,body_text,hierarchy_path,parent_hierarchy_path,sequence_number,page_start,page_end,extraction_confidence,evidence_sha256,metadata)
              values(run_id,job.source_document_id,article_source_page_id,'article',article_number,article_heading,private.legal_compact(article_body),article_path,nullif(array_to_string(array_remove(array[book_path,title_path,chapter_path,section_path], null),'/'),''),article_sequence,article_page_start,article_page_end,94,private.legal_sha256(article_body),jsonb_build_object('extraction_mode','postgres_online_hierarchy'))
              on conflict(extraction_run_id,hierarchy_path) do nothing;
              article_path := null; article_body := null;
            end if;

            number_value := private.legal_normalize_number(match[1]);
            prefix_path := nullif(array_to_string(array_remove(array[book_path,title_path,chapter_path,section_path], null),'/'),'');

            if heading_type = 'book' then title_path := null; chapter_path := null; section_path := null; heading_path := 'book:' || number_value; book_path := heading_path;
            elsif heading_type = 'title' then chapter_path := null; section_path := null; heading_path := concat_ws('/', book_path, 'title:' || number_value); title_path := heading_path;
            elsif heading_type = 'chapter' then section_path := null; heading_path := concat_ws('/', book_path, title_path, 'chapter:' || number_value); chapter_path := heading_path;
            elsif heading_type = 'section' then heading_path := concat_ws('/', book_path, title_path, chapter_path, 'section:' || number_value); section_path := heading_path;
            elsif heading_type = 'annex' then heading_path := concat_ws('/', 'annex:' || coalesce(nullif(number_value,''),'unnumbered')); book_path := null; title_path := null; chapter_path := null; section_path := null;
            elsif heading_type = 'article' then
              article_number := number_value;
              article_heading := line_clean;
              article_path := concat_ws('/', prefix_path, 'article:' || article_number);
              article_body := line_clean;
              article_page_start := line_row.page_number;
              article_page_end := line_row.page_number;
              article_source_page_id := line_row.source_page_id;
              article_sequence := sequence_counter;
              sequence_counter := sequence_counter + 1;
              continue;
            end if;

            insert into public.legal_provision_candidates(extraction_run_id,source_document_id,source_page_id,provision_type,number,heading,body_text,hierarchy_path,parent_hierarchy_path,sequence_number,page_start,page_end,extraction_confidence,evidence_sha256,metadata)
            values(run_id,job.source_document_id,line_row.source_page_id,heading_type,number_value,line_clean,line_clean,heading_path,nullif(array_to_string(array_remove(array[case when heading_type <> 'book' then book_path end, case when heading_type not in ('book','title') then title_path end, case when heading_type not in ('book','title','chapter') then chapter_path end], null),'/'),''),sequence_counter,line_row.page_number,line_row.page_number,82,private.legal_sha256(line_clean),jsonb_build_object('extraction_mode','postgres_online_hierarchy'))
            on conflict(extraction_run_id,hierarchy_path) do nothing;
            sequence_counter := sequence_counter + 1;
            continue;
          end if;

          match := regexp_match(line_clean, '(?i)^(I{1,3}|IV|V|VI{0,3}|IX|X|[0-9]+|[a-z])[°\.)-][[:space:]]+(.+)$');
          if article_path is not null and match is not null then
            if paragraph_path is not null then
              insert into public.legal_provision_candidates(extraction_run_id,source_document_id,source_page_id,provision_type,number,body_text,hierarchy_path,parent_hierarchy_path,sequence_number,page_start,page_end,extraction_confidence,evidence_sha256,metadata)
              values(run_id,job.source_document_id,paragraph_source_page_id,'paragraph',paragraph_number,private.legal_compact(paragraph_body),paragraph_path,article_path,paragraph_sequence,paragraph_page_start,paragraph_page_end,88,private.legal_sha256(paragraph_body),jsonb_build_object('extraction_mode','postgres_online_hierarchy'))
              on conflict(extraction_run_id,hierarchy_path) do nothing;
            end if;
            paragraph_number := private.legal_normalize_number(match[1]);
            paragraph_path := article_path || '/paragraph:' || paragraph_number;
            paragraph_body := private.legal_compact(match[2]);
            paragraph_page_start := line_row.page_number;
            paragraph_page_end := line_row.page_number;
            paragraph_source_page_id := line_row.source_page_id;
            paragraph_sequence := sequence_counter;
            sequence_counter := sequence_counter + 1;
            article_body := article_body || E'\n' || line_clean;
            article_page_end := line_row.page_number;
            continue;
          end if;

          if article_path is not null then
            article_body := article_body || E'\n' || line_clean;
            article_page_end := line_row.page_number;
          end if;
          if paragraph_path is not null then
            paragraph_body := paragraph_body || E'\n' || line_clean;
            paragraph_page_end := line_row.page_number;
          end if;
        end loop;

        if paragraph_path is not null then
          insert into public.legal_provision_candidates(extraction_run_id,source_document_id,source_page_id,provision_type,number,body_text,hierarchy_path,parent_hierarchy_path,sequence_number,page_start,page_end,extraction_confidence,evidence_sha256,metadata)
          values(run_id,job.source_document_id,paragraph_source_page_id,'paragraph',paragraph_number,private.legal_compact(paragraph_body),paragraph_path,article_path,paragraph_sequence,paragraph_page_start,paragraph_page_end,88,private.legal_sha256(paragraph_body),jsonb_build_object('extraction_mode','postgres_online_hierarchy'))
          on conflict(extraction_run_id,hierarchy_path) do nothing;
        end if;
        if article_path is not null then
          insert into public.legal_provision_candidates(extraction_run_id,source_document_id,source_page_id,provision_type,number,heading,body_text,hierarchy_path,parent_hierarchy_path,sequence_number,page_start,page_end,extraction_confidence,evidence_sha256,metadata)
          values(run_id,job.source_document_id,article_source_page_id,'article',article_number,article_heading,private.legal_compact(article_body),article_path,nullif(array_to_string(array_remove(array[book_path,title_path,chapter_path,section_path], null),'/'),''),article_sequence,article_page_start,article_page_end,94,private.legal_sha256(article_body),jsonb_build_object('extraction_mode','postgres_online_hierarchy'))
          on conflict(extraction_run_id,hierarchy_path) do nothing;
        end if;

        ref_index := 0;
        for ref_match in select regexp_matches(source_text, '(?i)((circulaire|note)[[:space:]]*(n[°ºo]?[[:space:]]*)?([0-9]{3,6}[[:space:]]*/[[:space:]]*[0-9]{1,5}|[0-9]{4,6}))', 'g') loop
          ref_raw := private.legal_compact(ref_match[1]); ref_norm := regexp_replace(private.legal_compact(ref_match[4]), '[[:space:]]*/[[:space:]]*', '/', 'g'); ref_type := 'circular';
          ref_start := greatest(1, strpos(source_text, ref_match[1]) - 120); ref_context := substring(source_text from ref_start for 300); rel_type := private.legal_relationship_hint(ref_context); date_match := regexp_match(ref_context, '(?i)([0-9]{1,2}[[:space:]]+(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)[[:space:]]+[12][0-9]{3})');
          insert into public.legal_relationship_candidates(extraction_run_id,source_document_id,relationship_index,reference_type,reference_raw,reference_normalized,relationship_type,evidence_text,effective_date_text,confidence,evidence_sha256)
          values(run_id,job.source_document_id,ref_index,ref_type,ref_raw,ref_norm,rel_type,private.legal_compact(ref_context),case when date_match is null then null else private.legal_compact(date_match[1]) end,case when rel_type='mentions' then 62 else 78 end,private.legal_sha256(ref_context))
          on conflict(extraction_run_id,relationship_index) do nothing;
          ref_index := ref_index + 1;
        end loop;
        for ref_match in select regexp_matches(source_text, '(?i)((loi|décret|decret|arrêté|arrete|dahir)[[:space:]]*(n[°ºo]?[[:space:]]*)?([0-9]{1,4}[-/][0-9]{1,4}([-/][0-9]{1,4})?))', 'g') loop
          ref_raw := private.legal_compact(ref_match[1]); ref_norm := private.legal_compact(ref_match[4]); ref_type := 'legal_instrument';
          ref_start := greatest(1, strpos(source_text, ref_match[1]) - 120); ref_context := substring(source_text from ref_start for 300); rel_type := private.legal_relationship_hint(ref_context); date_match := regexp_match(ref_context, '(?i)([0-9]{1,2}[[:space:]]+(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)[[:space:]]+[12][0-9]{3})');
          insert into public.legal_relationship_candidates(extraction_run_id,source_document_id,relationship_index,reference_type,reference_raw,reference_normalized,relationship_type,evidence_text,effective_date_text,confidence,evidence_sha256)
          values(run_id,job.source_document_id,ref_index,ref_type,ref_raw,ref_norm,rel_type,private.legal_compact(ref_context),case when date_match is null then null else private.legal_compact(date_match[1]) end,case when rel_type='mentions' then 62 else 78 end,private.legal_sha256(ref_context))
          on conflict(extraction_run_id,relationship_index) do nothing;
          ref_index := ref_index + 1;
        end loop;
      end if;

      select count(*), count(*) filter (where provision_type='article') into provision_count_value, article_count_value from public.legal_provision_candidates where extraction_run_id=run_id;
      select count(*) into relationship_count_value from public.legal_relationship_candidates where extraction_run_id=run_id;
      quality_score_value := case when provision_count_value = 0 then 0 when article_count_value = 0 then 55 else 85 end;
      update public.legal_extraction_runs set
        status = case when provision_count_value = 0 then 'rejected' when article_count_value = 0 then 'review_required' else 'completed' end,
        provision_count = provision_count_value,
        article_count = article_count_value,
        relationship_count = relationship_count_value,
        quality_score = quality_score_value,
        metrics = jsonb_build_object('extraction_mode','postgres_online_hierarchy','provisions',provision_count_value,'articles',article_count_value,'relationships',relationship_count_value)
      where id = run_id;

      perform public.complete_ingestion_job(job.id, worker_id, jsonb_build_object('legal_extraction_run_id',run_id,'status',(select status from public.legal_extraction_runs where id=run_id),'provision_count',provision_count_value,'article_count',article_count_value,'relationship_count',relationship_count_value,'quality_score',quality_score_value));
      completed := completed + 1;
    exception when others then
      perform public.fail_ingestion_job(job.id, worker_id, left(sqlstate,120), left(sqlerrm,2000));
      failed := failed + 1;
    end;
  end loop;

  select count(*) into remaining from public.ingestion_jobs where job_type='extract_legal' and status in ('queued','retry_wait');
  return next;
end;
$$;

revoke all on function private.legal_compact(text) from public,anon,authenticated;
revoke all on function private.legal_normalize_number(text) from public,anon,authenticated;
revoke all on function private.legal_sha256(text) from public,anon,authenticated;
revoke all on function private.legal_relationship_hint(text) from public,anon,authenticated;
revoke all on function private.run_legal_extraction_batch(integer) from public,anon,authenticated;
grant execute on function private.run_legal_extraction_batch(integer) to service_role;
