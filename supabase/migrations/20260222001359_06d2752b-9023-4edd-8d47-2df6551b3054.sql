
-- Create a temp storage bucket for data imports
INSERT INTO storage.buckets (id, name, public) VALUES ('temp-imports', 'temp-imports', false)
ON CONFLICT (id) DO NOTHING;

-- Allow service role full access
CREATE POLICY "Service role access temp-imports" ON storage.objects
  FOR ALL TO service_role
  USING (bucket_id = 'temp-imports')
  WITH CHECK (bucket_id = 'temp-imports');
