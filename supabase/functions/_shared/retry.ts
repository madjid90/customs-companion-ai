// ============================================================================
// RETRY MODULE AMÉLIORÉ - PRODUCTION READY
// ============================================================================

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  retryableStatuses: number[];
  retryableErrors?: string[];  // Patterns d'erreurs à retry
  timeoutMs?: number;          // Timeout par tentative (compat legacy)
  timeout?: number;            // Alias pour timeoutMs
  onRetry?: (attempt: number, error: Error, delay: number) => void;
}

export interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  attempts: number;
  lastError?: string;
  totalDurationMs: number;
}

// Configuration par défaut STRICTE pour production
const DEFAULT_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  retryableStatuses: [429, 500, 502, 503, 504],
  retryableErrors: [
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    'socket hang up',
    'network',
    'timeout',
    'aborted',
  ],
  timeoutMs: 60000,
};

// ============================================================================
// CONFIGURATIONS PRÉ-DÉFINIES PAR SERVICE
// ============================================================================

export const RETRY_CONFIGS = {
  // Lovable AI - génération de texte (chat)
  lovableAI: {
    maxRetries: 3,
    initialDelayMs: 2000,
    maxDelayMs: 15000,
    retryableStatuses: [429, 500, 502, 503, 504],
    retryableErrors: ['timeout', 'aborted', 'network', 'socket hang up'],
    timeoutMs: 60000,
  } as RetryConfig,

  // OpenAI Embeddings - rapide
  openaiEmbeddings: {
    maxRetries: 2,
    initialDelayMs: 500,
    maxDelayMs: 5000,
    retryableStatuses: [429, 500, 502, 503, 504],
    retryableErrors: ['timeout', 'aborted', 'network'],
    timeoutMs: 10000,
  } as RetryConfig,

  // Anthropic Claude - analyse PDF (long)
  anthropicPDF: {
    maxRetries: 2,
    initialDelayMs: 3000,
    maxDelayMs: 20000,
    retryableStatuses: [429, 500, 502, 503, 504, 529], // 529 = overloaded
    retryableErrors: ['timeout', 'aborted', 'network', 'socket hang up'],
    timeoutMs: 180000, // 3 minutes pour gros PDFs
  } as RetryConfig,

  // Requêtes Supabase DB
  supabaseDB: {
    maxRetries: 3,
    initialDelayMs: 100,
    maxDelayMs: 2000,
    retryableStatuses: [500, 502, 503, 504],
    retryableErrors: ['timeout', 'network'],
    timeoutMs: 10000,
  } as RetryConfig,
} as const;

// ============================================================================
// UTILITAIRES INTERNES
// ============================================================================

/**
 * Calcule le délai avec exponential backoff + jitter (30%)
 */
function calculateBackoff(attempt: number, config: RetryConfig): number {
  const exponentialDelay = config.initialDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * 0.3 * exponentialDelay;
  return Math.min(exponentialDelay + jitter, config.maxDelayMs);
}

/**
 * Vérifie si une erreur est retryable par son message
 */
function isRetryableError(error: Error, config: RetryConfig): boolean {
  const message = error.message.toLowerCase();
  return (config.retryableErrors || []).some(pattern =>
    message.includes(pattern.toLowerCase())
  );
}

/**
 * Résout le timeout effectif depuis les deux alias possibles
 */
function resolveTimeout(config: RetryConfig): number {
  return config.timeoutMs ?? config.timeout ?? 60000;
}

// ============================================================================
// FETCH AVEC RETRY ET BACKOFF EXPONENTIEL
// ============================================================================

/**
 * Fetch avec retry, timeout par tentative, et backoff exponentiel + jitter
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  config: Partial<RetryConfig> = {}
): Promise<Response> {
  const finalConfig: RetryConfig = { ...DEFAULT_CONFIG, ...config };
  const effectiveTimeout = resolveTimeout(finalConfig);
  let lastError: Error | null = null;
  const startTime = Date.now();

  for (let attempt = 0; attempt <= finalConfig.maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), effectiveTimeout);

    try {
      console.log(`[Retry] Attempt ${attempt + 1}/${finalConfig.maxRetries + 1} for ${url.split("?")[0]}`);

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Si succès ou erreur non-retryable, retourner
      if (response.ok || !finalConfig.retryableStatuses.includes(response.status)) {
        return response;
      }

      const errorMessage = `HTTP ${response.status}`;
      console.warn(`[Retry] Status ${response.status}, will retry...`);

      if (attempt < finalConfig.maxRetries) {
        // Extraire Retry-After si disponible
        let delay = calculateBackoff(attempt, finalConfig);
        const retryAfter = response.headers.get("Retry-After");
        if (retryAfter) {
          const retryMs = parseInt(retryAfter) * 1000;
          if (!isNaN(retryMs) && retryMs > 0) {
            delay = Math.min(retryMs, finalConfig.maxDelayMs);
          }
        }

        finalConfig.onRetry?.(attempt + 1, new Error(errorMessage), delay);
        console.log(`[Retry] Waiting ${Math.round(delay)}ms before retry...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      return response; // Dernière tentative, retourner la réponse
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error as Error;

      const isAbort = lastError.name === "AbortError";
      const isRetryable = isAbort || isRetryableError(lastError, finalConfig);

      console.error(
        `[Retry] Attempt ${attempt + 1} ${isAbort ? "timeout" : "error"}:`,
        isAbort ? "Request timed out" : lastError.message
      );

      if (isRetryable && attempt < finalConfig.maxRetries) {
        const delay = calculateBackoff(attempt, finalConfig);
        finalConfig.onRetry?.(attempt + 1, lastError, delay);
        console.log(`[Retry] Waiting ${Math.round(delay)}ms before retry...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      throw lastError;
    }
  }

  const duration = Date.now() - startTime;
  throw new Error(`Max retries exceeded after ${duration}ms: ${lastError?.message || "Unknown error"}`);
}

// ============================================================================
// WRAPPER GÉNÉRIQUE POUR RETRY DE FONCTIONS ASYNC
// ============================================================================

/**
 * Wrapper générique: retry une fonction async quelconque (pas forcément fetch)
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<RetryResult<T>> {
  const finalConfig: RetryConfig = { ...DEFAULT_CONFIG, ...config };
  const startTime = Date.now();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= finalConfig.maxRetries; attempt++) {
    try {
      const data = await fn();
      return {
        success: true,
        data,
        attempts: attempt + 1,
        totalDurationMs: Date.now() - startTime,
      };
    } catch (error) {
      lastError = error as Error;

      const isRetryable = isRetryableError(lastError, finalConfig);

      if (isRetryable && attempt < finalConfig.maxRetries) {
        const delay = calculateBackoff(attempt, finalConfig);
        console.warn(
          `[withRetry] Attempt ${attempt + 1} failed: ${lastError.message}. ` +
          `Retrying in ${Math.round(delay)}ms...`
        );
        finalConfig.onRetry?.(attempt + 1, lastError, delay);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      break;
    }
  }

  return {
    success: false,
    error: lastError || new Error('Unknown error'),
    lastError: lastError?.message,
    attempts: finalConfig.maxRetries + 1,
    totalDurationMs: Date.now() - startTime,
  };
}

// ============================================================================
// FONCTIONS SPÉCIFIQUES PAR SERVICE (rétrocompatibilité)
// ============================================================================

/**
 * Appel Anthropic Claude avec retry et timeout étendu
 */
export async function callAnthropicWithRetry(
  apiKey: string,
  body: object,
  timeoutMs: number = 180000,
  extraHeaders: Record<string, string> = {}
): Promise<Response> {
  return await fetchWithRetry(
    "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    },
    {
      ...RETRY_CONFIGS.anthropicPDF,
      timeoutMs,
    }
  );
}

/**
 * Appel OpenAI avec retry
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
      ...RETRY_CONFIGS.openaiEmbeddings,
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