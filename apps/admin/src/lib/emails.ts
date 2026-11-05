// How the email log reads (M7.2; ADM-MAIL-01, ADM-MAIL-02; run file G2): a status's chip (icon, text and tone, never colour alone, docs/06 §5.5), the record an
// email belongs to as a link where the admin has a page for it, and the IST day a "Sent on or after" filter starts. Pure, so it is tested without a browser.
import { fromIst, parseIsoDate } from "@techaust/core/dates";
import type { PillTone } from "../components/display.tsx";

export type StatusLook = {
  tone: PillTone;
  icon: "clock" | "send" | "check" | "ban" | "alert" | "xCircle";
};

/** S12's statuses as chips: waiting grey, sent blue, delivered green, the refusals red, "Not sent" muted. */
export function emailStatusLook(status: string): StatusLook {
  switch (status) {
    case "queued":
    case "sending":
      return { tone: "neutral", icon: "clock" };
    case "sent":
      return { tone: "info", icon: "send" };
    case "delivered":
      return { tone: "success", icon: "check" };
    case "bounced":
      return { tone: "danger", icon: "ban" };
    case "complained":
      return { tone: "danger", icon: "alert" };
    case "failed":
      return { tone: "danger", icon: "xCircle" };
    default:
      return { tone: "muted", icon: "ban" };
  }
}

/**
 * What the log's "Sent" column shows for a status (M7.2 review 1, finding 15): the time only once the email left (sent, and the outcomes that follow a send);
 * "Queued" while it waits or is being handed over (its created time is when it was queued, never when it was sent); nothing for one that never left (failed or
 * not sent: the status says why).
 */
export function sentShown(status: string): "time" | "queued" | "none" {
  switch (status) {
    case "sent":
    case "delivered":
    case "bounced":
    case "complained":
      return "time";
    case "queued":
    case "sending":
      return "queued";
    default:
      return "none";
  }
}

/**
 * The admin page of the record an email was sent for, when there is one to open: an approval, or the proposal or estimate of an offer email (its entity is the
 * document). Other entities (a send, a reminder, a bell, a lead's reference) have no page of their own: null.
 */
export function emailRecordHref(template: string, entity: { type: string; id: string }): string | null {
  if (!entity.id) return null;
  if (entity.type === "approval") return `/approvals/${encodeURIComponent(entity.id)}`;
  if (entity.type === "document" && template.startsWith("offer."))
    return `/documents/${encodeURIComponent(entity.id)}`;
  return null;
}

/** The UTC ms an ISO day starts in IST, as the list's `since` (a string); empty for no day. */
export function sinceOf(iso: string): string {
  const d = iso ? parseIsoDate(iso) : null;
  return d ? String(fromIst(d)) : "";
}

/** The log's breadcrumbs: Settings › Email for a role that can open them (the Owner); none for Staff, who reads the log but not Settings. */
export const logCrumbs = (canSettings: boolean): { label: string; to: string }[] =>
  canSettings
    ? [
        { label: "Settings", to: "/settings" },
        { label: "Email", to: "/settings/email" },
      ]
    : [];

/** A full address, the shape the list's exact-recipient filter takes (the API lower-cases it). */
export const isAddress = (v: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) && v.trim().length <= 254;
