// ============================================================================
// PURGE MANUELLE DU CACHE SÉMANTIQUE
// ============================================================================
// Nettoie les entrées expirées et applique une politique LRU

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreFlight, errorResponse, successResponse } from "../_shared/cors.ts";
import { requireAuth } from "../_shared/auth-check.ts";

interface PurgeResult {
  expired_deleted: number;
  lru_deleted: number;
  force_deleted: number;
  total_deleted: number;
  entries_remaining: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return handleCorsPreFlight(req);
  }

  // Require admin authentication
  const corsHeaders = getCorsHeaders(req);
  const { error: authError } = await requireAuth(req, corsHeaders, true);
  if (authError) return authError;

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return errorResponse(req, "Configuration manquante", 500);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Parse parameters
  let maxEntries = 10000;
  let forceAll = false;

  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      maxEntries = body.max_entries || 10000;
      forceAll = body.force === true;
    } else {
      const url = new URL(req.url);
      maxEntries = parseInt(url.searchParams.get("max_entries") || "10000");
      forceAll = url.searchParams.get("force") === "true";
    }
  } catch {
    // Use defaults
  }

  console.log(`[purge-cache] Starting (max_entries: ${maxEntries}, force: ${forceAll})`);

  try {
    const result: PurgeResult = {
      expired_deleted: 0,
      lru_deleted: 0,
      force_deleted: 0,
      total_deleted: 0,
      entries_remaining: 0,
    };

    if (forceAll) {
      // Force purge: delete everything
      const { count } = await supabase
        .from("response_cache")
        .delete()
        .gte("id", "00000000-0000-0000-0000-000000000000")
        .select("id", { count: "exact", head: true });

      result.force_deleted = count || 0;
      result.total_deleted = result.force_deleted;
      result.entries_remaining = 0;

      console.log(`[purge-cache] Force purge: ${result.force_deleted} entries deleted`);
    } else {
      // 1. Purge expired entries
      const { data: expiredResult } = await supabase.rpc("purge_expired_cache");
      result.expired_deleted = expiredResult?.[0]?.deleted_count || 0;

      // 2. Purge LRU if over limit
      const { data: lruResult } = await supabase.rpc("purge_lru_cache", {
        max_entries: maxEntries,
      });
      result.lru_deleted = lruResult || 0;

      result.total_deleted = result.expired_deleted + result.lru_deleted;

      // 3. Count remaining
      const { count } = await supabase
        .from("response_cache")
        .select("id", { count: "exact", head: true });
      result.entries_remaining = count || 0;

      console.log(
        `[purge-cache] Expired: ${result.expired_deleted}, LRU: ${result.lru_deleted}, Remaining: ${result.entries_remaining}`
      );
    }

    return successResponse(req, {
      success: true,
      result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[purge-cache] Error:", error);
    return errorResponse(req, `Erreur de purge: ${(error as Error).message}`, 500);
  }
});
