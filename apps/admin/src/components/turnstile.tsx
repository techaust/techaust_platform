// The Turnstile check on the sign-in screen (M2.4b, ADM-AUTH-06): a managed widget rendered explicitly by the shared
// loader in @techaust/auth/client, with this build's public site key. The box holds the widget's height while the script
// loads, so the button under it doesn't jump. The parent keeps the widget (token, reset) through `widgetRef`.
import {
  createTurnstileWidget,
  sizeFor,
  type TurnstileState,
  type TurnstileWidget,
} from "@techaust/auth/client";
import { type RefObject, useEffect, useRef, useState } from "react";

export function TurnstileBox({
  action,
  widgetRef,
}: {
  action: string;
  widgetRef: RefObject<TurnstileWidget | null>;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<TurnstileState>("loading");
  const [size, setSize] = useState<"flexible" | "compact">("flexible");
  // biome-ignore lint/correctness/useExhaustiveDependencies: one widget per mount; the ref objects are stable
  useEffect(() => {
    if (!box.current) return;
    setSize(sizeFor(box.current));
    const w = createTurnstileWidget(box.current, {
      siteKey: __TURNSTILE_SITE_KEY__,
      action,
      onState: setState,
    });
    widgetRef.current = w;
    return () => {
      w.remove();
      if (widgetRef.current === w) widgetRef.current = null;
    };
  }, [action]);
  return <div ref={box} className="turnstile" data-state={state} data-size={size} />;
}
