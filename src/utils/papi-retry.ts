export interface PapiRetryOptions {
  maxRetries?: number; // default: 3
  baseDelayMs?: number; // default: 2000
  isCancelled?: () => boolean;
}

/**
 * Error thrown when the PAPI JSON-RPC connection between the webview and the
 * host is unavailable (e.g. after the program has been idle and the underlying
 * WebSocket has been closed). Retrying the command on a dead connection never
 * succeeds, so callers should treat this as a signal to reconnect (reload the
 * webview) rather than blindly retrying.
 */
export class PapiDisconnectedError extends Error {
  readonly isDisconnected = true;
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'PapiDisconnectedError';
    this.cause = cause;
  }
}

/**
 * Returns true if the given error indicates the PAPI JSON-RPC connection is
 * down. PAPI surfaces this as e.g.
 *   "JSON-RPC Request error (0): Tried to send payload while not connected"
 * The error may be an Error, a plain object with a `message` field, or a
 * string, so we normalize before matching.
 */
export function isPapiDisconnectedError(e: unknown): boolean {
  if (e instanceof PapiDisconnectedError) return true;
  const text = errorToText(e);
  return (
    text.includes('not connected') ||
    text.includes('Tried to send payload') ||
    text.includes('connection disposed') ||
    text.includes('socket has been closed') ||
    text.includes('websocket closed') ||
    text.includes('is not connected')
  );
}

function errorToText(e: unknown): string {
  if (e == null) return '';
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message;
  if (typeof e === 'object') {
    const obj = e as Record<string, unknown>;
    if (typeof obj.message === 'string') return obj.message;
    try {
      return JSON.stringify(obj);
    } catch {
      return String(e);
    }
  }
  return String(e);
}

/**
 * Retries an async function (typically a PAPI command call) with exponential backoff.
 * Delays: 2s -> 4s -> 8s (assuming default baseDelayMs of 2000)
 *
 * If the failure looks like the PAPI connection has dropped (see
 * {@link isPapiDisconnectedError}), retrying on a dead connection is futile,
 * so we do at most one short retry (in case it was a transient blip) and then
 * throw a {@link PapiDisconnectedError} so the caller can offer a reconnect.
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

      // A dead JSON-RPC connection won't recover by retrying. Try once more
      // quickly (transient blips do happen), then surface a typed error so the
      // UI can prompt the user to reconnect instead of wasting ~14s.
      if (isPapiDisconnectedError(err)) {
        if (attempt < 1) {
          await new Promise((r) => setTimeout(r, 500));
          if (isCancelled?.()) {
            throw new PapiDisconnectedError(errorToText(err), err);
          }
          continue;
        }
        throw new PapiDisconnectedError(errorToText(err), err);
      }

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
