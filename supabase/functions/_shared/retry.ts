// ============================================================================
// RETRY AVEC EXPONENTIAL BACKOFF - Production Hardening
// ============================================================================

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  retryableStatuses: number[];
  timeoutMs?: number;
}

export interface RetryResult<T> {
  success: boolean;
  data?: T;
  attempts: number;
  lastError?: string;
  totalDurationMs: number;
}

// Configuration par défaut STRICTE pour production (2 retries max)
const DEFAULT_CONFIG: RetryConfig = {
  maxRetries: 2,  // PRODUCTION: 2 retries max (total 3 tentatives)
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  retryableStatuses: [429, 500, 502, 503, 504],
  timeoutMs: 60000,
};

// Configuration LLM spécifique
const LLM_CONFIG: RetryConfig = {
  maxRetries: 1,        // PRODUCTION: 1 retry max (total 2 attempts) to avoid cascading timeouts
  initialDelayMs: 2000, // 2s between attempts
  maxDelayMs: 10000,    // Max 10s wait
  retryableStatuses: [429, 500, 502, 503, 504, 529], // 529 = Anthropic overloaded
  timeoutMs: 120000,    // 2 minutes default for LLM calls
};

/**
 * Fonction générique de fetch avec retry et timeout
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  config: RetryConfig = DEFAULT_CONFIG
): Promise<Response> {
  let lastError: Error | null = null;
  let delay = config.initialDelayMs;
  const startTime = Date.now();
  
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = config.timeoutMs 
      ? setTimeout(() => controller.abort(), config.timeoutMs)
      : null;
    
    try {
      console.log(`[Retry] Attempt ${attempt + 1}/${config.maxRetries + 1} for ${url.split("?")[0]}`);
      
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      
      if (timeoutId) clearTimeout(timeoutId);
      
      // Si succès ou erreur non-retryable, retourner
      if (response.ok || !config.retryableStatuses.includes(response.status)) {
        return response;
      }
      
      console.warn(`[Retry] Status ${response.status}, will retry...`);
      
      // Extraire Retry-After si disponible
      const retryAfter = response.headers.get("Retry-After");
      if (retryAfter) {
        const retryMs = parseInt(retryAfter) * 1000;
        if (!isNaN(retryMs) && retryMs > 0) {
          delay = Math.min(retryMs, config.maxDelayMs);
        }
      }
      
      if (attempt < config.maxRetries) {
        console.log(`[Retry] Waiting ${delay}ms before retry...`);
        await new Promise(r => setTimeout(r, delay));
        delay = Math.min(delay * 2, config.maxDelayMs); // Exponential backoff
      } else {
        return response; // Dernière tentative, retourner la réponse
      }
      
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId);
      lastError = error as Error;
      
      const isAbort = (error as Error).name === "AbortError";
      console.error(`[Retry] Attempt ${attempt + 1} ${isAbort ? "timeout" : "error"}:`, 
        isAbort ? "Request timed out" : (error as Error).message);
      
      if (attempt < config.maxRetries) {
        await new Promise(r => setTimeout(r, delay));
        delay = Math.min(delay * 2, config.maxDelayMs);
      }
    }
  }
  
  const duration = Date.now() - startTime;
  throw new Error(`Max retries exceeded after ${duration}ms: ${lastError?.message || "Unknown error"}`);
}

/**
 * Fonction spécifique pour Anthropic avec timeout étendu
 * PRODUCTION: 2 retries max, timeout 3 minutes
 */
export async function callAnthropicWithRetry(
  apiKey: string,
  body: object,
  timeoutMs: number = 180000 // 3 minutes par défaut
): Promise<Response> {
  return await fetchWithRetry(
    "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    {
      ...LLM_CONFIG,
      timeoutMs,
    }
  );
}

/**
 * Fonction spécifique pour OpenAI
 * PRODUCTION: 2 retries max
 */
export async function callOpenAIWithRetry(
  apiKey: string,
  endpoint: string,
  body: object,
  timeoutMs: number = 60000
): Promise<Response> {
  return await fetchWithRetry(
    `https://api.openai.com/v1/${endpoint}`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    {
      maxRetries: 2,
      initialDelayMs: 1000,
      maxDelayMs: 10000,
      retryableStatuses: [429, 500, 502, 503],
      timeoutMs,
    }
  );
}

/**
 * Wrapper pour appels LLM avec métriques d'observabilité
 */
export async function callLLMWithMetrics<T>(
  name: string,
  callFn: () => Promise<T>
): Promise<{ result: T; metrics: { durationMs: number; success: boolean; error?: string } }> {
  const startTime = Date.now();
  
  try {
    const result = await callFn();
    return {
      result,
      metrics: {
        durationMs: Date.now() - startTime,
        success: true,
      },
    };
  } catch (error) {
    const err = error as Error;
    return {
      result: null as T,
      metrics: {
        durationMs: Date.now() - startTime,
        success: false,
        error: err.message,
      },
    };
  }
}
