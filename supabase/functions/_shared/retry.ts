// ============================================================================
// RETRY AVEC EXPONENTIAL BACKOFF
// ============================================================================

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  retryableStatuses: number[];
}

const DEFAULT_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  retryableStatuses: [429, 500, 502, 503, 504]
};

// Fonction générique de fetch avec retry
export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  config: RetryConfig = DEFAULT_CONFIG
): Promise<Response> {
  let lastError: Error | null = null;
  let delay = config.initialDelayMs;
  
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      console.log(`[Retry] Attempt ${attempt + 1}/${config.maxRetries + 1} for ${url}`);
      
      const response = await fetch(url, options);
      
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
      lastError = error as Error;
      console.error(`[Retry] Attempt ${attempt + 1} error:`, error);
      
      if (attempt < config.maxRetries) {
        await new Promise(r => setTimeout(r, delay));
        delay = Math.min(delay * 2, config.maxDelayMs);
      }
    }
  }
  
  throw lastError || new Error("Max retries exceeded");
}

// Fonction spécifique pour Anthropic
// IMPORTANT: Timeout augmenté à 3 minutes pour les PDFs volumineux
export async function callAnthropicWithRetry(
  apiKey: string,
  body: object,
  timeoutMs: number = 180000 // 3 minutes au lieu de 60s
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
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
        signal: controller.signal,
      },
      {
        maxRetries: 5,        // Plus de tentatives
        initialDelayMs: 3000, // 3s entre les tentatives
        maxDelayMs: 30000,    // Max 30s d'attente
        retryableStatuses: [429, 500, 502, 503, 504, 529] // 529 = Anthropic overloaded
      }
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

// Fonction spécifique pour OpenAI
export async function callOpenAIWithRetry(
  apiKey: string,
  endpoint: string,
  body: object
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
      maxRetries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 10000,
      retryableStatuses: [429, 500, 502, 503]
    }
  );
}
