import papi from '@papi/frontend';
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

/** Heartbeat interval — sends a lightweight ping to keep the PAPI WebSocket alive during idle. */
const HEARTBEAT_INTERVAL_MS = 30_000;

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
  /**
   * Maximum random jitter (ms) added to the auto-reload delay. Default 2000. The actual delay is
   * a random value in [0, reloadJitterMs] generated once per hook instance. Staggering prevents a
   * thundering herd when multiple tabs all become visible at the same time and would otherwise
   * fire ~30 simultaneous PAPI commands through the single shared notes-helper IPC channel.
   */
  reloadJitterMs?: number;
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
 * Encapsulates the disconnect-prevention and recovery pattern for all webviews.
 *
 * **Heartbeat (prevention):** Sends a lightweight `ping` command every 30 seconds to keep the
 * PAPI JSON-RPC WebSocket alive during idle. This is the primary defense — if the socket never
 * closes, none of the recovery machinery is needed.
 *
 * **Disconnect detection:** If the heartbeat ping fails with a disconnect error, or if any PAPI
 * command fails with a disconnect error (via `handleCatch`), the `disconnected` flag is set.
 *
 * **Recovery:** On `visibilitychange` to visible, if `disconnected` is true, the webview is
 * reloaded (with random jitter to prevent thundering herd). The reload re-establishes the
 * JSON-RPC connection from scratch.
 */
export function usePapiDisconnect(options?: UsePapiDisconnectOptions): UsePapiDisconnectResult {
  const { onBeforeReload, autoReloadOnFocus = true, reloadJitterMs = 2000 } = options ?? {};
  const [disconnected, setDisconnected] = useState(false);
  const disconnectedRef = useRef(false);
  disconnectedRef.current = disconnected;

  // Stable per-instance random jitter (generated once, never re-randomized). Spreads reloads
  // across multiple webviews so they don't all hit the backend simultaneously.
  const jitterRef = useRef<number>(Math.random() * reloadJitterMs);
  // Guard against double-reload if visibilitychange fires twice while the reload timer is pending.
  const reloadingRef = useRef(false);

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

  // ── Heartbeat: ping every 30s to keep the WebSocket alive ──────────────
  // This is the primary defense against idle disconnects. The ping command is
  // handled directly in main.ts (no notes-helper IPC), so it's nearly free.
  // If the ping succeeds and we were disconnected, clear the flag (the
  // connection recovered on its own). If it fails, set disconnected so the
  // next visibility change triggers a reload.
  useEffect(() => {
    let cancelled = false;
    const heartbeat = setInterval(async () => {
      if (cancelled) return;
      try {
        await papi.commands.sendCommand('paratextProjectManager.ping');
        // Connection is alive — if we were disconnected, the connection
        // recovered on its own (e.g. platform reconnected the WebSocket).
        if (disconnectedRef.current && !cancelled) {
          setDisconnected(false);
        }
      } catch (err) {
        if (cancelled) return;
        if (isPapiDisconnectedError(err)) {
          setDisconnected(true);
        }
        // Non-disconnect errors are likely transient — ignore them so the
        // heartbeat doesn't flip the banner for unrelated failures.
      }
    }, HEARTBEAT_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(heartbeat);
    };
  }, []);

  // ── Recovery: reload on visibility change if disconnected ──────────────
  useEffect(() => {
    if (!autoReloadOnFocus) return undefined;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (!disconnectedRef.current) return;
      if (reloadingRef.current) return;
      reloadingRef.current = true;
      // The PAPI connection dropped while idle. Reload the webview to
      // re-establish the JSON-RPC connection from scratch — retrying
      // commands on a dead connection cannot succeed. Jitter spreads
      // reloads across multiple webviews to prevent a thundering herd.
      onBeforeReloadRef.current?.();
      setTimeout(() => {
        window.location.reload();
      }, jitterRef.current);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [autoReloadOnFocus]);

  return { disconnected, disconnectedRef, clearDisconnected, handleCatch };
}
