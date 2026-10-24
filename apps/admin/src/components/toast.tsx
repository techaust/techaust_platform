// Toasts (docs/06 §5.3): success in a polite `status` region, errors in an `alert` region. Both regions are always
// in the page, so a new message is announced. A toast stays at least 6 s (errors 10 s), pauses while the pointer or
// focus is on it, and has a close button. A toast is never the only place an error appears: the screen that failed
// shows it too.
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Alert, CheckCircle, X } from "./icons.tsx";

type Tone = "success" | "error";
type Item = { id: number; tone: Tone; text: ReactNode };
type Push = (tone: Tone, text: ReactNode) => void;

const Ctx = createContext<Push | null>(null);

export function useToast(): Push {
  const push = useContext(Ctx);
  if (!push) throw new Error("useToast outside ToastProvider");
  return push;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const next = useRef(1);
  const push = useCallback<Push>((tone, text) => {
    const id = next.current++;
    setItems((list) => [...list.slice(-3), { id, tone, text }]);
  }, []);
  const remove = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);

  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="toasts">
        <div role="status" className="toasts__region">
          {items
            .filter((t) => t.tone === "success")
            .map((t) => (
              <ToastItem key={t.id} item={t} onDone={remove} />
            ))}
        </div>
        <div role="alert" className="toasts__region">
          {items
            .filter((t) => t.tone === "error")
            .map((t) => (
              <ToastItem key={t.id} item={t} onDone={remove} />
            ))}
        </div>
      </div>
    </Ctx.Provider>
  );
}

function ToastItem({ item, onDone }: { item: Item; onDone: (id: number) => void }) {
  const [paused, setPaused] = useState(false);
  const left = useRef(item.tone === "error" ? 10_000 : 6_000);
  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const t = setTimeout(() => onDone(item.id), left.current);
    return () => {
      clearTimeout(t);
      left.current = Math.max(1_500, left.current - (Date.now() - started));
    };
  }, [paused, item.id, onDone]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: pausing on hover/focus is a courtesy, not a control
    <div
      className={`toast toast--${item.tone}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="toast__icon">{item.tone === "success" ? <CheckCircle /> : <Alert />}</span>
      <div className="toast__text">{item.text}</div>
      <button
        type="button"
        className="icon-btn toast__close"
        aria-label="Dismiss"
        onClick={() => onDone(item.id)}
      >
        <X size={16} />
      </button>
    </div>
  );
}
