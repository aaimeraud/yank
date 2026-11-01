import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Settings as SettingsValue } from "../hooks/useSettings";

interface Props {
  settings: SettingsValue;
  onUpdate: <K extends keyof SettingsValue>(key: K, value: SettingsValue[K]) => Promise<void>;
  onPickFolder: () => void;
  onPickCookies: () => void;
}

const QUALITY = [
  { value: "video", label: "Video · MP4 (H.264)" },
  { value: "audio", label: "Audio only · M4A" },
  { value: "original", label: "Original · best available" },
];

export default function Settings({ settings, onUpdate, onPickFolder, onPickCookies }: Props) {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    invoke<string>("ytdlp_version")
      .then(setVersion)
      .catch(() => setVersion(null));
  }, []);

  return (
    <div className="settings">
      <div className="settings-group">
        <h3>Downloads</h3>

        <div className="setting-row">
          <div>
            <label>Folder</label>
            <p>Where videos and thumbnails are saved.</p>
          </div>
          <div className="setting-control">
            <span className="path" title={settings.download_dir ?? undefined}>
              {settings.download_dir ?? "Not set"}
            </span>
            <button onClick={onPickFolder}>Choose…</button>
          </div>
        </div>

        <div className="setting-row">
          <div>
            <label>Format</label>
            <p>Used for new downloads. H.264 keeps playback inside Yank reliable.</p>
          </div>
          <select
            value={settings.default_quality}
            onChange={(e) => onUpdate("default_quality", e.target.value)}
          >
            {QUALITY.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="setting-row">
          <div>
            <label>Concurrent downloads</label>
            <p>Takes effect after restarting Yank.</p>
          </div>
          <select
            value={String(settings.concurrency)}
            onChange={(e) => onUpdate("concurrency", Number(e.target.value))}
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>

        <div className="setting-row">
          <div>
            <label>Cookies file</label>
            <p>For private or age-restricted videos. Netscape cookies.txt format.</p>
          </div>
          <div className="setting-control">
            <span className="path" title={settings.cookies_path ?? undefined}>
              {settings.cookies_path || "None"}
            </span>
            <button onClick={onPickCookies}>Choose…</button>
            {settings.cookies_path && (
              <button onClick={() => onUpdate("cookies_path", "")}>Clear</button>
            )}
          </div>
        </div>
      </div>

      <div className="settings-group">
        <h3>About</h3>
        <div className="setting-row">
          <div>
            <label>yt-dlp</label>
            <p>Download engine bundled with your local setup.</p>
          </div>
          <span className="path">{version ?? "Checking…"}</span>
        </div>
        <div className="setting-row">
          <div>
            <label>Yank</label>
            <p>Personal macOS build. Downloads stay on this Mac.</p>
          </div>
          <span className="path">0.1.0</span>
        </div>
      </div>
    </div>
  );
}
