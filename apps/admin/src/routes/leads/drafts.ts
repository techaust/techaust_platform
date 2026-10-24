// What a person has typed on a lead's page and not saved yet: the note, an open contact edit and a changed pipeline
// form. The page reloads the lead after every save, stage move, reply or conversion; these drafts live above that
// reload, so a stage move or a pipeline save never wipes a half-written note or an open contact edit (review
// finding 4).
//
// Each contact or pipeline draft keeps the values it was started from (its base). A save sends only the fields whose
// value differs from that base, so a field the person didn't touch is never sent back over someone else's change
// (re-check R1). When the lead is loaded again, `rebase` moves every untouched field to the stored value; if a field
// the person changed was also changed in the store by someone else, that draft is dropped and the page shows the
// "Someone else changed this lead." notice. The note has no base and always survives: adding a note never conflicts.
import type { LeadPatch } from "../../api.ts";
import { dateToMs } from "../../lib/leads.ts";

export type Follow = { ownerId: string; date: string; note: string };
export type Contact = { name: string; email: string; phone: string; company: string; country: string };

/** A form's draft: what it was started from and what it holds now. */
export type Draft<T> = { base: T; value: T };

export type Drafts = {
  note: string;
  /** The contact form while it is open; null when the contact is shown read-only. */
  contact: Draft<Contact> | null;
  /** The pipeline form once it has been touched; null means it shows what is stored. */
  follow: Draft<Follow> | null;
  /** A reload found someone else's change in a field a draft held; the draft was dropped. */
  conflict: boolean;
};

export type DraftAction =
  | { type: "note"; text: string }
  /** `base` is what is stored now; it is kept only when the draft starts, never moved by later typing. */
  | { type: "contact"; value: Contact | null; base: Contact }
  | { type: "follow"; value: Follow | null; base: Follow }
  /** A fresh copy of the lead arrived: carry the drafts onto it (see `rebase`). */
  | { type: "loaded"; contact: Contact; follow: Follow }
  /** "Reload the latest" after a 409 or a conflict: start again from what is stored, keeping only the note. */
  | { type: "reloaded-latest" };

export const NO_DRAFTS: Drafts = { note: "", contact: null, follow: null, conflict: false };

function start<T>(current: Draft<T> | null, value: T | null, base: T): Draft<T> | null {
  return value === null ? null : { base: current?.base ?? base, value };
}

/** The fields a draft changed from its base. */
export function changedFields<T extends Record<string, string>>(d: Draft<T>): (keyof T)[] {
  return (Object.keys(d.value) as (keyof T)[]).filter((k) => d.value[k] !== d.base[k]);
}

/**
 * Carries a draft onto a fresh copy of what is stored. Untouched fields take the stored value; a field the person
 * changed keeps their value. Null with `conflict` when someone else changed a field the person changed too (to a
 * different value).
 */
export function rebase<T extends Record<string, string>>(
  d: Draft<T> | null,
  now: T,
): { draft: Draft<T> | null; conflict: boolean } {
  if (d === null) return { draft: null, conflict: false };
  const changed = changedFields(d);
  if (changed.some((k) => now[k] !== d.base[k] && now[k] !== d.value[k]))
    return { draft: null, conflict: true };
  const value = { ...now };
  for (const k of changed) value[k] = d.value[k];
  return { draft: { base: now, value }, conflict: false };
}

const nullable = (v: string) => (v.trim() ? v.trim() : null);
type Patch = Omit<LeadPatch, "expectedUpdatedAt">;

/** What a pipeline save sends: only the fields that differ from the draft's base (re-check R1). */
export function followPatch({ base, value }: Draft<Follow>): Patch {
  const patch: Patch = {};
  if (value.ownerId !== base.ownerId) patch.ownerId = value.ownerId || null;
  if (value.date !== base.date) patch.nextActionAt = value.date ? dateToMs(value.date) : null;
  if (value.note !== base.note) patch.nextActionNote = nullable(value.note);
  return patch;
}

/** What a contact save sends: only the fields that differ from the draft's base (re-check R1). */
export function contactPatch({ base, value }: Draft<Contact>): Patch {
  const patch: Patch = {};
  if (value.name.trim() !== base.name) patch.name = value.name.trim();
  if (value.email.trim().toLowerCase() !== base.email) patch.email = value.email.trim();
  if (value.phone.trim() !== base.phone) patch.phone = nullable(value.phone);
  if (value.company.trim() !== base.company) patch.company = nullable(value.company);
  if (value.country !== base.country) patch.country = value.country || null;
  return patch;
}

export function drafts(state: Drafts, a: DraftAction): Drafts {
  switch (a.type) {
    case "note":
      return { ...state, note: a.text };
    case "contact":
      return { ...state, contact: start(state.contact, a.value, a.base) };
    case "follow":
      return { ...state, follow: start(state.follow, a.value, a.base) };
    case "loaded": {
      const contact = rebase(state.contact, a.contact);
      const follow = rebase(state.follow, a.follow);
      return {
        note: state.note,
        contact: contact.draft,
        follow: follow.draft,
        conflict: state.conflict || contact.conflict || follow.conflict,
      };
    }
    case "reloaded-latest":
      return { ...NO_DRAFTS, note: state.note };
  }
}
