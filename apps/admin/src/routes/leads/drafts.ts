// What a person has typed on a lead's page and not saved yet: the note, an open contact edit and a changed pipeline
// form. The page reloads the lead after every save, stage move, reply or conversion; these drafts live above that
// reload, so a stage move or a pipeline save never wipes a half-written note or an open contact edit (review
// finding 4). Only "someone else changed this lead" drops the contact and pipeline drafts, because they were written
// against a version that no longer exists; the note is kept even then, since adding a note never conflicts.

export type Follow = { ownerId: string; date: string; note: string };
export type Contact = { name: string; email: string; phone: string; company: string; country: string };

export type Drafts = {
  note: string;
  /** The contact form while it is open; null when the contact is shown read-only. */
  contact: Contact | null;
  /** The pipeline form once it has been touched; null means it shows what is stored. */
  follow: Follow | null;
};

export type DraftAction =
  | { type: "note"; text: string }
  | { type: "contact"; value: Contact | null }
  | { type: "follow"; value: Follow | null }
  /** The lead was loaded again: after the person's own change, or after "Reload the latest" on a 409. */
  | { type: "reloaded"; cause: "own" | "stale" };

export const NO_DRAFTS: Drafts = { note: "", contact: null, follow: null };

export function drafts(state: Drafts, a: DraftAction): Drafts {
  switch (a.type) {
    case "note":
      return { ...state, note: a.text };
    case "contact":
      return { ...state, contact: a.value };
    case "follow":
      return { ...state, follow: a.value };
    case "reloaded":
      return a.cause === "own" ? state : { ...NO_DRAFTS, note: state.note };
  }
}
