-- Table pour suivre les runs d'extraction batch (reprise possible)
CREATE TABLE public.pdf_extraction_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  pdf_id UUID NOT NULL REFERENCES public.pdf_documents(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'paused', 'done', 'error')),
  current_page INTEGER NOT NULL DEFAULT 1,
  total_pages INTEGER,
  processed_pages INTEGER NOT NULL DEFAULT 0,
  file_name VARCHAR(500),
  country_code VARCHAR(5) DEFAULT 'MA',
  -- Stats accumulées
  stats JSONB DEFAULT '{"tariff_lines_inserted": 0, "hs_codes_inserted": 0, "notes_inserted": 0, "pages_skipped": 0, "errors": []}'::jsonb,
  -- Configuration du batch
  batch_size INTEGER DEFAULT 4,
  last_error TEXT,
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Index pour lookup rapide par pdf_id et status
CREATE INDEX idx_pdf_extraction_runs_pdf_id ON public.pdf_extraction_runs(pdf_id);
CREATE INDEX idx_pdf_extraction_runs_status ON public.pdf_extraction_runs(status);

-- RLS: pas de restrictions (table admin)
ALTER TABLE public.pdf_extraction_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for pdf_extraction_runs" 
ON public.pdf_extraction_runs 
FOR ALL 
USING (true)
WITH CHECK (true);

-- Trigger pour updated_at
CREATE TRIGGER update_pdf_extraction_runs_updated_at
BEFORE UPDATE ON public.pdf_extraction_runs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();