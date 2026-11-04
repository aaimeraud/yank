// A tiny global store for toasts. Any module can call notify.error(...)
// without threading callbacks through props; <Toasts /> renders the list.
// Replaces window.alert, which blocks the whole window.

export type ToastKind = "info" | "error";

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

type Listener = (toasts: Toast[]) => void;

/** How long a toast stays, in ms. Errors stay longer: they need reading. */
export const TOAST_MS: Record<ToastKind, number> = { info: 3500, error: 8000 };
const MAX_TOASTS = 4;

export function createNotifier(schedule: (fn: () => void, ms: number) => unknown = setTimeout) {
  let toasts: Toast[] = [];
  let nextId = 1;
  const listeners = new Set<Listener>();

  const publish = () => listeners.forEach((listener) => listener(toasts));

  const dismiss = (id: number) => {
    const next = toasts.filter((toast) => toast.id !== id);
    if (next.length === toasts.length) return;
    toasts = next;
    publish();
  };

  const push = (kind: ToastKind, message: string) => {
    const toast = { id: nextId++, kind, message };
    // Oldest drop first, so a burst of failures cannot fill the screen.
    toasts = [...toasts, toast].slice(-MAX_TOASTS);
    publish();
    schedule(() => dismiss(toast.id), TOAST_MS[kind]);
    return toast.id;
  };

  return {
    info: (message: string) => push("info", message),
    error: (message: string) => push("error", message),
    dismiss,
    current: () => toasts,
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const notify = createNotifier();

/** Text for anything a promise can reject with (Tauri sends strings). */
export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Like `attempt`, for actions whose caller only needs to know it worked. */
export async function succeeds(action: () => Promise<unknown>): Promise<boolean> {
  try {
    await action();
    return true;
  } catch (error) {
    notify.error(errorMessage(error));
    return false;
  }
}

/** Run an action and turn a rejection into an error toast. */
export async function attempt<T>(action: () => Promise<T>): Promise<T | undefined> {
  try {
    return await action();
  } catch (error) {
    notify.error(errorMessage(error));
    return undefined;
  }
}
