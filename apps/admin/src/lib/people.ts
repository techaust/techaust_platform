// Staff names in a menu (final sweep A20; ADM-TIME-01, ADM-LEAD-03): a person is their name, and when two people in the same list share a name, each of
// them also shows their work email, so "Log time for", the Owner filters and the Owner fields never offer two choices that read the same. Pure.

/** What a menu shows for a person with no name yet (the words every staff menu already uses). */
export const NAME_NOT_SET = "Name not set yet";

type Person = { id: string; name: string; email?: string | undefined };

const key = (name: string) => (name.trim() || NAME_NOT_SET).toLocaleLowerCase("en-IN");

/**
 * Each person's label by id: "Sam Rao", or "Sam Rao (sam.rao@techaust.com)" while someone else in `people` has the same name (compared without case or
 * outer spaces; two people without a name are the same "Name not set yet"). `you` adds "(you)" to that person instead: the reader knows their own email.
 */
export function personLabels(people: readonly Person[], you?: string | null): Map<string, string> {
  const count = new Map<string, number>();
  for (const p of people) count.set(key(p.name), (count.get(key(p.name)) ?? 0) + 1);
  const out = new Map<string, string>();
  for (const p of people) {
    const name = p.name.trim() || NAME_NOT_SET;
    if (you && p.id === you) out.set(p.id, `${name} (you)`);
    else if ((count.get(key(p.name)) ?? 0) > 1 && p.email) out.set(p.id, `${name} (${p.email})`);
    else out.set(p.id, name);
  }
  return out;
}

/** One person's label from `personLabels`, falling back to their name. */
export const personLabel = (labels: Map<string, string>, p: Person): string =>
  labels.get(p.id) ?? (p.name.trim() || NAME_NOT_SET);

/**
 * The work email to show under a closed menu for the chosen person, or null: only while another person in `people` has the same name
 * (the comparison `personLabels` uses), and never for `you` (their entry reads "(you)"). A closed select on a phone cuts a long
 * "Name (email)" label, so the email is shown whole below the field (lead, after final sweep round 3).
 */
export function sharedNameEmail(people: readonly Person[], id: string, you?: string | null): string | null {
  if (you && id === you) return null;
  const p = people.find((x) => x.id === id);
  if (!p?.email) return null;
  return people.some((x) => x.id !== id && key(x.name) === key(p.name)) ? p.email : null;
}
