-- ADII_CIRCULAR_PDFS points to a PDF directory/index, not a single PDF file.
-- It must use link extraction before individual assets are downloaded.

update public.source_catalog
set access_method = 'pdf_index',
    ingestion_strategy = 'crawl_and_extract',
    notes = coalesce(notes, '') || ' Connector corrected: directory/index requires PDF link extraction before download.',
    updated_at = now()
where source_code = 'ADII_CIRCULAR_PDFS'
  and official_url = 'https://www.douane.gov.ma/adil/PDF/';

update public.source_connector_configs c
set connector_type = 'pdf_link_extractor',
    pipeline_component = 'legal-structure-extractor',
    config = coalesce(c.config, '{}'::jsonb) || jsonb_build_object('corrected_from', 'direct_pdf_fetcher', 'reason', 'directory_index_not_single_pdf'),
    updated_at = now()
from public.source_catalog s
where c.source_catalog_id = s.id
  and s.source_code = 'ADII_CIRCULAR_PDFS';
