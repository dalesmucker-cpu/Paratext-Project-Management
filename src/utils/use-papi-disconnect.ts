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
 * Spanish message shown in the reconnect banner.
 */
export const DISCONNECT_MESSAGE =
  'Se perdió la conexión con Paratext. Reconectando automáticamente…';

/** Heartbeat interval — sends a lightweight ping to keep the PAPI WebSocket alive during idle. */
const HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * Disconnect prevention + recovery for all webviews.
 *
 * **Heartbeat (prevention):** Pings every 15s to keep the WebSocket alive.
 * Stops immediately when disconnected (no error spam).
 *
 * **Detection:** If the heartbeat ping fails, or any PAPI command fails via
 * `handleCatch`, the `disconnected` flag is set.
 *
 * **Recovery:** Once disconnected, ALL PAPI calls stop (heartbeat, intervals,
 * data loads). After a staggered delay (jitter 1000-4000ms per tab), the
 * webview reloads — this is the ONLY way to re-establish the PAPI WebSocket.
 * No polling (the connection never recovers without a reload).
 */
export function usePapiDisconnect(options?: {
  onBeforeReload?: () => void;
  autoReloadOnFocus?: boolean;
  reloadJitterMs?: number;
}): {
  disconnected: boolean;
  disconnectedRef: MutableRefObject<boolean>;
  clearDisconnected: () => void;
  handleCatch: (err: unknown, fallbackPrefix?: string) => string;
} {
  const { onBeforeReload, autoReloadOnFocus = true, reloadJitterMs = 3000 } = options ?? {};
  const [disconnected, setDisconnected] = useState(false);
  const disconnectedRef = useRef(false);
  disconnectedRef.current = disconnected;

  const jitterRef = useRef<number>(1000 + Math.random() * reloadJitterMs);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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
  // Stops when disconnected — no pinging a dead connection.
  useEffect(() => {
    let cancelled = false;
    const heartbeat = setInterval(async () => {
      if (cancelled || disconnectedRef.current) return;
      try {
        await papi.commands.sendCommand('paratextProjectManager.ping');
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

  // ── Recovery: reload after staggered delay when disconnected ───────────
  // The PAPI WebSocket never recovers without a reload. So we reload after
  // a random delay (1-4s per tab) to stagger the load on the backend.
  // No polling — just wait and reload.
  useEffect(() => {
    if (!disconnected || !autoReloadOnFocus) return undefined;
    if (reloadTimerRef.current) return undefined;

    onBeforeReloadRef.current?.();
    reloadTimerRef.current = setTimeout(() => {
      window.location.reload();
    }, jitterRef.current);

    return () => {
      if (reloadTimerRef.current) {
        clearTimeout(reloadTimerRef.current);
        reloadTimerRef.current = undefined;
      }
    };
  }, [disconnected, autoReloadOnFocus]);

  // ── Proactive ping on visibility change ────────────────────────────────
  // The heartbeat may not have fired while backgrounded (browser throttling).
  useEffect(() => {
    if (!autoReloadOnFocus) return undefined;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (disconnectedRef.current) return; // already handling recovery
      papi.commands
        .sendCommand('paratextProjectManager.ping')
        .then(() => {})
        .catch((err) => {
          if (isPapiDisconnectedError(err)) {
            setDisconnected(true);
          }
        });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [autoReloadOnFocus]);

  return { disconnected, disconnectedRef, clearDisconnected, handleCatch };
}
