// The users list's rows (ADM-AUTH-07): staff members from the keyset `GET /users` page, plus the pending invites of
// people who haven't joined yet (`GET /users/invites`, at most 50), shown as "Invited" on the first page. A member whose
// sign-in was reset is "invited" too and has a pending invite under the same email: the two become one row, and such
// an invite (the API flags it `existing_member`) never shows on its own, so a member on another page isn't listed twice.
import type { Role } from "@techaust/core/permissions";
import type { Invite, StaffMember } from "../api.ts";

export type UserStatus = StaffMember["status"];

export type UserRow = {
  key: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  lastLoginAt: number | null;
  createdAt: number;
  /** The staff member, when the person has an account (not for a pending invite of someone new). */
  member: StaffMember | null;
  /** Their pending invite, if any (revoke needs its hash). */
  invite: Invite | null;
};

export type UserFilters = { q: string; role: Role | null; status: UserStatus | null };

const fromMember = (m: StaffMember, invite: Invite | null): UserRow => ({
  key: `m:${m.id}`,
  name: m.name,
  email: m.email,
  role: m.role,
  status: m.status,
  lastLoginAt: m.last_login_at,
  createdAt: m.created_at,
  member: m,
  invite,
});

const fromInvite = (i: Invite): UserRow => ({
  key: `i:${i.token_hash}`,
  name: "",
  email: i.email,
  role: i.role,
  status: "invited",
  lastLoginAt: null,
  createdAt: i.created_at,
  member: null,
  invite: i,
});

/** Does a pending invite match the filters the API applied to the members (start of the email, role, status)? */
export function inviteMatches(i: Invite, f: UserFilters): boolean {
  if (f.role && i.role !== f.role) return false;
  if (f.status && f.status !== "invited") return false;
  const q = f.q.trim().toLowerCase();
  return q === "" || i.email.toLowerCase().startsWith(q);
}

/**
 * The rows of one page. Invites of people with no account go first on the first page only (they're few, and pending);
 * invites of members (a reset) are attached to that member's row. Newest invite wins when there are two.
 */
export function userRows(
  members: StaffMember[],
  invites: Invite[],
  f: UserFilters,
  firstPage: boolean,
): UserRow[] {
  const byEmail = new Map<string, Invite>();
  for (const i of [...invites].sort((a, b) => a.created_at - b.created_at)) byEmail.set(i.email, i);
  const memberEmails = new Set(members.map((m) => m.email));
  const pending = firstPage
    ? [...byEmail.values()]
        .filter((i) => !i.existing_member && !memberEmails.has(i.email) && inviteMatches(i, f))
        .sort((a, b) => b.created_at - a.created_at)
        .map(fromInvite)
    : [];
  return [...pending, ...members.map((m) => fromMember(m, byEmail.get(m.email) ?? null))];
}

/** How a row is named in titles and buttons: the name, or the email before they've set one. */
export const displayName = (r: { name: string; email: string }) => r.name || r.email;
