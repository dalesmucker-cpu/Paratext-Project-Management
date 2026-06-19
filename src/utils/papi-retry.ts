export interface PapiRetryOptions {
  maxRetries?: number;       // default: 3
  baseDelayMs?: number;      // default: 2000
  isCancelled?: () => boolean;
}

/**
 * Retries an async function (typically a PAPI command call) with exponential backoff.
 * Delays: 2s -> 4s -> 8s (assuming default baseDelayMs of 2000)
 */
export async function papiRetry<T>(
  fn: () => Promise<T>,
  options?: PapiRetryOptions,
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 2000, isCancelled } = options ?? {};
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (isCancelled?.()) {
      throw new Error('PAPI retry cancelled');
    }

    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
        if (isCancelled?.()) {
          throw err;
        }
      }
    }
  }
  throw lastError;
}
