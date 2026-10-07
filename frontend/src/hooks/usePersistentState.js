import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_TTL = 5 * 60 * 1000;

function getStorage(storage) {
  if (typeof window === 'undefined') return null;
  return storage === 'session' ? window.sessionStorage : window.localStorage;
}

function readValue(key, fallback, storage, ttl) {
  try {
    const target = getStorage(storage);
    if (!target) return fallback;
    const raw = target.getItem(key);
    if (!raw) return fallback;

    const parsed = JSON.parse(raw);
    if (!parsed?.savedAt || Date.now() - parsed.savedAt > ttl) {
      target.removeItem(key);
      return fallback;
    }

    return parsed.value ?? fallback;
  } catch {
    return fallback;
  }
}

export function usePersistentState(
  key,
  initialValue,
  { storage = 'local', ttl = DEFAULT_TTL, enabled = true } = {}
) {
  const initialRef = useRef(initialValue);
  const [value, setValue] = useState(() =>
    enabled && key ? readValue(key, initialRef.current, storage, ttl) : initialRef.current
  );

  useEffect(() => {
    if (!enabled || !key) return;
    setValue(readValue(key, initialRef.current, storage, ttl));
  }, [key, storage, ttl, enabled]);

  useEffect(() => {
    if (!enabled || !key) return;

    try {
      const target = getStorage(storage);
      if (!target) return;
      target.setItem(key, JSON.stringify({ savedAt: Date.now(), value }));
    } catch {
      // Storage is an optimization; app state continues if unavailable.
    }
  }, [key, storage, value, enabled]);

  const clear = useCallback(() => {
    try {
      getStorage(storage)?.removeItem(key);
    } catch {
      // Ignore storage failures.
    }
    setValue(initialRef.current);
  }, [key, storage]);

  return [value, setValue, clear];
}

export default usePersistentState;
