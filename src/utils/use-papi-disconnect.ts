import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { isPapiDisconnectedError } from './papi-retry';

/**
 * Safely convert any caught value (including papi plain-object errors) to a readable string.
 * Mirrors the local `errMsg` helpers defined in several webviews; consolidated here so the
 * disconnect hook can format errors without each call site repeating the logic.
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
 * Spanish message shown in the reconnect banner when the PAPI JSON-RPC connection between the
 * webview and the host has dropped (typically after the program has been idle). Kept as a constant
 * so every webview surfaces the same wording.
 */
export const DISCONNECT_MESSAGE =
  'Se perdió la conexión con Paratext (probablemente por inactividad). Haz clic en "Reconectar" para reanudar.';

export interface UsePapiDisconnectOptions {
  /**
   * Called when the tab becomes visible while disconnected, just before `window.location.reload()`
   * runs. Useful for logging; the reload is unconditional when disconnected.
   */
  onBeforeReload?: () => void;
  /**
   * When true (default), a `visibilitychange` listener auto-reloads the webview when it regains
   * focus while disconnected — the only reliable way to re-establish the JSON-RPC connection. Set
   * to false if a webview needs custom recovery, but this is rarely needed.
   */
  autoReloadOnFocus?: boolean;
}

export interface UsePapiDisconnectResult {
  /** True when the PAPI connection is known to be down. Drives the banner UI. */
  disconnected: boolean;
  /** Stable mirror of {@link disconnected} for use inside long-lived listeners. */
  disconnectedRef: MutableRefObject<boolean>;
  /** Mark connected again (e.g. at the start of a fresh load attempt). */
  clearDisconnected: () => void;
  /**
   * Inspect a caught error. If it looks like a PAPI disconnect, set {@link disconnected} and return
   * {@link DISCONNECT_MESSAGE}; otherwise return `fallbackPrefix + errMsg(err)`. Call this in every
   * catch block that surfaces errors to the UI.
   */
  handleCatch: (err: unknown, fallbackPrefix?: string) => string;
}

/**
 * Encapsulates the proven disconnect-recovery pattern used by the notes viewer and unread-notes
 * widget so every webview behaves consistently when the PAPI JSON-RPC WebSocket closes after idle.
 *
 * - Tracks a `disconnected` flag plus a ref mirror for stable listeners.
 * - Provides `handleCatch` to normalize error messages and flip the flag.
 * - Optionally installs a `visibilitychange` listener that reloads the webview when it regains focus
 *   while disconnected (re-establishing the connection from scratch — retrying commands on a dead
 *   socket cannot succeed).
 */
export function usePapiDisconnect(options?: UsePapiDisconnectOptions): UsePapiDisconnectResult {
  const { onBeforeReload, autoReloadOnFocus = true } = options ?? {};
  const [disconnected, setDisconnected] = useState(false);
  const disconnectedRef = useRef(false);
  disconnectedRef.current = disconnected;

  // Keep the onBeforeReload ref current without re-subscribing the listener.
  const onBeforeReloadRef = useRef(onBeforeReload);
  useEffect(() => {
    onBeforeReloadRef.current = onBeforeReload;
  });

  const clearDisconnected = useCallback(() => setDisconnected(false), []);

  const handleCatch = useCallback((err: unknown, fallbackPrefix = 'Error: ') => {
    if (isPapiDisconnectedError(err)) {
      setDisconnected(true);
      return DISCONNECT_MESSAGE;
    }
    return `${fallbackPrefix}${errMsg(err)}`;
  }, []);

  useEffect(() => {
    if (!autoReloadOnFocus) return undefined;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (!disconnectedRef.current) return;
      // The PAPI connection dropped while idle. Reload the webview to
      // re-establish the JSON-RPC connection from scratch — retrying
      // commands on a dead connection cannot succeed.
      onBeforeReloadRef.current?.();
      window.location.reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [autoReloadOnFocus]);

  return { disconnected, disconnectedRef, clearDisconnected, handleCatch };
}
