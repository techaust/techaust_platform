// How a sign-in link reaches a person (M1.6, LD1). Until M2.4 plugs in the email queue there is NO implementation that
// sends anything: the default does nothing at all (it doesn't log either: the URL is a credential), and the links
// the owner needs for the staging check come from `pnpm portal:link`, which is run by the lead and audit-logged.
// Tests inject a capturing sender through `createApp({ sender })`.

/** One link: `to` is the address the person typed (already trimmed and lower-cased), `orgName` the organisation it opens. */
export type MagicLink = { to: string; orgName: string; url: string };

export interface MagicLinkSender {
  /** One link per organisation the address belongs to (one contact at two organisations gets two links). */
  send(links: MagicLink[]): Promise<void>;
}

/** The only sender M1.6 ships: it does nothing. */
export const noSender: MagicLinkSender = {
  async send() {},
};
