// Copy that 07-N doesn't have yet (copy-documents.ts PENDING): every such sentence carries a visible "[Placeholder]" tag, so nobody
// mistakes it for final wording (the M4.5 brief). When the lead adds the line to 07-N and the owner approves it, it moves to `N` and
// the tag goes.
import { isPendingText } from "../lib/offers.ts";

export function Ph({ children }: { children: string }) {
  return (
    <>
      <span className="ph">[Placeholder]</span> {children}
    </>
  );
}

/** An error line from `errorText`: tagged when it is one of the pending lines. */
export function ErrorLine({ text }: { text: string }) {
  return isPendingText(text) ? <Ph>{text}</Ph> : text;
}
