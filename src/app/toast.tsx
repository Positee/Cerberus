import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Check, TriangleAlert, X } from 'lucide-react';

/**
 * Toasts.
 *
 * A short word about something that already happened, at the bottom right.
 * It never asks a question and it never blocks. If a person must decide, use
 * the confirm dialog instead.
 *
 * The mark on the left is three bars, for the three heads. They light in turn
 * as the toast arrives, so the hound notices the thing before you do.
 */

export type ToastKind = 'done' | 'warn' | 'fail';

type Toast = {
  id: number;
  kind: ToastKind;
  message: string;
  /** Optional second line, for the detail that does not fit the message. */
  detail?: string;
};

type ToastInput = { kind?: ToastKind; message: string; detail?: string };

type ToastApi = {
  push: (input: ToastInput) => void;
  done: (message: string, detail?: string) => void;
  warn: (message: string, detail?: string) => void;
  fail: (message: string, detail?: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

/**
 * How long a toast stays, in milliseconds.
 *
 * Success goes quickly, because it only confirms what a person already meant
 * to do. Anything else stays twice as long, because it needs reading. Resting
 * a pointer on a toast holds it open, so these are floors and not limits.
 */
const LIFETIME: Record<ToastKind, number> = {
  done: 3000,
  warn: 6000,
  fail: 6000,
};

const ICON: Record<ToastKind, typeof Check> = {
  done: Check,
  warn: TriangleAlert,
  fail: TriangleAlert,
};

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast needs a ToastProvider above it.');
  return api;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback((input: ToastInput) => {
    const toast: Toast = {
      id: nextId.current,
      kind: input.kind ?? 'done',
      message: input.message,
      ...(input.detail ? { detail: input.detail } : {}),
    };
    nextId.current += 1;

    // Four at once is already a wall. The oldest makes way.
    setToasts((prev) => [...prev, toast].slice(-4));
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      push,
      done: (message, detail) => push({ kind: 'done', message, detail }),
      warn: (message, detail) => push({ kind: 'warn', message, detail }),
      fail: (message, detail) => push({ kind: 'fail', message, detail }),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-rail" aria-live="polite" aria-relevant="additions">
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const [held, setHeld] = useState(false);
  const Icon = ICON[toast.kind];

  // The timer pauses while a pointer rests on the toast, so a message cannot
  // vanish out from under somebody who is reading it.
  useEffect(() => {
    if (held) return;
    const timer = window.setTimeout(onDismiss, LIFETIME[toast.kind]);
    return () => window.clearTimeout(timer);
  }, [held, onDismiss, toast.kind]);

  return (
    <div
      className={`toast toast-${toast.kind}`}
      role={toast.kind === 'fail' ? 'alert' : 'status'}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      {/* Three heads. They light in turn as it arrives. */}
      <span className="toast-heads" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>

      <Icon size={15} className="toast-icon" aria-hidden="true" />

      <span className="toast-body">
        <strong>{toast.message}</strong>
        {toast.detail && <small>{toast.detail}</small>}
      </span>

      <button type="button" className="toast-close" onClick={onDismiss} aria-label="Dismiss">
        <X size={13} aria-hidden="true" />
      </button>
    </div>
  );
}
