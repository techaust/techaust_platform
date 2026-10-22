// @techaust/email: templates (HTML + text), header sanitising and the SES v2 client (docs/05 §11.1).
import { leadAcknowledgement, leadAlert, type Rendered } from "./templates.ts";

export * from "./headers.ts";
export * from "./templates.ts";
export * from "./transport.ts";

/** Senders (docs/05 §11.1): replies go to the matching Zoho mailbox. */
export const SENDERS = {
  hello: { name: "TecHaust Technologies", address: "hello@techaust.com" },
} as const;

type Data = Record<string, string>;

/**
 * Renders a queued message to its email and picks the sender. Unknown templates throw (the consumer acknowledges
 * and logs them `failed`: retrying cannot help).
 */
export function renderEmail(
  template: string,
  data: Data,
): Rendered & { from: { name: string; address: string }; replyTo: string } {
  const hello = { from: SENDERS.hello, replyTo: SENDERS.hello.address };
  const get = (k: string) => data[k] ?? "";
  switch (template) {
    case "lead.acknowledgement":
      return {
        ...hello,
        ...leadAcknowledgement({
          first_name: get("first_name"),
          service_name: get("service_name"),
          ref: get("ref"),
          cal_link: get("cal_link"),
        }),
      };
    case "lead.alert":
      return {
        ...hello,
        ...leadAlert({
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
          admin_url: get("admin_url"),
        }),
      };
    default:
      throw new Error(`Unknown email template: ${template}`);
  }
}
