-- ============================================================================
-- ACTION 5: CACHE SÉMANTIQUE - TTL, PURGE & MONITORING
-- ============================================================================

-- 1. Ajouter colonne last_hit_at
ALTER TABLE response_cache 
ADD COLUMN IF NOT EXISTS last_hit_at TIMESTAMPTZ DEFAULT NOW();

-- 2. Index pour purge efficace
CREATE INDEX IF NOT EXISTS idx_response_cache_expires 
ON response_cache(expires_at) 
WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_response_cache_last_hit 
ON response_cache(last_hit_at);

-- 3. Mettre à jour les entrées existantes
UPDATE response_cache
SET last_hit_at = COALESCE(updated_at, created_at)
WHERE last_hit_at IS NULL;

UPDATE response_cache
SET expires_at = created_at + INTERVAL '7 days'
WHERE expires_at IS NULL;

-- 4. Trigger pour définir expires_at automatiquement sur INSERT
CREATE OR REPLACE FUNCTION public.set_cache_expiry()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.expires_at := COALESCE(NEW.expires_at, NOW() + INTERVAL '7 days');
  NEW.last_hit_at := COALESCE(NEW.last_hit_at, NOW());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cache_expiry ON response_cache;
CREATE TRIGGER trg_cache_expiry
  BEFORE INSERT ON response_cache
  FOR EACH ROW EXECUTE FUNCTION public.set_cache_expiry();

-- 5. Fonction increment_cache_hit (remplace update_cache_hit)
CREATE OR REPLACE FUNCTION public.increment_cache_hit(cache_id UUID)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE response_cache
  SET 
    hit_count = hit_count + 1,
    last_hit_at = NOW(),
    updated_at = NOW(),
    -- Prolonger le TTL si souvent utilisé (max 30 jours)
    expires_at = LEAST(
      expires_at + INTERVAL '1 day',
      NOW() + INTERVAL '30 days'
    )
  WHERE id = cache_id;
END;
$$;

-- 6. Fonction de purge du cache expiré
CREATE OR REPLACE FUNCTION public.purge_expired_cache()
RETURNS TABLE(deleted_count BIGINT, remaining_count BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted_count BIGINT;
  v_remaining BIGINT;
BEGIN
  DELETE FROM response_cache
  WHERE expires_at < NOW();
  
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  
  SELECT COUNT(*) INTO v_remaining FROM response_cache;
  
  RETURN QUERY SELECT v_deleted_count, v_remaining;
END;
$$;

-- 7. Fonction de purge LRU (least recently used)
CREATE OR REPLACE FUNCTION public.purge_lru_cache(max_entries INT DEFAULT 10000)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_count INT;
  to_delete INT;
  deleted INT := 0;
BEGIN
  SELECT COUNT(*) INTO current_count FROM response_cache;
  
  IF current_count <= max_entries THEN
    RETURN 0;
  END IF;
  
  to_delete := current_count - max_entries;
  
  DELETE FROM response_cache
  WHERE id IN (
    SELECT id FROM response_cache
    ORDER BY last_hit_at ASC NULLS FIRST, hit_count ASC
    LIMIT to_delete
  );
  
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$;

-- 8. Vue pour les statistiques du cache
CREATE OR REPLACE VIEW public.cache_stats WITH (security_invoker = true) AS
SELECT 
  COUNT(*) as total_entries,
  COUNT(*) FILTER (WHERE expires_at < NOW()) as expired_entries,
  COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as entries_last_24h,
  COALESCE(SUM(hit_count), 0) as total_hits,
  ROUND(COALESCE(AVG(hit_count), 0), 2) as avg_hits_per_entry,
  pg_size_pretty(pg_total_relation_size('response_cache')) as total_size,
  MIN(created_at) as oldest_entry,
  MAX(created_at) as newest_entry
FROM response_cache;

-- 9. Vue dashboard consolidée
CREATE OR REPLACE VIEW public.cache_dashboard WITH (security_invoker = true) AS
SELECT 
  (SELECT COUNT(*) FROM response_cache) as total_entries,
  (SELECT COUNT(*) FROM response_cache WHERE expires_at < NOW()) as expired,
  (SELECT COUNT(*) FROM response_cache WHERE created_at > NOW() - INTERVAL '24h') as new_last_24h,
  (SELECT COALESCE(SUM(hit_count), 0) FROM response_cache) as total_hits,
  (SELECT ROUND(COALESCE(AVG(hit_count), 0), 2) FROM response_cache WHERE hit_count > 0) as avg_hits_used_entries,
  (SELECT COUNT(*) FROM response_cache WHERE hit_count = 0) as never_used_entries,
  pg_size_pretty(pg_total_relation_size('response_cache')) as size,
  CASE 
    WHEN (SELECT COUNT(*) FROM response_cache) > 50000 THEN 'critical'
    WHEN (SELECT COUNT(*) FROM response_cache) > 20000 THEN 'warning'
    ELSE 'healthy'
  END as health_status;