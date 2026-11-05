// Small per-machine UI preferences (sidebar collapsed, autoplay, volume...).
// They live in localStorage because they belong to this window, not to the
// library. Storage can be unavailable; every read falls back to the default.

import { useCallback, useState } from "react";

const PREFIX = "yank.";

export function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writePref<T>(key: string, value: T) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Not worth bothering the user about.
  }
}

/** useState that remembers its value across launches. */
export function usePref<T>(key: string, fallback: T): [T, (next: T | ((current: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => readPref(key, fallback));
  const update = useCallback(
    (next: T | ((current: T) => T)) => {
      setValue((current) => {
        const resolved = typeof next === "function" ? (next as (c: T) => T)(current) : next;
        writePref(key, resolved);
        return resolved;
      });
    },
    [key],
  );
  return [value, update];
}
