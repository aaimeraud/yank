import { useEffect, useState } from "react";
import { api, type SettingKey } from "../api";
import { attempt } from "../lib/notify";
import { FORMAT_OPTIONS } from "../lib/downloadFormats";
import type { Settings as SettingsValue, ToolchainReport } from "../types";

interface Props {
  settings: SettingsValue;
  onUpdate: (key: SettingKey, value: string) => Promise<void>;
  onPickFolder: () => void;
  onPickCookies: () => void;
}

export default function Settings({ settings, onUpdate, onPickFolder, onPickCookies }: Props) {
  const [tools, setTools] = useState<ToolchainReport | null>(null);

  useEffect(() => {
    void attempt(api.toolchainInfo).then((report) => report && setTools(report));
  }, []);

  return (
    <div className="settings">
      <section className="settings-section">
        <div className="settings-intro">
          <h2>Downloads</h2>
          <p>Applies to the next download you start. Running downloads keep the settings they started with.</p>
        </div>
        <div className="settings-panel">

        <Row label="Folder" hint="Where videos and thumbnails are saved. Playlists get a subfolder.">
          <span className="path" title={settings.download_dir}>
            {settings.download_dir}
          </span>
          <button onClick={onPickFolder}>Choose…</button>
        </Row>

        <Row label="Format" hint="Default for new downloads. H.264 MP4 always plays inside Yank.">
          <select
            value={settings.default_format}
            onChange={(e) => onUpdate("default_quality", e.target.value)}
          >
            {FORMAT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Row>

        <Row label="Concurrent downloads" hint="Applies at once. Lowering it lets running downloads finish.">
          <select
            value={String(settings.concurrency)}
            onChange={(e) => onUpdate("concurrency", e.target.value)}
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Row>

        <Row
          label="Cookies file"
          hint="For private, members-only or age-restricted videos (and most of X). Netscape cookies.txt."
        >
          <span className="path" title={settings.cookies_path ?? undefined}>
            {settings.cookies_path ?? "None"}
          </span>
          <button onClick={onPickCookies}>Choose…</button>
          {settings.cookies_path && <button onClick={() => onUpdate("cookies_path", "")}>Clear</button>}
        </Row>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-intro">
          <h2>Tools</h2>
          <p>Yank runs the programs installed on this Mac. When a site breaks, updating yt-dlp almost always fixes it.</p>
        </div>
        <div className="settings-panel">
        <ToolRow
          label="yt-dlp"
          hint="Does the downloading. Update it with your package manager when a site breaks."
          path={tools?.ytdlp_path}
          detail={tools?.ytdlp_version}
          loading={!tools}
          install="brew install yt-dlp"
        />
        <ToolRow
          label="ffmpeg"
          hint="Merges video and audio into one file."
          path={tools?.ffmpeg_path}
          loading={!tools}
          install="brew install ffmpeg"
        />
        <ToolRow
          label="deno"
          hint="Solves YouTube's player challenge. Without it many YouTube downloads fail."
          path={tools?.deno_path}
          loading={!tools}
          install="brew install deno"
        />
        <Row label="Logs" hint="Every download and failure is written to yank.log.">
          <button onClick={() => void attempt(api.openLogsFolder)}>Open in Finder</button>
        </Row>
        </div>
      </section>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="setting-row">
      <div>
        <label>{label}</label>
        <p>{hint}</p>
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

interface ToolRowProps {
  label: string;
  hint: string;
  path: string | null | undefined;
  detail?: string | null;
  loading: boolean;
  install: string;
}

function ToolRow({ label, hint, path, detail, loading, install }: ToolRowProps) {
  let status: React.ReactNode;
  if (loading) status = <span className="path">Checking…</span>;
  else if (path)
    status = (
      <span className="path tool-ok" title={path}>
        {detail ? `${detail} · ` : ""}
        {path}
      </span>
    );
  else
    status = (
      <span className="path tool-missing">
        Not found. Install with <code>{install}</code>
      </span>
    );
  return (
    <Row label={label} hint={hint}>
      {status}
    </Row>
  );
}
