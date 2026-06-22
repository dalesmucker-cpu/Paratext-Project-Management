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
  'Se perdió la conexión con Paratext. Reconectando automáticamente…';

/** Heartbeat interval — sends a lightweight ping to keep the PAPI WebSocket alive during idle. */
const HEARTBEAT_INTERVAL_MS = 15_000;

/** How often to poll for connection recovery while disconnected. */
const RECOVERY_POLL_INTERVAL_MS = 2000;

/**
 * Disconnect prevention + recovery for all webviews.
 *
 * **Heartbeat (prevention):** Pings every 15s to keep the WebSocket alive.
 * Stops pinging once disconnected (no point pinging a dead connection).
 *
 * **Detection:** If the heartbeat ping fails, or any PAPI command fails via
 * `handleCatch`, the `disconnected` flag is set.
 *
 * **Recovery:** Once disconnected, polls every 2s with a ping to check if the
 * connection has recovered. When the ping succeeds, reloads the webview (with
 * jitter to prevent thundering herd). This avoids reloading into a still-dead
 * connection, which was causing the persistent errors.
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
  const { onBeforeReload, autoReloadOnFocus = true, reloadJitterMs = 1500 } = options ?? {};
  const [disconnected, setDisconnected] = useState(false);
  const disconnectedRef = useRef(false);
  disconnectedRef.current = disconnected;

  const jitterRef = useRef<number>(Math.random() * reloadJitterMs);
  const reloadingRef = useRef(false);
  const recoveryPollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

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
  // Stops when disconnected — the recovery poll takes over.
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

  // ── Recovery poll: when disconnected, ping every 2s until connection ──
  // comes back, then reload the webview. This avoids reloading into a
  // still-dead connection (which was causing the persistent errors).
  useEffect(() => {
    if (!disconnected || !autoReloadOnFocus) {
      if (recoveryPollRef.current) {
        clearInterval(recoveryPollRef.current);
        recoveryPollRef.current = undefined;
      }
      return undefined;
    }

    if (reloadingRef.current) return undefined;

    const poll = setInterval(async () => {
      if (reloadingRef.current) return;
      try {
        await papi.commands.sendCommand('paratextProjectManager.ping');
        // Connection recovered! Reload to re-establish the full WebSocket.
        reloadingRef.current = true;
        clearInterval(poll);
        recoveryPollRef.current = undefined;
        onBeforeReloadRef.current?.();
        setTimeout(() => window.location.reload(), jitterRef.current);
      } catch {
        // Still dead — keep polling. The error is silently swallowed to
        // avoid console spam (the platform logs it at debug level regardless).
      }
    }, RECOVERY_POLL_INTERVAL_MS);

    recoveryPollRef.current = poll;
    return () => {
      clearInterval(poll);
      if (recoveryPollRef.current === poll) recoveryPollRef.current = undefined;
    };
  }, [disconnected, autoReloadOnFocus]);

  // ── Proactive ping on visibility change ────────────────────────────────
  // When the tab becomes visible, immediately check connectivity. The
  // heartbeat may not have fired while backgrounded (browser throttling).
  useEffect(() => {
    if (!autoReloadOnFocus) return undefined;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (reloadingRef.current) return;
      // If already disconnected, the recovery poll is handling it.
      if (disconnectedRef.current) return;
      // Proactively ping to check connectivity.
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
