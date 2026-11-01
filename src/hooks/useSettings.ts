import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface Settings {
  download_dir: string | null;
  default_quality: string;
  concurrency: number;
  cookies_path: string | null;
}

const KEYS = ["download_dir", "default_quality", "concurrency", "cookies_path"] as const;

export const DEFAULT_SETTINGS: Settings = {
  download_dir: null,
  default_quality: "video",
  concurrency: 2,
  cookies_path: null,
};

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const values = await Promise.all(
      KEYS.map((key) => invoke<string | null>("get_setting", { key })),
    );
    const raw = Object.fromEntries(KEYS.map((key, i) => [key, values[i]])) as Record<
      (typeof KEYS)[number],
      string | null
    >;
    setSettings({
      download_dir: raw.download_dir,
      default_quality: raw.default_quality ?? DEFAULT_SETTINGS.default_quality,
      concurrency: Number(raw.concurrency) || DEFAULT_SETTINGS.concurrency,
      cookies_path: raw.cookies_path,
    });
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const update = useCallback(async <K extends keyof Settings>(key: K, value: Settings[K]) => {
    await invoke("set_setting", { key, value: String(value) });
    setSettings((current) => ({ ...current, [key]: value }));
  }, []);

  const pickFolder = useCallback(async () => {
    const folder = await invoke<string | null>("pick_folder");
    if (folder) await update("download_dir", folder);
  }, [update]);

  return { settings, loaded, load, update, pickFolder };
}
