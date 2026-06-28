import papi from '@papi/frontend';
import React, { useState, useEffect } from 'react';

export interface AvatarData {
  type: 'initials' | 'upload' | 'cartoon';
  value: string;
}

// Global cache for user avatars to avoid redundant queries across multiple components
let avatarsCache: Record<string, AvatarData> = {};
const cacheListeners = new Set<() => void>();
let isLoading = false;
let isLoaded = false;

const notifyListeners = () => {
  cacheListeners.forEach((listener) => listener());
};

const loadAvatars = async () => {
  if (isLoading || isLoaded) return;
  isLoading = true;
  try {
    const dataStr = await papi.commands.sendCommand('paratextProjectManager.getUserAvatars');
    if (dataStr) {
      avatarsCache = JSON.parse(dataStr);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to load user avatars in Avatar cache:', err);
  } finally {
    isLoading = false;
    isLoaded = true;
    notifyListeners();
  }
};

// Global subscription to collaboration event emitter for avatar changes
let isListeningToCollab = false;
const subscribeToCollab = () => {
  if (isListeningToCollab) return;
  isListeningToCollab = true;
  try {
    papi.network.getNetworkEvent<{ type: string; payload: unknown }>(
      'paratextProjectManager.onCollabEvent',
    )((event) => {
      if (!event) return;
      const { type, payload } = event;
      if (
        type === 'avatar_changed' &&
        payload &&
        typeof payload === 'object' &&
        'username' in payload &&
        'config' in payload
      ) {
        // eslint-disable-next-line no-type-assertion/no-type-assertion
        const p = payload as { username: string; config: AvatarData };
        avatarsCache[p.username] = p.config;
        notifyListeners();
      }
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('Error subscribing to collab event in Avatar component:', err);
  }
};

// Local cache update trigger for immediate UI updates before network sync
export const updateLocalAvatarCache = (username: string, config: AvatarData) => {
  avatarsCache[username] = config;
  notifyListeners();
};

export interface AvatarProps {
  name: string;
  sizeClass?: string; // e.g. 'tw:w-8 tw:h-8' or 'tw:w-5 tw:h-5'
  className?: string;
  onClick?: (e: React.MouseEvent<HTMLElement>) => void;
  style?: React.CSSProperties;
}

export function Avatar({
  name,
  sizeClass = 'tw:w-8 tw:h-8',
  className = '',
  onClick,
  style,
}: AvatarProps) {
  const [avatars, setAvatars] = useState<Record<string, AvatarData>>(avatarsCache);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    const handleUpdate = () => {
      setAvatars({ ...avatarsCache });
    };
    cacheListeners.add(handleUpdate);

    // Trigger initial load and collaboration event subscription
    loadAvatars();
    subscribeToCollab();

    return () => {
      cacheListeners.delete(handleUpdate);
    };
  }, []);

  const username = name || 'Usuario';
  const avatarConfig = avatars[username];

  // Helper to extract initials for fallback
  const getInitials = (str: string) => {
    if (!str) return '?';
    const parts = str.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  // Reset image error if user avatar changes
  useEffect(() => {
    setImgError(false);
  }, [avatarConfig]);

  let content: React.ReactNode = <span>{getInitials(username)}</span>;

  if (avatarConfig && !imgError) {
    if (avatarConfig.type === 'upload' && avatarConfig.value) {
      content = (
        <img
          src={avatarConfig.value}
          alt={username}
          className="tw:w-full tw:h-full tw:object-cover"
          onError={() => setImgError(true)}
        />
      );
    } else if (avatarConfig.type === 'cartoon' && avatarConfig.value) {
      // Config value format: "style:seed"
      const parts = avatarConfig.value.split(':');
      const cartoonStyle = parts[0] || 'adventurer';
      const seed = parts[1] || encodeURIComponent(username);
      const url = `https://api.dicebear.com/7.x/${cartoonStyle}/svg?seed=${seed}`;

      content = (
        <img
          src={url}
          alt={username}
          className="tw:w-full tw:h-full tw:object-cover"
          onError={() => setImgError(true)}
        />
      );
    }
  }

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        style={style}
        className={`${sizeClass} tw:rounded-full tw:overflow-hidden tw:flex tw:items-center tw:justify-center tw:bg-slate-800 dark:tw:bg-slate-700 tw:text-white tw:text-xs tw:font-semibold tw:shrink-0 tw:cursor-pointer hover:tw:ring-2 hover:tw:ring-indigo-500 tw:transition-all ${className}`}
        title={username}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      style={style}
      className={`${sizeClass} tw:rounded-full tw:overflow-hidden tw:flex tw:items-center tw:justify-center tw:bg-slate-800 dark:tw:bg-slate-700 tw:text-white tw:text-xs tw:font-semibold tw:shrink-0 ${className}`}
      title={username}
    >
      {content}
    </div>
  );
}
