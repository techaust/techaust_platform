// @techaust/email: templates (HTML + text), header sanitising and the SES v2 client (docs/05 §11.1).
import {
  type LayoutOptions,
  leadAcknowledgement,
  leadAlert,
  portalMagicLink,
  type Rendered,
  staffLockout,
  staffLockoutOwner,
  staffNewDevice,
  staffTwoFaChange,
} from "./templates.ts";

export * from "./headers.ts";
export * from "./templates.ts";
export * from "./transport.ts";

/**
 * Senders (docs/05 §11.1): replies go to the matching Zoho mailbox. `noReply` sends the sign-in link and the staff security
 * emails (04 §0 Q-P3-5); replies to them go to `contact@techaust.com` (owner, 2026-10-23).
 */
export const SENDERS = {
  hello: { name: "TecHaust Technologies", address: "hello@techaust.com" },
  noReply: { name: "TecHaust Technologies", address: "no-reply@techaust.com" },
} as const;

/** Where a reply to a `no-reply@` email goes (owner, 2026-10-23). */
export const NO_REPLY_REPLY_TO = "contact@techaust.com";

type Data = Record<string, string>;

const who = (get: (k: string) => string) => ({ name: get("name"), first_name: get("first_name") });

/**
 * Renders a queued message to its email and picks the sender. Unknown templates throw (the consumer acknowledges
 * and logs them `failed`: retrying cannot help).
 */
export function renderEmail(
  template: string,
  data: Data,
  opts: LayoutOptions,
): Rendered & { from: { name: string; address: string }; replyTo: string } {
  const hello = { from: SENDERS.hello, replyTo: SENDERS.hello.address };
  const noReply = { from: SENDERS.noReply, replyTo: NO_REPLY_REPLY_TO };
  const get = (k: string) => data[k] ?? "";
  switch (template) {
    case "lead.acknowledgement":
      return {
        ...hello,
        ...leadAcknowledgement(
          {
            first_name: get("first_name"),
            service_name: get("service_name"),
            ref: get("ref"),
            cal_link: get("cal_link"),
          },
          opts,
        ),
      };
    case "lead.alert":
      return {
        ...hello,
        ...leadAlert(
          {
            ref: get("ref"),
            service_name: get("service_name"),
            budget_band: get("budget_band"),
            country: get("country"),
            name: get("name"),
            email: get("email"),
            phone: get("phone"),
            company: get("company"),
            timeline: get("timeline"),
            currency: get("currency"),
            tools: get("tools"),
            call_window: get("call_window"),
            message: get("message"),
            source_page: get("source_page"),
            type: get("type"),
            plan: get("plan"),
            admin_url: get("admin_url"),
            failed_queue: get("failed_queue"),
          },
          opts,
        ),
      };
    case "portal.magic_link":
      return {
        ...noReply,
        ...portalMagicLink(
          {
            url: get("url"),
            org_name: get("org_name"),
            expires_at: get("expires_at"),
            accounts: get("accounts"),
          },
          opts,
        ),
      };
    case "staff.new_device":
      return {
        ...noReply,
        ...staffNewDevice(
          {
            ...who(get),
            time: get("time"),
            device: get("device"),
            location: get("location"),
          },
          opts,
        ),
      };
    case "staff.2fa_change":
      return {
        ...noReply,
        ...staffTwoFaChange({ ...who(get), time: get("time"), change: get("change") }, opts),
      };
    case "staff.lockout":
      return { ...noReply, ...staffLockout({ ...who(get), time: get("time") }, opts) };
    case "staff.lockout_owner":
      return {
        ...noReply,
        ...staffLockoutOwner(
          {
            ...who(get),
            time: get("time"),
            member_name: get("member_name"),
            admin_url: get("admin_url"),
          },
          opts,
        ),
      };
    default:
      throw new Error(`Unknown email template: ${template}`);
  }
}
