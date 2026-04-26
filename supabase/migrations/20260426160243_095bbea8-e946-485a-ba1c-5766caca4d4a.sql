-- Table for user-saved chat responses (bookmarks)
CREATE TABLE public.saved_responses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  session_id TEXT,
  question TEXT,
  response TEXT NOT NULL,
  cited_circulars JSONB,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Prevent duplicates: a user can only save a given conversation answer once
CREATE UNIQUE INDEX saved_responses_user_conv_unique
  ON public.saved_responses (user_id, conversation_id)
  WHERE conversation_id IS NOT NULL;

CREATE INDEX saved_responses_user_created_idx
  ON public.saved_responses (user_id, created_at DESC);

ALTER TABLE public.saved_responses ENABLE ROW LEVEL SECURITY;

-- Users manage only their own saved responses
CREATE POLICY "Users can view their own saved responses"
  ON public.saved_responses FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own saved responses"
  ON public.saved_responses FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own saved responses"
  ON public.saved_responses FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own saved responses"
  ON public.saved_responses FOR DELETE
  USING (auth.uid() = user_id);

-- Admins can view everything for support
CREATE POLICY "Admins can view all saved responses"
  ON public.saved_responses FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- updated_at trigger (reuse existing function)
CREATE TRIGGER update_saved_responses_updated_at
  BEFORE UPDATE ON public.saved_responses
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();