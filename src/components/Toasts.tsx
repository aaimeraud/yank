import { useSyncExternalStore } from "react";
import { notify } from "../lib/notify";
import { CloseIcon } from "./icons";

/** Renders the toasts pushed through `notify` (lib/notify.ts). */
export default function Toasts() {
  const toasts = useSyncExternalStore(notify.subscribe, notify.current);
  if (toasts.length === 0) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.kind}`}>
          <span className="toast-text">{toast.message}</span>
          <button
            className="toast-close"
            aria-label="Dismiss"
            onClick={() => notify.dismiss(toast.id)}
          >
            <CloseIcon size={10} />
          </button>
        </div>
      ))}
    </div>
  );
}
