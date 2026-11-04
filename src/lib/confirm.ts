// A native macOS confirmation sheet. Async, unlike window.confirm, so the
// webview keeps rendering (and playing video) while it is open.

import { ask } from "@tauri-apps/plugin-dialog";

export function confirmAction(
  message: string,
  { okLabel = "OK", destructive = false }: { okLabel?: string; destructive?: boolean } = {},
): Promise<boolean> {
  return ask(message, {
    title: "Yank",
    kind: destructive ? "warning" : "info",
    okLabel,
    cancelLabel: "Cancel",
  });
}
