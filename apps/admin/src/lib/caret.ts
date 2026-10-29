// The caret kept where the person left it when a text box's value is changed from outside their typing (round 4 re-check, finding 2):
// the server's own edit merged into the section being typed in (`mergeServerEdit`) used to leave the caret at the end of the text.
// `shiftSelection` is pure (tested); `useKeptCaret` puts it on an <input> or <textarea>.
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef } from "react";

/**
 * Where a selection `[start, end]` in `before` stands once the text is `after`, with the change taken as one span (the longest common
 * start and end): a position before the span stays, a position after it moves by the length the span gained or lost, and a position
 * inside a replaced span goes to the end of the new text there. Text put in exactly at the caret goes after it (the person keeps typing
 * where they were).
 */
export function shiftSelection(
  before: string,
  after: string,
  start: number,
  end: number,
): { start: number; end: number } {
  const max = Math.min(before.length, after.length);
  let pre = 0;
  while (pre < max && before[pre] === after[pre]) pre++;
  let suf = 0;
  while (suf < max - pre && before[before.length - 1 - suf] === after[after.length - 1 - suf]) suf++;
  const oldEnd = before.length - suf;
  const newEnd = after.length - suf;
  const map = (p: number): number => {
    const at = Math.max(0, Math.min(p, before.length));
    if (at <= pre) return at;
    if (at >= oldEnd) return at + (newEnd - oldEnd);
    return newEnd;
  };
  return { start: map(start), end: map(end) };
}

type Box = HTMLInputElement | HTMLTextAreaElement;

/**
 * For a controlled text box: notes the person's caret on every edit and selection, and when `value` arrives from somewhere else while
 * the box has focus (the browser then puts the caret at the end), puts the caret back, shifted by any text inserted before it. A caret
 * moved with no key or mouse event on the box (a phone's selection handles, a space-bar swipe, voice control) is noted from the
 * document's `selectionchange` while the box has focus (round 5 re-check, L1).
 * Spread `onSelect` and `onFocus` on the box, call `noteEdit` in its `onChange`, and pass `ref`.
 */
export function useKeptCaret<T extends Box>(
  value: string,
): {
  ref: RefObject<T | null>;
  noteEdit: () => void;
  onSelect: () => void;
  onFocus: () => void;
} {
  const ref = useRef<T | null>(null);
  const last = useRef<{ value: string; start: number; end: number } | null>(null);
  const note = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    last.current = { value: el.value, start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 };
  }, []);
  useEffect(() => {
    // on the document, not the box: the box may mount after this hook does, and `selectionchange` on a text box is not fired everywhere
    const onChange = () => {
      const el = ref.current;
      if (el && el.ownerDocument.activeElement === el) note();
    };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, [note]);
  useLayoutEffect(() => {
    const el = ref.current;
    const was = last.current;
    if (!el || !was || was.value === value) return;
    if (el.ownerDocument.activeElement !== el) {
      last.current = null;
      return;
    }
    const sel = shiftSelection(was.value, value, was.start, was.end);
    el.setSelectionRange(sel.start, sel.end);
    last.current = { value, ...sel };
  }, [value]);
  return { ref, noteEdit: note, onSelect: note, onFocus: note };
}
