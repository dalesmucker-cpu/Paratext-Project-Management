import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { isPapiDisconnectedError } from './papi-retry';

/**
 * Safely convert any caught value (including papi plain-object errors) to a readable string.
 */
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

/**
 * Spanish message shown in the reconnect banner.
 */
export const DISCONNECT_MESSAGE =
  'Se perdió la conexión con Paratext. Haz clic en "Reconectar" para reintentar.';

export interface UsePapiDisconnectOptions {
  autoReloadOnFocus?: boolean;
}

export interface UsePapiDisconnectResult {
  /** True after a brief startup delay, so mount effects don't fire PAPI commands before the WebSocket is ready. */
  ready: boolean;
  /** True when the PAPI connection is known to be down. Drives the banner UI. */
  disconnected: boolean;
  disconnectedRef: MutableRefObject<boolean>;
  clearDisconnected: () => void;
  handleCatch: (err: unknown, fallbackPrefix?: string) => string;
}

/**
 * Disconnect detection and recovery for all webviews.
 *
 * **Startup delay:** On mount, waits 1 second before setting `ready=true`.
 * This gives the PAPI WebSocket time to connect after a reload, without
 * sending any pings that would generate "Tried to send payload" errors.
 * All mount-time data loads should check `ready` before proceeding.
 *
 * **Detection:** When any PAPI command fails with a disconnect error (via
 * `handleCatch`), the `disconnected` flag is set and the reconnect banner
 * appears.
 *
 * **Recovery:** The user clicks "Reconectar" which reloads the webview.
 * After reload, the 1-second startup delay gives the WebSocket time to
 * connect, then data loads proceed normally. If the connection is still
 * dead, the first data load will fail and the banner appears again.
 */
export function usePapiDisconnect(options?: UsePapiDisconnectOptions): UsePapiDisconnectResult {
  const { autoReloadOnFocus: _autoReloadOnFocus = true } = options ?? {};
  const [ready, setReady] = useState(false);
  const [disconnected, setDisconnected] = useState(false);
  const disconnectedRef = useRef(false);
  disconnectedRef.current = disconnected;
  const readyRef = useRef(false);
  readyRef.current = ready;

  // ── Startup delay: wait 1s for the WebSocket to connect ────────────────
  // No pings — pinging a dead connection generates "Tried to send payload"
  // errors in the console. The 1-second delay is enough for the WebSocket
  // to connect after a reload.
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 1000);
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
