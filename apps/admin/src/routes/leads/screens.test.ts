// The Leads screens' review fixes [ADM-LEAD-02, ADM-LEAD-04]: each board "Move to…" button has its own accessible name
// (finding 2), and unsaved drafts on a lead's page survive the reload after a stage move or a pipeline save (finding 4).
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import type { LeadItem } from "../../api.ts";
import {
  type Contact,
  contactPatch,
  type Drafts,
  drafts,
  type Follow,
  followPatch,
  NO_DRAFTS,
} from "./drafts.ts";
import { MoveMenu } from "./parts.tsx";

// The admin tests run in workerd without a DOM, so the test reads the element MoveMenu hands to MenuButton (which puts
// `hiddenText` in a visually hidden span after the visible text); the names in the browser are measured by the
// designer's Playwright pass.
type MenuProps = { label: string; text: string; hiddenText?: string };
const menuOf = (l: LeadItem) =>
  (MoveMenu({ lead: l, compact: true, onMove: () => {} }) as ReactElement<MenuProps>).props;
const nameOf = (p: MenuProps) => `${p.text}${p.hiddenText ?? ""}`;
const lead = (id: string, name: string, ref = `L-${id.toUpperCase()}`) =>
  ({ id, name, ref, stage: "new" }) as LeadItem;

describe('"Move to…" names (review finding 2, WCAG 2.4.6 and 2.5.3)', () => {
  const menus = [lead("a", "Sample Lead A"), lead("b", "Sample Lead B"), lead("c", "Sample Lead C")].map(
    menuOf,
  );
  const names = menus.map(nameOf);

  it("each card's button has its own name", () => {
    expect(new Set(names).size).toBe(names.length);
    expect(names[0]).toBe("Move to… (Sample Lead A, L-A)");
  });

  it("two leads with the same name still differ, by their ref (re-check R4)", () => {
    const same = [lead("x", "Sample Lead", "L-SAMPLE1"), lead("y", "Sample Lead", "L-SAMPLE2")];
    expect(same.map(menuOf).map(nameOf)).toEqual([
      "Move to… (Sample Lead, L-SAMPLE1)",
      "Move to… (Sample Lead, L-SAMPLE2)",
    ]);
  });

  it("the visible text starts every name, and the lead's name is hidden text after it", () => {
    for (const [i, m] of menus.entries()) {
      expect(m.text).toBe("Move to…");
      expect(m.hiddenText).toBe(` (Sample Lead ${"ABC"[i]}, L-${"ABC"[i]})`);
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

  const loaded = (s: Drafts, c: Contact, f: Follow) => drafts(s, { type: "loaded", contact: c, follow: f });

  it("a typed note and an open contact edit survive the reload after a stage move or a pipeline save", () => {
    let s = drafts(NO_DRAFTS, { type: "note", text: "Asked about the timeline" });
    s = drafts(s, { type: "contact", value: { ...contact, phone: "+91 00000 00000" }, base: contact });
    s = loaded(s, contact, follow);
    expect(s.note).toBe("Asked about the timeline");
    expect(s.contact?.value.phone).toBe("+91 00000 00000");
    expect(s.conflict).toBe(false);
  });

  it("a pipeline save clears only the pipeline draft", () => {
    let s = drafts(NO_DRAFTS, { type: "note", text: "Draft" });
    s = drafts(s, { type: "contact", value: contact, base: contact });
    s = drafts(s, { type: "follow", value: { ...follow, note: "Call on Monday" }, base: follow });
    s = drafts(s, { type: "follow", value: null, base: follow });
    s = loaded(s, contact, { ...follow, note: "Call on Monday" });
    expect(s).toEqual({
      note: "Draft",
      contact: { base: contact, value: contact },
      follow: null,
      conflict: false,
    });
  });

  it("the base is kept from when the draft started, not moved by typing", () => {
    let s = drafts(NO_DRAFTS, { type: "contact", value: { ...contact, phone: "+91 1" }, base: contact });
    s = drafts(s, {
      type: "contact",
      value: { ...contact, phone: "+91 12" },
      base: { ...contact, phone: "+91 1" },
    });
    expect(s.contact?.base).toEqual(contact);
  });

  it("a draft against v1, reloaded to v2 changed by someone else, sends nothing it didn't change (re-check R1)", () => {
    // v1: the contact form opens and the phone is changed. Someone else renames the lead and sets a next action
    // (v2); a stage move reloads the page.
    let s = drafts(NO_DRAFTS, {
      type: "contact",
      value: { ...contact, phone: "+91 00000 00000" },
      base: contact,
    });
    s = drafts(s, { type: "follow", value: { ...follow, ownerId: "member-1" }, base: follow });
    const v2: Contact = { ...contact, name: "Sample Lead A (renamed)" };
    const f2: Follow = { ...follow, date: "2026-11-09" };
    s = loaded(s, v2, f2);
    expect(s.conflict).toBe(false);
    expect(s.contact?.value).toEqual({ ...v2, phone: "+91 00000 00000" });
    expect(s.follow?.value).toEqual({ ...f2, ownerId: "member-1" });
    expect(s.contact && contactPatch(s.contact)).toEqual({ phone: "+91 00000 00000" });
    expect(s.follow && followPatch(s.follow)).toEqual({ ownerId: "member-1" });
  });

  it("someone else's change to a field the draft changed drops that draft and raises the notice; the note stays", () => {
    let s = drafts(NO_DRAFTS, { type: "note", text: "Asked about the timeline" });
    s = drafts(s, { type: "contact", value: { ...contact, phone: "+91 00000 00000" }, base: contact });
    s = drafts(s, { type: "follow", value: { ...follow, note: "Send the proposal" }, base: follow });
    s = loaded(s, { ...contact, phone: "+91 99999 99999" }, follow);
    expect(s.contact).toBeNull();
    expect(s.follow?.value.note).toBe("Send the proposal");
    expect(s.conflict).toBe(true);
    expect(s.note).toBe("Asked about the timeline");
  });

  it("the same change made by both is no conflict", () => {
    let s = drafts(NO_DRAFTS, {
      type: "contact",
      value: { ...contact, company: "Example Co" },
      base: contact,
    });
    s = loaded(s, { ...contact, company: "Example Co" }, follow);
    expect(s.conflict).toBe(false);
    expect(s.contact && contactPatch(s.contact)).toEqual({});
  });

  it("reloading the latest after a 409 or a conflict drops the contact and pipeline drafts but keeps the note", () => {
    let s = drafts(NO_DRAFTS, { type: "note", text: "Draft" });
    s = drafts(s, { type: "contact", value: contact, base: contact });
    s = drafts(s, { type: "follow", value: follow, base: follow });
    s = loaded(s, { ...contact, name: "x" }, follow);
    expect(drafts(s, { type: "reloaded-latest" })).toEqual({ ...NO_DRAFTS, note: "Draft" });
  });
});
