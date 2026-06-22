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

/** How often to retry the ping while waiting for the connection to come up on mount. */
const CONNECT_RETRY_INTERVAL_MS = 500;

/**
 * Disconnect prevention + recovery for all webviews.
 *
 * **Startup (connection wait):** On mount, pings every 500ms until the PAPI
 * WebSocket is ready. `ready` is false until the first ping succeeds. All data
 * loads should wait for `ready` before sending PAPI commands. This prevents
 * the infinite reload loop where mount effects fire PAPI commands before the
 * WebSocket is established, fail, set disconnected, reload, repeat.
 *
 * **Heartbeat (prevention):** Once ready, pings every 15s to keep the
 * WebSocket alive during idle. Stops when disconnected.
 *
 * **Recovery:** When disconnected, stops ALL PAPI calls, waits a staggered
 * delay (1-4s), then reloads. After reload, the startup ping loop waits for
 * the WebSocket to be ready before data loads proceed.
 */
export function usePapiDisconnect(options?: {
  onBeforeReload?: () => void;
  autoReloadOnFocus?: boolean;
  reloadJitterMs?: number;
}): {
  /** True once the PAPI connection has been verified alive on mount. */
  ready: boolean;
  /** True when the PAPI connection is known to be down. Drives the banner UI. */
  disconnected: boolean;
  disconnectedRef: MutableRefObject<boolean>;
  clearDisconnected: () => void;
  handleCatch: (err: unknown, fallbackPrefix?: string) => string;
} {
  const { onBeforeReload, autoReloadOnFocus = true, reloadJitterMs = 3000 } = options ?? {};
  const [ready, setReady] = useState(false);
  const [disconnected, setDisconnected] = useState(false);
  const disconnectedRef = useRef(false);
  disconnectedRef.current = disconnected;
  const readyRef = useRef(false);
  readyRef.current = ready;

  const jitterRef = useRef<number>(1000 + Math.random() * reloadJitterMs);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const onBeforeReloadRef = useRef(onBeforeReload);
  useEffect(() => {
    onBeforeReloadRef.current = onBeforeReload;
  });

  const clearDisconnected = useCallback(() => setDisconnected(false), []);

  const handleCatch = useCallback(
    (err: unknown, fallbackPrefix = 'Error: ') => {
      if (isPapiDisconnectedError(err)) {
        // Only set disconnected if we were previously ready (the connection
        // was established and then dropped). If we're not ready yet, the
        // WebSocket just hasn't connected — the startup ping loop handles that.
        if (readyRef.current) {
          setDisconnected(true);
        }
        return DISCONNECT_MESSAGE;
      }
      return `${fallbackPrefix}${errMsg(err)}`;
    },
    [],
  );

  // ── Startup: wait for PAPI connection to be ready ──────────────────────
  // On mount (and after every reload), ping every 500ms until the WebSocket
  // is established. This prevents mount-effect data loads from firing PAPI
  // commands before the connection is ready.
  useEffect(() => {
    let cancelled = false;
    const connect = setInterval(async () => {
      if (cancelled) return;
      try {
        await papi.commands.sendCommand('paratextProjectManager.ping');
        if (!cancelled) {
          setReady(true);
          clearInterval(connect);
        }
      } catch {
        // Not ready yet — keep retrying. Don't set disconnected (the
        // connection just hasn't come up yet, it hasn't dropped).
      }
    }, CONNECT_RETRY_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(connect);
    };
  }, []);

  // ── Heartbeat: ping every 15s to keep the WebSocket alive ──────────────
  // Only runs after ready=true. Stops when disconnected.
  useEffect(() => {
    if (!ready) return undefined;
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
  }, [ready]);

  // ── Recovery: reload after staggered delay when disconnected ───────────
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
  useEffect(() => {
    if (!autoReloadOnFocus) return undefined;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (disconnectedRef.current) return;
      if (!readyRef.current) return; // startup ping loop is handling it
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

  return { ready, disconnected, disconnectedRef, clearDisconnected, handleCatch };
}
