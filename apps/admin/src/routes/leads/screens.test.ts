// The Leads screens' review fixes [ADM-LEAD-02, ADM-LEAD-04]: each board "Move to…" button has its own accessible name
// (finding 2), and unsaved drafts on a lead's page survive the reload after a stage move or a pipeline save (finding 4).
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import type { LeadItem } from "../../api.ts";
import { type Answers, answersPatch } from "./answers.tsx";
import {
  type Contact,
  contactPatch,
  type Drafts,
  drafts,
  type Follow,
  followPatch,
  hasConflict,
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
  const answers: Answers = { currency: "INR", band: "3l-7l", timeline: "asap" };

  const loaded = (s: Drafts, c: Contact, f: Follow, a: Answers = answers) =>
    drafts(s, { type: "loaded", contact: c, follow: f, answers: a });

  it("a typed note and an open contact edit survive the reload after a stage move or a pipeline save", () => {
    let s = drafts(NO_DRAFTS, { type: "note", text: "Asked about the timeline" });
    s = drafts(s, { type: "contact", value: { ...contact, phone: "+91 00000 00000" }, base: contact });
    s = loaded(s, contact, follow);
    expect(s.note).toBe("Asked about the timeline");
    expect(s.contact?.value.phone).toBe("+91 00000 00000");
    expect(hasConflict(s)).toBe(false);
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
      answers: null,
      conflict: { contact: false, follow: false, answers: false },
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
    expect(hasConflict(s)).toBe(false);
    expect(s.contact?.value).toEqual({ ...v2, phone: "+91 00000 00000" });
    expect(s.follow?.value).toEqual({ ...f2, ownerId: "member-1" });
    expect(s.contact && contactPatch(s.contact)).toEqual({ phone: "+91 00000 00000" });
    expect(s.follow && followPatch(s.follow)).toEqual({ ownerId: "member-1" });
  });

  it("someone else's change to a field the draft changed drops that field's edit and raises the notice; the note stays", () => {
    let s = drafts(NO_DRAFTS, { type: "note", text: "Asked about the timeline" });
    s = drafts(s, { type: "contact", value: { ...contact, phone: "+91 00000 00000" }, base: contact });
    s = drafts(s, { type: "follow", value: { ...follow, note: "Send the proposal" }, base: follow });
    s = loaded(s, { ...contact, phone: "+91 99999 99999" }, follow);
    expect(s.contact?.value.phone).toBe("+91 99999 99999");
    expect(s.contact && contactPatch(s.contact)).toEqual({});
    expect(s.follow?.value.note).toBe("Send the proposal");
    expect(hasConflict(s)).toBe(true);
    expect(s.note).toBe("Asked about the timeline");
  });

  it("a conflict drops only the clashing field: the person's other edits in that form stay", () => {
    let s = drafts(NO_DRAFTS, {
      type: "contact",
      value: { ...contact, phone: "+91 00000 00000", company: "New Co" },
      base: contact,
    });
    s = loaded(s, { ...contact, phone: "+91 99999 99999" }, follow);
    expect(hasConflict(s)).toBe(true);
    expect(s.contact && contactPatch(s.contact)).toEqual({ company: "New Co" });
  });

  it("closing the form (a save or a cancel) clears the conflict notice", () => {
    let s = drafts(NO_DRAFTS, {
      type: "contact",
      value: { ...contact, phone: "+91 00000 00000" },
      base: contact,
    });
    s = loaded(s, { ...contact, phone: "+91 99999 99999" }, follow);
    expect(hasConflict(s)).toBe(true);
    s = drafts(s, { type: "contact", value: null, base: contact });
    expect(hasConflict(s)).toBe(false);
  });

  it("closing the other form keeps the notice for the form that clashed", () => {
    let s = drafts(NO_DRAFTS, {
      type: "contact",
      value: { ...contact, phone: "+91 00000 00000" },
      base: contact,
    });
    s = drafts(s, { type: "follow", value: { ...follow, note: "Send the proposal" }, base: follow });
    s = loaded(s, { ...contact, phone: "+91 99999 99999" }, follow);
    s = drafts(s, { type: "follow", value: null, base: follow });
    expect(hasConflict(s)).toBe(true);
    s = drafts(s, { type: "contact", value: null, base: contact });
    expect(hasConflict(s)).toBe(false);
  });

  it("the same change made by both is no conflict", () => {
    let s = drafts(NO_DRAFTS, {
      type: "contact",
      value: { ...contact, company: "Example Co" },
      base: contact,
    });
    s = loaded(s, { ...contact, company: "Example Co" }, follow);
    expect(hasConflict(s)).toBe(false);
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

describe("a manual lead's quote-answers edit is a draft above the reload (FX-3 fix round 2, B)", () => {
  const contact: Contact = {
    name: "Sample Lead A",
    email: "a@example.test",
    phone: "",
    company: "",
    country: "IN",
  };
  const follow: Follow = { ownerId: "", date: "", note: "" };
  const answers: Answers = { currency: "INR", band: "3l-7l", timeline: "asap" };
  const loaded = (s: Drafts, a: Answers, f: Follow = follow) =>
    drafts(s, { type: "loaded", contact, follow: f, answers: a });
  const edit = (s: Drafts, value: Answers | null) => drafts(s, { type: "answers", value, base: answers });

  it('"Stay" after a convert: the reload keeps an unsaved answers edit and the next-action note', () => {
    // the person edits the timeline and the next-action note, converts, and stays; the convert's reload is a new copy of the lead
    let s = edit(NO_DRAFTS, answers);
    s = edit(s, { ...answers, timeline: "1-3-months" });
    s = drafts(s, { type: "follow", value: { ...follow, note: "Send the proposal" }, base: follow });
    s = loaded(s, answers);
    expect(s.answers?.value).toEqual({ ...answers, timeline: "1-3-months" });
    expect(s.follow?.value.note).toBe("Send the proposal");
    expect(hasConflict(s)).toBe(false);
    expect(s.answers && answersPatch(s.answers.base, s.answers.value)).toEqual({ timeline: "1-3-months" });
  });

  it("an open edit with nothing changed takes the stored answers; the base is kept from when the edit opened", () => {
    let s = edit(NO_DRAFTS, answers);
    s = loaded(s, { ...answers, timeline: "exploring" });
    expect(s.answers).toEqual({
      base: { ...answers, timeline: "exploring" },
      value: { ...answers, timeline: "exploring" },
    });
    expect(hasConflict(s)).toBe(false);
    let t = edit(NO_DRAFTS, { ...answers, band: "" });
    t = drafts(t, { type: "answers", value: { ...answers, band: "1l-3l" }, base: { ...answers, band: "" } });
    expect(t.answers?.base).toEqual(answers);
  });

  it("someone else's change to any answer, while the person changed one, drops the whole edit to theirs, with the notice", () => {
    // the person picks a new INR band; someone else switches the lead to USD meanwhile: the INR band never lands on USD
    let s = drafts(NO_DRAFTS, { type: "note", text: "Asked about the budget" });
    s = edit(s, { ...answers, band: "7l-15l" });
    const theirs: Answers = { currency: "USD", band: "", timeline: "asap" };
    s = loaded(s, theirs);
    expect(hasConflict(s)).toBe(true);
    expect(s.conflict.answers).toBe(true);
    expect(s.answers).toEqual({ base: theirs, value: theirs });
    expect(s.answers && answersPatch(s.answers.base, s.answers.value)).toEqual({});
    expect(s.note).toBe("Asked about the budget");
    // the same change made by both is no conflict
    let same = edit(NO_DRAFTS, { ...answers, timeline: "exploring" });
    same = loaded(same, { ...answers, timeline: "exploring" });
    expect(hasConflict(same)).toBe(false);
  });

  it("closing the edit (a save or a cancel) clears its notice; reloading the latest drops it, the note kept", () => {
    let s = edit(NO_DRAFTS, { ...answers, timeline: "1-3-months" });
    s = loaded(s, { ...answers, timeline: "exploring" });
    expect(hasConflict(s)).toBe(true);
    expect(hasConflict(edit(s, null))).toBe(false);
    expect(edit(s, null).answers).toBeNull();
    s = drafts(s, { type: "note", text: "Draft" });
    expect(drafts(s, { type: "reloaded-latest" })).toEqual({ ...NO_DRAFTS, note: "Draft" });
  });
});
