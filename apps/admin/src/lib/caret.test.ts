// The caret kept in place when the server's change is merged into a text being typed (round 4 re-check, finding 2) [ADM-PROP-02].
import { describe, expect, it } from "vitest";
import { shiftSelection } from "./caret.ts";
import { mergeServerEdit } from "./documents.ts";

describe("shiftSelection", () => {
  it("text put in before the caret moves it by that length; after it, or at it, leaves it", () => {
    // a part put into the service's block above the line being typed
    const before = "A\n\n**Beta**\nB excl\nTyping here";
    const after = "A\n\n**Beta**\nB assumes\nB excl\nTyping here";
    const at = before.indexOf("here");
    expect(shiftSelection(before, after, at, at)).toEqual({
      start: at + "B assumes\n".length,
      end: at + "B assumes\n".length,
    });
    // a block appended after what was typed: the caret stays where the person is typing
    expect(shiftSelection("Typed", "Typed\n\n**Beta**\nB", 5, 5)).toEqual({ start: 5, end: 5 });
    expect(shiftSelection("Typed", "Typed\n\n**Beta**\nB", 2, 4)).toEqual({ start: 2, end: 4 });
  });

  it("a selection across the change keeps both ends in place around it; inside a replaced span goes to its end", () => {
    const before = "Signed by {{client.contact}}. Typing";
    const after = "Signed by Asha Rao. Typing";
    const end = before.length;
    expect(shiftSelection(before, after, 0, end)).toEqual({ start: 0, end: after.length });
    const inside = before.indexOf("client");
    expect(shiftSelection(before, after, inside, inside)).toEqual({
      start: "Signed by Asha Rao".length,
      end: "Signed by Asha Rao".length,
    });
    // text taken out before the caret moves it back
    expect(shiftSelection("abcXYZdef", "abcdef", 8, 8)).toEqual({ start: 5, end: 5 });
  });

  it("no change keeps the selection; out-of-range positions are clamped", () => {
    expect(shiftSelection("same", "same", 2, 3)).toEqual({ start: 2, end: 3 });
    expect(shiftSelection("ab", "abc", 99, -4)).toEqual({ start: 2, end: 0 });
  });

  it("with mergeServerEdit: the caret in the typed text follows what the server put before it", () => {
    const sent = "A assumes\n\n**Beta**\nB excl";
    const server = "A assumes\n\n**Beta**\nB assumes\nB excl";
    const typed = `${sent}\nMy note`;
    const merged = mergeServerEdit(sent, server, typed) as string;
    expect(merged).toBe(`${server}\nMy note`);
    const caret = typed.length;
    expect(shiftSelection(typed, merged, caret, caret)).toEqual({ start: merged.length, end: merged.length });
  });
});
