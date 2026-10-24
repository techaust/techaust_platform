// The Leads screens' review fixes [ADM-LEAD-02, ADM-LEAD-04]: each board "Move to…" button has its own accessible name
// (finding 2), and unsaved drafts on a lead's page survive the reload after a stage move or a pipeline save (finding 4).
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import type { LeadItem } from "../../api.ts";
import { type Contact, drafts, type Follow, NO_DRAFTS } from "./drafts.ts";
import { MoveMenu } from "./parts.tsx";

// The admin tests run in workerd without a DOM, so the test reads the element MoveMenu hands to MenuButton (which puts
// `hiddenText` in a visually hidden span after the visible text); the names in the browser are measured by the
// designer's Playwright pass.
type MenuProps = { label: string; text: string; hiddenText?: string };
const menuOf = (l: LeadItem) =>
  (MoveMenu({ lead: l, compact: true, onMove: () => {} }) as ReactElement<MenuProps>).props;
const nameOf = (p: MenuProps) => `${p.text}${p.hiddenText ?? ""}`;
const lead = (id: string, name: string) => ({ id, name, stage: "new" }) as LeadItem;

describe('"Move to…" names (review finding 2, WCAG 2.4.6 and 2.5.3)', () => {
  const menus = [lead("a", "Sample Lead A"), lead("b", "Sample Lead B"), lead("c", "Sample Lead C")].map(
    menuOf,
  );
  const names = menus.map(nameOf);

  it("each card's button has its own name", () => {
    expect(new Set(names).size).toBe(names.length);
    expect(names[0]).toBe("Move to… (Sample Lead A)");
  });

  it("the visible text starts every name, and the lead's name is hidden text after it", () => {
    for (const [i, m] of menus.entries()) {
      expect(m.text).toBe("Move to…");
      expect(m.hiddenText).toBe(` (Sample Lead ${"ABC"[i]})`);
      expect(names[i]?.startsWith(m.text)).toBe(true);
    }
  });

  it("the menu list is named for the lead as well", () => {
    expect(menus.map((m) => m.label)).toEqual([
      "Move Sample Lead A to",
      "Move Sample Lead B to",
      "Move Sample Lead C to",
    ]);
  });
});

describe("drafts on a lead's page (review finding 4)", () => {
  const contact: Contact = {
    name: "Sample Lead A",
    email: "a@example.test",
    phone: "",
    company: "",
    country: "IN",
  };
  const follow: Follow = { ownerId: "", date: "2026-11-02", note: "Call back" };

  it("a typed note and an open contact edit survive the reload after a stage move or a pipeline save", () => {
    let s = drafts(NO_DRAFTS, { type: "note", text: "Asked about the timeline" });
    s = drafts(s, { type: "contact", value: { ...contact, phone: "+91 00000 00000" } });
    s = drafts(s, { type: "reloaded", cause: "own" });
    expect(s.note).toBe("Asked about the timeline");
    expect(s.contact?.phone).toBe("+91 00000 00000");
  });

  it("a pipeline save clears only the pipeline draft", () => {
    let s = drafts(NO_DRAFTS, { type: "note", text: "Draft" });
    s = drafts(s, { type: "contact", value: contact });
    s = drafts(s, { type: "follow", value: follow });
    s = drafts(s, { type: "follow", value: null });
    s = drafts(s, { type: "reloaded", cause: "own" });
    expect(s).toEqual({ note: "Draft", contact, follow: null });
  });

  it("after a 409, reloading the latest drops the contact and pipeline drafts but keeps the note", () => {
    let s = drafts(NO_DRAFTS, { type: "note", text: "Draft" });
    s = drafts(s, { type: "contact", value: contact });
    s = drafts(s, { type: "follow", value: follow });
    expect(drafts(s, { type: "reloaded", cause: "stale" })).toEqual({ ...NO_DRAFTS, note: "Draft" });
  });
});
