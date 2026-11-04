import { useCallback, useEffect, useState } from "react";
import { api, type SettingKey } from "../api";
import { attempt } from "../lib/notify";
import type { Settings } from "../types";

/** Null until the first load; the backend fills in every default. */
export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    void attempt(api.getSettings).then((loaded) => loaded && setSettings(loaded));
  }, []);

  /** Store one value; the backend validates it and returns the result. */
  const update = useCallback(async (key: SettingKey, value: string) => {
    const next = await attempt(() => api.setSetting(key, value));
    if (next) setSettings(next);
  }, []);

  const pickFolder = useCallback(async () => {
    const folder = await attempt(api.pickFolder);
    if (folder) await update("download_dir", folder);
  }, [update]);

  const pickCookies = useCallback(async () => {
    const file = await attempt(api.pickCookiesFile);
    if (file) await update("cookies_path", file);
  }, [update]);

  return { settings, update, pickFolder, pickCookies };
}
