// ============================================================================
// RETRY UTILITY - Exponential backoff for network requests
// ============================================================================

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryOn?: (response: Response) => boolean;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 2,
  baseDelayMs: 1000,
  maxDelayMs: 5000,
  retryOn: (res) => res.status >= 500 || res.status === 429,
};

/**
 * Fetch with automatic retry on transient errors (5xx, 429).
 * Uses exponential backoff with jitter.
 */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: RetryOptions
): Promise<Response> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      const response = await fetch(input, init);

      if (response.ok || !opts.retryOn(response) || attempt === opts.maxRetries) {
        return response;
      }

      // Wait before retry with exponential backoff + jitter
      const delay = Math.min(
        opts.baseDelayMs * Math.pow(2, attempt) + Math.random() * 500,
        opts.maxDelayMs
      );
      console.warn(`[Retry] Attempt ${attempt + 1}/${opts.maxRetries} failed (${response.status}), retrying in ${Math.round(delay)}ms`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === opts.maxRetries) break;

      const delay = Math.min(
        opts.baseDelayMs * Math.pow(2, attempt) + Math.random() * 500,
        opts.maxDelayMs
      );
      console.warn(`[Retry] Network error on attempt ${attempt + 1}/${opts.maxRetries}, retrying in ${Math.round(delay)}ms`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError || new Error("Request failed after retries");
}
