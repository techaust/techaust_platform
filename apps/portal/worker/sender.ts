// How a sign-in link reaches a person (M1.6 LD1, M2.4b). `queueSender` puts one `portal.magic_link` email per link on the
// email queue; the jobs Worker's email consumer sends it (claim, suppression, staging allow-list, SES). The Worker never
// logs the URL (it is a credential). Tests inject a capturing sender through `createApp({ sender })`.
import type { EmailMessage } from "@techaust/core"; // types only: the zod schema stays out of this bundle

/**
 * One link: `to` is the address the person typed (already trimmed and lower-cased), `orgName` the organisation it opens,
 * `tokenHash` the SHA-256 of the link's token (the email's identity: two real requests are two emails) and `expiresAt`
 * when the link stops working (UTC ms: the consumer does not send a link that has expired while it waited).
 */
export type MagicLink = { to: string; orgName: string; url: string; tokenHash: string; expiresAt: number };

export interface MagicLinkSender {
  /** One link per organisation the address belongs to (one contact at two organisations gets two links). */
  send(links: MagicLink[]): Promise<void>;
}

/** The email-queue message for one link (the consumer renders `portal.magic_link` from `data`). */
export const magicLinkMessage = (l: MagicLink): EmailMessage => ({
  template: "portal.magic_link",
  to: l.to,
  data: { url: l.url, org_name: l.orgName, expires_at: String(l.expiresAt) },
  entity: { type: "magic_link", id: l.tokenHash },
});

/**
 * The real sender: one `sendBatch` for all of a request's links. The caller hands this promise to `ctx.waitUntil`, so the
 * response never waits for the queue (a known email must not answer later than an unknown one).
 */
export const queueSender = (env: Pick<Env, "EMAIL_QUEUE">): MagicLinkSender => ({
  async send(links) {
    await env.EMAIL_QUEUE.sendBatch(links.map((l) => ({ body: magicLinkMessage(l) })));
  },
});
