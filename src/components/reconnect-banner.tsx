import React from 'react';

export interface ReconnectBannerProps {
  /** Error message to display (already formatted by the caller / hook). */
  error: string;
  /** True when the PAPI connection is down — shows the "Reconectar" button. */
  disconnected: boolean;
  /** Called when the user clicks "(reintentar)" while NOT disconnected. */
  onRetry?: () => void;
  /** Visual variant: full-width bar for main webviews, padded for widgets. */
  variant?: 'bar' | 'widget';
}

/**
 * Shared error/reconnect banner. When `disconnected` is true it renders a prominent "Reconectar"
 * button that reloads the webview (the only reliable way to re-establish the PAPI JSON-RPC
 * connection after it drops). Otherwise it renders a "(reintentar)" link bound to `onRetry`.
 *
 * Replaces the copy-pasted banner JSX in notes-viewer and unread-notes-widget and is reused by the
 * other webviews that previously surfaced raw "Tried to send payload while not connected" errors.
 */
export function ReconnectBanner({
  error,
  disconnected,
  onRetry,
  variant = 'bar',
}: ReconnectBannerProps) {
  const containerClass =
    variant === 'bar'
      ? 'tw:bg-red-50 tw:border-b tw:border-red-200 tw:px-4 tw:py-2 tw:text-red-700 tw:text-xs tw:font-medium tw:flex tw:justify-between tw:items-center tw:gap-2'
      : 'tw:p-3 tw:text-red-600 tw:bg-red-50 tw:text-xs tw:border-b tw:flex tw:justify-between tw:items-center tw:gap-2';

  return (
    <div className={containerClass} role="alert">
      <span>{error}</span>
      <div className="tw:flex tw:items-center tw:gap-3 tw:shrink-0">
        {disconnected ? (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="tw:bg-red-600 tw:hover:bg-red-700 tw:text-white tw:px-3 tw:py-1 tw:rounded tw:font-semibold tw:cursor-pointer tw:transition-colors"
            title="Recargar la vista para reestablecer la conexión con Paratext"
          >
            Reconectar
          </button>
        ) : (
          onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="tw:text-red-700 tw:underline tw:hover:text-red-900 tw:ml-2 tw:cursor-pointer"
            >
              (reintentar)
            </button>
          )
        )}
      </div>
    </div>
  );
}
