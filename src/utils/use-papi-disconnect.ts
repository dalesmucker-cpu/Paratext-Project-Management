import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { isPapiDisconnectedError } from './papi-retry';

/** Safely convert any caught value (including papi plain-object errors) to a readable string. */
export function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'object' && e) {
    // eslint-disable-next-line no-type-assertion/no-type-assertion
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

/** Spanish message shown in the reconnect banner. */
export const DISCONNECT_MESSAGE =
  'Se perdió la conexión con Paratext. Haz clic en "Reconectar" para reintentar.';

export interface UsePapiDisconnectOptions {
  autoReloadOnFocus?: boolean;
}

export interface UsePapiDisconnectResult {
  ready: boolean;
  disconnected: boolean;
  disconnectedRef: MutableRefObject<boolean>;
  clearDisconnected: () => void;
  handleCatch: (err: unknown, fallbackPrefix?: string) => string;
}

/**
 * Disconnect detection and recovery for all webviews.
 *
 * **Global unhandled rejection handler:** Installs a `window` handler that catches PAPI-related
 * unhandled promise rejections (the platform's JSON-RPC layer logs these at error level before our
 * catch handlers can suppress them).
 *
 * **Startup delay:** On mount, waits 3 seconds before setting `ready=true`. The PAPI WebSocket
 * needs time to connect after a reload. Without this delay, mount-effect data loads fire PAPI
 * commands before the WebSocket is ready, producing "Tried to send payload" errors.
 *
 * **Detection:** When any PAPI command fails with a disconnect error (via `handleCatch`), the
 * `disconnected` flag is set and the banner appears.
 *
 * **Recovery:** User clicks "Reconectar" → webview reloads → 3s delay → data loads proceed. If the
 * connection is still dead, the first data load fails and the banner appears again.
 */
export function usePapiDisconnect(options?: UsePapiDisconnectOptions): UsePapiDisconnectResult {
  const { autoReloadOnFocus: _autoReloadOnFocus = true } = options ?? {};
  const [ready, setReady] = useState(false);
  const [disconnected, setDisconnected] = useState(false);
  const disconnectedRef = useRef(false);
  disconnectedRef.current = disconnected;
  const readyRef = useRef(false);
  readyRef.current = ready;

  // ── Global unhandled rejection handler ────────────────────────────────
  // The PAPI platform logs "Tried to send payload while not connected" at
  // the renderer level when the WebSocket is dead. Even though our try/catch
  // blocks catch the rejection, some PAPI calls at the module level (before
  // any component mounts) may produce unhandled rejections. This handler
  // suppresses those.
  useEffect(() => {
    const handler = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      if (isPapiDisconnectedError(reason)) {
        event.preventDefault();
      }
    };
    window.addEventListener('unhandledrejection', handler);
    return () => window.removeEventListener('unhandledrejection', handler);
  }, []);

  // ── Startup delay: wait 3s for the WebSocket to connect ────────────────
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 3000);
    return () => clearTimeout(timer);
  }, []);

  const clearDisconnected = useCallback(() => setDisconnected(false), []);

  const handleCatch = useCallback((err: unknown, fallbackPrefix = 'Error: ') => {
    if (isPapiDisconnectedError(err)) {
      setDisconnected(true);
      return DISCONNECT_MESSAGE;
    }
    return `${fallbackPrefix}${errMsg(err)}`;
  }, []);

  return { ready, disconnected, disconnectedRef, clearDisconnected, handleCatch };
}
