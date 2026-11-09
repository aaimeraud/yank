import type { PlayerMode } from "../../hooks/usePlayer";

interface Props {
  mode: PlayerMode;
  problem: string;
  streaming: boolean;
  onRetry: () => void;
  onOpenExternally: () => void;
}

/** Over the picture when nothing can play: why, and what to do about it. */
export default function ProblemOverlay({ mode, problem, streaming, onRetry, onOpenExternally }: Props) {
  const short = streaming ? "Stream stopped" : "Cannot play here";
  return (
    <div className="vv-status vv-problem" role="alert">
      <span>{mode === "full" ? problem : short}</span>
      {streaming ? (
        <button onClick={onRetry}>Try again</button>
      ) : (
        <button onClick={onOpenExternally}>Open in default player</button>
      )}
    </div>
  );
}
