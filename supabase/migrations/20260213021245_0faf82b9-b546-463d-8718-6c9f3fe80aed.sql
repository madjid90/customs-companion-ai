
-- =============================================
-- 1. ALERTS: Enable RLS + admin-only access
-- =============================================
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage alerts"
ON public.alerts
FOR ALL
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated users can read alerts"
ON public.alerts
FOR SELECT
USING (auth.uid() IS NOT NULL);

-- =============================================
-- 2. EMBEDDING_QUEUE: service-role only (no anon/user access)
-- =============================================
ALTER TABLE public.embedding_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage embedding_queue"
ON public.embedding_queue
FOR ALL
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- =============================================
-- 3. RATE_LIMITS: service-role only
-- =============================================
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only for rate_limits"
ON public.rate_limits
FOR ALL
USING (auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'admin'::app_role));

-- =============================================
-- 4. CLASSIFICATION_OPINIONS: public read, admin write
-- =============================================
ALTER TABLE public.classification_opinions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Classification opinions are publicly readable"
ON public.classification_opinions
FOR SELECT
USING (is_active = true);

CREATE POLICY "Admins can manage classification_opinions"
ON public.classification_opinions
FOR ALL
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
