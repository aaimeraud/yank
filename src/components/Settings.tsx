interface Props {
  downloadDir: string | null;
  onPickFolder: () => void;
}

export default function Settings({ downloadDir, onPickFolder }: Props) {
  return (
    <section>
      <h2>Settings</h2>
      <div className="setting">
        <label>Downloads folder</label>
        <div className="row">
          <span>{downloadDir ?? "Not set"}</span>
          <button onClick={onPickFolder}>Choose…</button>
        </div>
      </div>
    </section>
  );
}