// ============================================================================
// CIRCUIT BREAKER - Protection contre les cascades d'erreurs
// ============================================================================

interface CircuitBreakerConfig {
  failureThreshold: number;   // Nombre d'échecs avant ouverture
  resetTimeoutMs: number;     // Temps avant de tester à nouveau
  halfOpenMaxCalls: number;   // Appels autorisés en half-open
}

type CircuitState = 'closed' | 'open' | 'half-open';

interface CircuitStats {
  failures: number;
  successes: number;
  lastFailure: number;
  state: CircuitState;
}

// Store en mémoire (par instance Edge Function)
const circuits = new Map<string, CircuitStats>();

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30000, // 30 secondes
  halfOpenMaxCalls: 3,
};

/**
 * Récupère ou crée les stats d'un circuit
 */
function getCircuitStats(name: string): CircuitStats {
  if (!circuits.has(name)) {
    circuits.set(name, {
      failures: 0,
      successes: 0,
      lastFailure: 0,
      state: 'closed',
    });
  }
  return circuits.get(name)!;
}

/**
 * Met à jour l'état du circuit
 */
function updateCircuitState(name: string, config: CircuitBreakerConfig): void {
  const stats = getCircuitStats(name);
  const now = Date.now();

  switch (stats.state) {
    case 'closed':
      if (stats.failures >= config.failureThreshold) {
        stats.state = 'open';
        console.warn(`[CircuitBreaker] ${name}: OPENED after ${stats.failures} failures`);
      }
      break;

    case 'open':
      if (now - stats.lastFailure > config.resetTimeoutMs) {
        stats.state = 'half-open';
        stats.successes = 0;
        console.info(`[CircuitBreaker] ${name}: HALF-OPEN, testing...`);
      }
      break;

    case 'half-open':
      if (stats.successes >= config.halfOpenMaxCalls) {
        stats.state = 'closed';
        stats.failures = 0;
        console.info(`[CircuitBreaker] ${name}: CLOSED, recovered`);
      }
      break;
  }
}

/**
 * Enregistre un succès
 */
function recordSuccess(name: string): void {
  const stats = getCircuitStats(name);
  stats.successes++;
  if (stats.state === 'closed') {
    stats.failures = Math.max(0, stats.failures - 1); // Decay
  }
}

/**
 * Enregistre un échec
 */
function recordFailure(name: string): void {
  const stats = getCircuitStats(name);
  stats.failures++;
  stats.lastFailure = Date.now();
}

/**
 * Vérifie si le circuit autorise un appel
 */
export function canCall(name: string, config: Partial<CircuitBreakerConfig> = {}): boolean {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  updateCircuitState(name, finalConfig);

  const stats = getCircuitStats(name);

  if (stats.state === 'open') {
    console.warn(`[CircuitBreaker] ${name}: Call rejected (circuit open)`);
    return false;
  }

  return true;
}

/**
 * Wrapper pour protéger une fonction avec circuit breaker
 */
export async function withCircuitBreaker<T>(
  name: string,
  fn: () => Promise<T>,
  config: Partial<CircuitBreakerConfig> = {}
): Promise<T> {
  if (!canCall(name, config)) {
    throw new Error(`Circuit breaker open for: ${name}`);
  }

  try {
    const result = await fn();
    recordSuccess(name);
    return result;
  } catch (error) {
    recordFailure(name);
    throw error;
  }
}

/**
 * État actuel d'un circuit (pour monitoring)
 */
export function getCircuitState(name: string): CircuitStats | undefined {
  return circuits.get(name);
}

/**
 * Reset manuel d'un circuit
 */
export function resetCircuit(name: string): void {
  circuits.delete(name);
  console.info(`[CircuitBreaker] ${name}: Manually reset`);
}