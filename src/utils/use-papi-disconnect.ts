import papi from '@papi/frontend';
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
 * Spanish message shown in the reconnect banner when the PAPI JSON-RPC connection has dropped.
 */
export const DISCONNECT_MESSAGE =
  'Se perdió la conexión con Paratext (probablemente por inactividad). Haz clic en "Reconectar" para reanudar.';

/** Heartbeat interval — sends a lightweight ping to keep the PAPI WebSocket alive during idle. */
const HEARTBEAT_INTERVAL_MS = 15_000;

/** Delay before per-tab visibility data loads, giving the hook's ping check time to complete. */
export const VISIBILITY_LOAD_DELAY_MS = 300;

export interface UsePapiDisconnectOptions {
  onBeforeReload?: () => void;
  autoReloadOnFocus?: boolean;
  reloadJitterMs?: number;
}

export interface UsePapiDisconnectResult {
  disconnected: boolean;
  disconnectedRef: MutableRefObject<boolean>;
  clearDisconnected: () => void;
  handleCatch: (err: unknown, fallbackPrefix?: string) => string;
}

/**
 * Disconnect prevention + recovery for all webviews.
 *
 * **Heartbeat:** Pings every 15s to keep the WebSocket alive. Browsers throttle
 * timers in background tabs, so this may not fire reliably while idle — the
 * proactive ping on visibility change is the real safety net.
 *
 * **Proactive ping on visibility change:** When the tab becomes visible, the
 * hook immediately pings the backend to verify the connection is alive. This
 * fires BEFORE per-tab data-load effects (which are delayed by
 * {@link VISIBILITY_LOAD_DELAY_MS}). If the ping fails, `disconnected` is set
 * to `true` synchronously, so the delayed data loads see it and skip. The webview
 * is then reloaded to re-establish the connection.
 *
 * **Recovery:** If `disconnected` is true, the webview is reloaded (with random
 * jitter to prevent thundering herd).
 */
export function usePapiDisconnect(options?: UsePapiDisconnectOptions): UsePapiDisconnectResult {
  const { onBeforeReload, autoReloadOnFocus = true, reloadJitterMs = 2000 } = options ?? {};
  const [disconnected, setDisconnected] = useState(false);
  const disconnectedRef = useRef(false);
  disconnectedRef.current = disconnected;

  const jitterRef = useRef<number>(Math.random() * reloadJitterMs);
  const reloadingRef = useRef(false);

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

  // ── Heartbeat: ping every 15s to keep the WebSocket alive ──────────────
  useEffect(() => {
    let cancelled = false;
    const heartbeat = setInterval(async () => {
      if (cancelled) return;
      try {
        await papi.commands.sendCommand('paratextProjectManager.ping');
        if (disconnectedRef.current && !cancelled) {
          setDisconnected(false);
        }
      } catch (err) {
        if (cancelled) return;
        if (isPapiDisconnectedError(err)) {
          setDisconnected(true);
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(heartbeat);
    };
  }, []);

  // ── Proactive ping + recovery on visibility change ─────────────────────
  // When the tab becomes visible, immediately ping to check connectivity.
  // This is the safety net for when the heartbeat was throttled by the
  // browser while in the background. The ping fails synchronously if the
  // connection is dead ("Tried to send payload while not connected"), so
  // `disconnected` is set before the per-tab data-load effects fire (they
  // are delayed by VISIBILITY_LOAD_DELAY_MS via a setTimeout wrapper).
  useEffect(() => {
    if (!autoReloadOnFocus) return undefined;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (reloadingRef.current) return;

      // If we already know we're disconnected, skip the ping and reload.
      if (disconnectedRef.current) {
        reloadingRef.current = true;
        onBeforeReloadRef.current?.();
        setTimeout(() => window.location.reload(), jitterRef.current);
        return;
      }

      // Proactively ping to verify the connection is alive. The heartbeat
      // may not have fired while the tab was backgrounded (browser throttling),
      // so we can't trust that `disconnected === false` means the connection
      // is actually alive.
      papi.commands
        .sendCommand('paratextProjectManager.ping')
        .then(() => {
          // Connection is alive — nothing to do.
        })
        .catch((err) => {
          if (isPapiDisconnectedError(err)) {
            setDisconnected(true);
            reloadingRef.current = true;
            onBeforeReloadRef.current?.();
            setTimeout(() => window.location.reload(), jitterRef.current);
          }
        });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [autoReloadOnFocus]);

  return { disconnected, disconnectedRef, clearDisconnected, handleCatch };
}
