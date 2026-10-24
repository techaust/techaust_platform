// Email templates: typed functions returning { subject, html, text }. Subjects and text bodies are word for word from
// docs/07 §8; the HTML says the same words in the brand layout of docs/06 §6:
//   - 600 px, one column, layout tables (role="presentation"), inline styles from the email tokens of @techaust/ui
//     (generated from tokens.json), Archivo with Arial and Helvetica behind it (web fonts aren't relied on)
//   - the header: the primary lockup as a hosted PNG (@2x, 140 px wide, alt "TecHaust Technologies"; never live text
//     in place of the wordmark) on its white plate (the "badge", which survives clients that force dark mode by
//     inverting colours), then a 2 px verdigris rule
//   - dark mode where the client supports it (Apple Mail, iOS, Outlook for Mac; Outlook.com through [data-ogsc]/
//     [data-ogsb]): ink surfaces, mist text and the dark lockup; elsewhere the light version with the badge
//   - a VML button for Outlook on Windows, an ordinary link everywhere else, the plain URL repeated under it
//   - the 07 §8 footer line
// Variables are strings; every one is escaped before it reaches HTML.
import { emailTokens as T } from "@techaust/ui/email";
import { escapeHtml, headerValue } from "./headers.ts";

export type Rendered = { subject: string; html: string; text: string };

/** NEW copy (M2.4 review fix): the line at the top of a lead alert that came from a dead-letter queue. */
const DLQ_LEAD_LINE =
  "This lead failed after 5 tries and may be missing from the admin. Its details are below.";

/** docs/07 §8 footer, on every email. */
export const FOOTER = "TecHaust Technologies · Balurghat, West Bengal, India · contact@techaust.com";

export type AcknowledgementData = {
  first_name: string;
  service_name: string;
  ref: string;
  /** The Cal.com link; empty while the owner has none (the sentence is then left out). */
  cal_link?: string;
};

export type AlertData = {
  ref: string;
  service_name: string;
  budget_band: string;
  country: string;
  /** Summary fields; empty ones are left out. */
  name: string;
  email: string;
  phone?: string;
  company?: string;
  timeline?: string;
  currency?: string;
  tools?: string;
  call_window?: string;
  message: string;
  source_page?: string;
  /** The quote link's `?type=` and `?plan=` (for example "pilot", "essential"). */
  type?: string;
  plan?: string;
  /** "Open in admin" target (the admin home until M3). */
  admin_url: string;
  /**
   * Set when the lead came from a dead-letter queue (it was not saved after 5 tries): the queue's name. The subject
   * then starts with "Failed after 5 tries (<queue>):" and the body says the lead may be missing from the admin.
   */
  failed_queue?: string;
};

/**
 * `assetBase`: where the email logos are hosted, the website's /brand/ path with a trailing slash (the web build copies
 * the logos there from packages/ui/brand). It differs per environment, so the caller passes it from the Worker's
 * `EMAIL_ASSET_BASE` variable; this package holds no host name. The logo file names are written with the "@" already
 * percent-encoded (`%402x`): Workers static assets redirect the raw "@" to that form, and some mail clients do not
 * follow redirects for images.
 */
export type LayoutOptions = { assetBase: string };

export type DlqAlertData = {
  queue: string;
  admin_url: string;
  /** What was dead-lettered, when the message could be read: an email's template and its lead reference. */
  template?: string | undefined;
  ref?: string | undefined;
};

const C = T.color;
const D = T.colorDark;
const FONT = T.font.sans;
const W = T.width;
const PAD = 40;
const e = escapeHtml;

/** Text with its line breaks kept (escaped first). */
const lines = (v: string) => e(v).replace(/\r\n?|\n/g, "<br>");

/** Dark mode for the clients that support it. Classes, never ids, so one style block serves every email. */
const STYLE = `
:root { color-scheme: light dark; supported-color-schemes: light dark; }
body { margin: 0; padding: 0; width: 100% !important; -webkit-text-size-adjust: 100%; }
table { border-collapse: collapse; }
img { border: 0; outline: none; text-decoration: none; }
.logo-dark { display: none; }
@media (max-width: 620px) {
  .px { padding-left: 20px !important; padding-right: 20px !important; }
  .px-logo { padding-left: 8px !important; }
  .k { width: 112px !important; }
}
@media (prefers-color-scheme: dark) {
  .bg { background-color: ${D.bg} !important; }
  .card { background-color: ${D.surface} !important; }
  .tx { color: ${D.text} !important; }
  .mu { color: ${D.textMuted} !important; }
  .ln { border-color: ${D.border} !important; }
  .ac { background-color: ${D.accentDecor} !important; }
  .lk { color: ${D.textAccent} !important; }
  .bt { background-color: ${D.btnPrimaryBg} !important; color: ${D.btnPrimaryFg} !important; }
  .logo-light { display: none !important; }
  .logo-dark { display: block !important; max-height: none !important; overflow: visible !important; }
}
[data-ogsb] .bg { background-color: ${D.bg} !important; }
[data-ogsb] .card { background-color: ${D.surface} !important; }
[data-ogsc] .tx { color: ${D.text} !important; }
[data-ogsc] .mu { color: ${D.textMuted} !important; }
[data-ogsc] .lk { color: ${D.textAccent} !important; }
`;

const textStyle = (size: number, lh: number, color: string, extra = "") =>
  `margin:0;font-family:${FONT};font-size:${size}px;line-height:${lh};color:${color};${extra}`;
const bodyP = (html: string, extra = "", muted = false) =>
  `<p class="${muted ? "mu" : "tx"}" style="${textStyle(T.text.body.size, T.text.body.lineHeight, muted ? C.textMuted : C.text, `padding:0 0 16px;${extra}`)}">${html}</p>`;
const heading = (html: string) =>
  `<h1 class="tx" style="${textStyle(T.text.h1.size, T.text.h1.lineHeight, C.text, "padding:0 0 16px;font-weight:600;")}">${html}</h1>`;

/** The primary button (06 §6: verdigris, white text, 48 px) with the plain URL under it. */
function button(label: string, url: string): string {
  const href = e(url);
  const h = T.buttonHeight;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 12px;">
<tr><td>
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:${h}px;v-text-anchor:middle;width:200px;" arcsize="17%" stroke="f" fillcolor="${C.btnPrimaryBg}"><w:anchorlock/><center style="color:${C.btnPrimaryFg};font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">${e(label)}</center></v:roundrect><![endif]-->
<!--[if !mso]><!-- --><a href="${href}" class="bt" style="display:inline-block;min-width:152px;padding:0 24px;height:${h}px;line-height:${h}px;border-radius:${T.radius}px;background-color:${C.btnPrimaryBg};color:${C.btnPrimaryFg};font-family:${FONT};font-size:16px;font-weight:600;text-align:center;text-decoration:none;">${e(label)}</a><!--<![endif]-->
</td></tr>
</table>
<p class="mu" style="${textStyle(T.text.sm.size, T.text.sm.lineHeight, C.textMuted, "padding:0 0 16px;word-break:break-all;")}"><a href="${href}" class="lk" style="color:${C.textAccent};text-decoration:underline;">${href}</a></p>`;
}

/** The brand layout around a body (already HTML). `title` is the document title (the subject). */
function layout(title: string, inner: string, opts: LayoutOptions): string {
  const base = opts.assetBase;
  const alt = "TecHaust Technologies";
  const altStyle = `font-family:${FONT};font-size:16px;font-weight:600;color:${C.text};`;
  return `<!doctype html>
<html lang="en-IN" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${e(title)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>${STYLE}</style>
</head>
<body class="bg" style="margin:0;padding:0;background-color:${C.bg};">
<table role="presentation" class="bg" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.bg};">
<tr><td align="center" style="padding:32px 12px;">
<!--[if mso]><table role="presentation" width="${W}" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" class="card" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.surface}" style="max-width:${W}px;background-color:${C.surface};border-radius:${T.radius}px;">
<tr><td class="px px-logo" style="padding:28px ${PAD}px 0 ${PAD - 12}px;">
<img class="logo-light" src="${e(base)}logo-email-badge%402x.png" width="164" height="44" alt="${alt}" style="display:block;width:164px;height:44px;${altStyle}">
<!--[if !mso]><!-- --><img class="logo-dark" src="${e(base)}logo-email-dark%402x.png" width="${T.logoWidth}" alt="${alt}" style="display:none;max-height:0;overflow:hidden;width:${T.logoWidth}px;height:auto;margin:12px 0 12px 12px;${altStyle}color:${D.text};"><!--<![endif]-->
</td></tr>
<tr><td class="px" style="padding:16px ${PAD}px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="ac" height="2" style="height:2px;line-height:2px;font-size:0;background-color:${C.btnPrimaryBg};">&nbsp;</td></tr></table>
</td></tr>
<tr><td class="px" style="padding:32px ${PAD}px 16px;">
${inner}
</td></tr>
<tr><td class="px" style="padding:0 ${PAD}px 32px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="ln" style="border-top:1px solid ${C.border};padding-top:16px;">
<p class="mu" style="${textStyle(T.text.caption.size, T.text.caption.lineHeight, C.textMuted)}">${e(FOOTER)}</p>
</td></tr></table>
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>
`;
}

/** Lead acknowledgement (to the visitor, from hello@). */
export function leadAcknowledgement(d: AcknowledgementData, opts: LayoutOptions): Rendered {
  const subject = headerValue(`We've received your request (${d.ref})`);
  const call = d.cal_link ? ` If you'd like to pick a call time now: ${d.cal_link}.` : "";
  const body =
    `Hi ${d.first_name}, thanks for getting in touch about ${d.service_name}. ` +
    `We'll reply within one business day (Mon–Sat, 10:00–19:00 IST).${call} Your reference: ${d.ref}. — TecHaust Technologies`;
  const callHtml = d.cal_link
    ? ` If you'd like to pick a call time now: <a href="${e(d.cal_link)}" class="lk" style="color:${C.textAccent};text-decoration:underline;">${e(d.cal_link)}</a>.`
    : "";
  const ref = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;"><tr>
<td class="ac" width="4" style="width:4px;background-color:${C.btnPrimaryBg};font-size:0;line-height:0;">&nbsp;</td>
<td style="padding:4px 0 4px 16px;"><p class="tx" style="${textStyle(T.text.body.size, T.text.body.lineHeight, C.text)}">Your reference: <strong style="font-size:${T.text.h2.size}px;letter-spacing:0.04em;white-space:nowrap;">${e(d.ref)}</strong>.</p></td>
</tr></table>`;
  const html = layout(
    subject,
    heading(e(`We've received your request`)) +
      bodyP(`Hi ${e(d.first_name)}, thanks for getting in touch about ${e(d.service_name)}.`) +
      bodyP(`We'll reply within one business day (Mon–Sat, 10:00–19:00 IST).${callHtml}`) +
      ref +
      bodyP("— TecHaust Technologies", "padding-bottom:0;"),
    opts,
  );
  return { subject, html, text: `${body}\n\n${FOOTER}\n` };
}

/** Internal lead alert (to LEAD_ALERT_TO). */
export function leadAlert(d: AlertData, opts: LayoutOptions): Rendered {
  const failed = d.failed_queue ? `Failed after 5 tries (${d.failed_queue}): ` : "";
  const subject = headerValue(
    `${failed}New lead ${d.ref}: ${d.service_name} · ${d.budget_band} · ${d.country}`,
  );
  const failedLine = d.failed_queue ? DLQ_LEAD_LINE : "";
  const all: [string, string | undefined][] = [
    ["Reference", d.ref],
    ["Service", d.service_name],
    ["Type", d.type],
    ["Plan", d.plan],
    ["Budget", d.budget_band],
    ["Country", d.country],
    ["Name", d.name],
    ["Email", d.email],
    ["Phone", d.phone],
    ["Company", d.company],
    ["Timeline", d.timeline],
    ["Currency", d.currency],
    ["Tools", d.tools],
    ["Best time for a call", d.call_window],
    ["Message", d.message],
    ["Page", d.source_page],
  ];
  const rows = all.filter((l): l is [string, string] => !!l[1]);
  const text = `${failedLine ? `${failedLine}\n\n` : ""}${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\nOpen in admin: ${d.admin_url}\n\n${FOOTER}\n`;
  const cell = `border-top:1px solid ${C.border};padding:10px 0;vertical-align:top;`;
  const table = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;border-bottom:1px solid ${C.border};" class="ln">
${rows
  .map(
    ([k, v]) => `<tr>
<td class="ln k" width="152" style="${cell}width:152px;padding-right:16px;"><p class="mu" style="${textStyle(T.text.sm.size, T.text.sm.lineHeight, C.textMuted, "font-weight:500;padding-top:2px;")}">${e(k)}</p></td>
<td class="ln" style="${cell}"><p class="tx" style="${textStyle(T.text.body.size, T.text.body.lineHeight, C.text, "word-break:break-word;")}">${lines(v)}</p></td>
</tr>`,
  )
  .join("\n")}
</table>`;
  const html = layout(
    subject,
    heading(e(`New lead ${d.ref}`)) +
      (failedLine ? bodyP(e(failedLine)) : "") +
      bodyP(e(`${d.service_name} · ${d.budget_band} · ${d.country}`), "", true) +
      table +
      button("Open in admin", d.admin_url),
    opts,
  );
  return { subject, html, text };
}

/** Internal "a lead or email failed after 5 tries" alert (DLQ consumers; sent directly, not through the queue). */
export function dlqAlert(d: DlqAlertData, opts: LayoutOptions): Rendered {
  const line = "A lead or email failed after 5 tries: open the admin.";
  // What failed, when the dead-lettered message could be read: the email's template and its lead reference (no
  // address or message text).
  const what = [d.template ? `Email: ${d.template}` : "", d.ref ? `Lead: ${d.ref}` : ""].filter(Boolean);
  const subject = headerValue(`Failed after 5 tries (${d.queue})${d.ref ? `: ${d.ref}` : ""}`);
  return {
    subject,
    html: layout(
      subject,
      heading(e(subject)) +
        bodyP(e(line)) +
        what.map((w) => bodyP(e(w))).join("") +
        button("Open in admin", d.admin_url),
      opts,
    ),
    text: `${line}\n${what.length ? `${what.join("\n")}\n` : ""}${d.admin_url}\n\n${FOOTER}\n`,
  };
}

// ---- M2.4b: the sign-in link and the staff security emails ------------------------------------------------------------------
// Words: 07 §8 (subjects, the magic-link body, the "Not you?" line) and the owner-approved appendix 07-G
// (docs/07-content-appendix/G-m2.4b-security-emails.md), word for word. Each heading is the email's subject. The layout is
// the M2.4 one; security emails carry no marketing line and no unsubscribe link (transactional). The lockout bodies print
// "15 minutes" and "10 wrong sign-in attempts within an hour" as literal 07-G copy: packages/auth/test/lockout.test.ts pins
// those figures to LOCK_MS, LOCK_AFTER and WINDOW_MS, so a change there fails a test that names 07-G and this file.
// Presentation only, never new words: the facts of a new sign-in ("When: …. Where (approximate): …. Device: ….") are set as
// label and value rows in HTML (the plain text keeps the sentences); the time is bold; the "Not you?" line stands apart.

export type MagicLinkData = { url: string; org_name: string; expires_at: string; accounts: string };
/**
 * `role`: the reader's staff role. An owner reads 07-G's owner "Not you?" line ("Contact the owner" can't help them); any
 * other role, or none, reads the team member's line (07 §8).
 */
export type NewDeviceData = {
  name: string;
  first_name: string;
  time: string;
  device: string;
  location: string;
  role?: string;
};
export type TwoFaChange = "recovery_code_used" | "recovery_codes_regenerated" | "reset_by_owner";
export type TwoFaChangeData = {
  name: string;
  first_name: string;
  time: string;
  change: string;
  role?: string;
};
export type LockoutData = { name: string; first_name: string; time: string; role?: string };
export type LockoutOwnerData = {
  name: string;
  first_name: string;
  time: string;
  member_name: string;
  admin_url: string;
};

/** The subjects: 07 §8 for the first four, 07-G for the owner's lockout email. */
export const SUBJECTS = {
  magicLink: "Your sign-in link for the TecHaust client portal",
  newDevice: "New sign-in to your TecHaust admin account",
  twoFaChange: "Security change on your account",
  lockout: "Your account is temporarily locked",
  lockoutOwner: "A team member's admin account is locked",
} as const;

/** 07-G §2: the "Not you?" line, by reader. */
export const NOT_YOU = {
  member: "Not you? Contact the owner immediately.",
  owner: "Not you? Sign in now, choose Sign out everywhere under Account, and create new recovery codes.",
} as const;

const notYouFor = (role: string | undefined) => (role === "owner" ? NOT_YOU.owner : NOT_YOU.member);

/** One paragraph of an email: plain text and HTML (already escaped), so both versions say the same words. */
type Para = { text: string; html: string };
const para = (text: string, html = e(text)): Para => ({ text, html });
/** A sentence with the time in it: the time bold (and kept on one line) in HTML. */
const withTime = (before: string, time: string, after: string): Para => ({
  text: `${before}${time}${after}`,
  html: `${e(before)}<strong style="font-weight:600;white-space:nowrap;">${e(time)}</strong>${e(after)}`,
});

/** The "Not you?" line, set apart under a verdigris rule (the reference block of the acknowledgement, 06 §6). */
function notYouBlock(line: string): string {
  const q = "Not you?";
  const words = line.startsWith(`${q} `)
    ? `<strong style="font-weight:600;">${e(q)}</strong> ${e(line.slice(q.length + 1))}`
    : e(line);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 16px;"><tr>
<td class="ac" width="4" style="width:4px;background-color:${C.btnPrimaryBg};font-size:0;line-height:0;">&nbsp;</td>
<td style="padding:4px 0 4px 16px;"><p class="tx" style="${textStyle(T.text.body.size, T.text.body.lineHeight, C.text)}">${words}</p></td>
</tr></table>`;
}

/** Label and value rows (the lead alert's table, 06 §6), for the facts of a new sign-in. */
function factTable(rows: [string, string][]): string {
  const cell = `border-top:1px solid ${C.border};padding:10px 0;vertical-align:top;`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;border-bottom:1px solid ${C.border};" class="ln">
${rows
  .map(
    ([k, v]) => `<tr>
<td class="ln k" width="152" style="${cell}width:152px;padding-right:16px;"><p class="mu" style="${textStyle(T.text.sm.size, T.text.sm.lineHeight, C.textMuted, "font-weight:500;padding-top:2px;")}">${e(k)}</p></td>
<td class="ln" style="${cell}"><p class="tx" style="${textStyle(T.text.body.size, T.text.body.lineHeight, C.text, "word-break:break-word;")}">${e(v)}</p></td>
</tr>`,
  )
  .join("\n")}
</table>`;
}

/** Text: the paragraphs, a blank line apart, then the footer. */
const textOf = (parts: string[]) => `${parts.filter(Boolean).join("\n\n")}\n\n${FOOTER}\n`;

/**
 * The sign-in link (to the client, from no-reply@): 07 §8. The organisation line (07-G) only when the request made 2 or more
 * links, one per organisation, above the button.
 */
export function portalMagicLink(d: MagicLinkData, opts: LayoutOptions): Rendered {
  const subject = headerValue(SUBJECTS.magicLink);
  const org = Number(d.accounts) >= 2 ? `This link signs you in to ${d.org_name}.` : "";
  const use = "Use this link to sign in. It works once and expires in 15 minutes:";
  const ignore = "If you didn't ask for it, you can ignore this email.";
  const html = layout(
    subject,
    heading(e(subject)) +
      (org ? bodyP(`<strong style="font-weight:600;">${e(org)}</strong>`) : "") +
      bodyP(e(use), "padding-bottom:8px;") +
      button("Sign in", d.url) +
      bodyP(e(ignore), "padding-bottom:0;", true),
    opts,
  );
  return { subject, html, text: textOf([org, `${use}\n${d.url}`, ignore]) };
}

/** A staff security email: the subject as its heading, the paragraphs, then optional extras in order. */
function securityEmail(
  subject: string,
  opts: LayoutOptions,
  parts: {
    before: Para[];
    facts?: { rows: [string, string][]; text: string };
    after?: Para[];
    notYou?: string;
    action?: { label: string; url: string };
  },
): Rendered {
  const after = parts.after ?? [];
  const html = layout(
    subject,
    heading(e(subject)) +
      parts.before.map((p) => bodyP(p.html)).join("") +
      (parts.facts ? factTable(parts.facts.rows) : "") +
      after.map((p) => bodyP(p.html)).join("") +
      (parts.action ? button(parts.action.label, parts.action.url) : "") +
      (parts.notYou ? notYouBlock(parts.notYou) : ""),
    opts,
  );
  const text = textOf([
    ...parts.before.map((p) => p.text),
    parts.facts?.text ?? "",
    ...after.map((p) => p.text),
    parts.action ? `${parts.action.label}: ${parts.action.url}` : "",
    parts.notYou ?? "",
  ]);
  return { subject, html, text };
}

/** Login alert (07 §8 outline, 07-G body): when, where (approximate), device; then the reader's "Not you?" line. */
export function staffNewDevice(d: NewDeviceData, opts: LayoutOptions): Rendered {
  return securityEmail(headerValue(SUBJECTS.newDevice), opts, {
    before: [
      para(
        `Hi ${d.first_name}, your TecHaust admin account was just signed in to from a device or browser we haven't seen before.`,
      ),
    ],
    facts: {
      rows: [
        ["When", d.time],
        ["Where (approximate)", d.location],
        ["Device", d.device],
      ],
      text: `When: ${d.time}.\nWhere (approximate): ${d.location}.\nDevice: ${d.device}.`,
    },
    after: [para("If this was you, there's nothing to do.")],
    notYou: notYouFor(d.role),
  });
}

/**
 * Security change on the account (07-G, three bodies by `change`). Only the change and the time: never a device or a place
 * (for an owner's reset those would be the owner's). An unknown change throws (the consumer logs it failed; jobs never
 * queues one).
 */
export function staffTwoFaChange(d: TwoFaChangeData, opts: LayoutOptions): Rendered {
  const subject = headerValue(SUBJECTS.twoFaChange);
  const hi = `Hi ${d.first_name}, `;
  switch (d.change as TwoFaChange) {
    case "recovery_code_used":
      return securityEmail(subject, opts, {
        before: [
          withTime(
            `${hi}a recovery code was used to sign in to your TecHaust admin account on `,
            d.time,
            ". That code can't be used again.",
          ),
          para("When you can, sign in and create a new set of recovery codes under Account."),
        ],
        notYou: notYouFor(d.role),
      });
    case "recovery_codes_regenerated":
      return securityEmail(subject, opts, {
        before: [
          withTime(
            `${hi}a new set of recovery codes was created for your TecHaust admin account on `,
            d.time,
            ". Your old codes no longer work.",
          ),
        ],
        notYou: notYouFor(d.role),
      });
    case "reset_by_owner":
      return securityEmail(subject, opts, {
        before: [
          withTime(
            `${hi}the owner reset the password and two-step sign-in on your TecHaust admin account on `,
            d.time,
            ", and you were signed out everywhere.",
          ),
          para(
            "To get back in, use the new link the owner sends you (it works for 48 hours) to choose a new password and set up your authenticator app again.",
          ),
          para("If you didn't expect this, contact the owner."),
        ],
      });
    default:
      throw new Error("Unknown 2FA change");
  }
}

/** The account is locked (to the member, 07-G); then the reader's "Not you?" line. */
export function staffLockout(d: LockoutData, opts: LayoutOptions): Rendered {
  return securityEmail(headerValue(SUBJECTS.lockout), opts, {
    before: [
      withTime(
        `Hi ${d.first_name}, your TecHaust admin account was locked for 15 minutes on `,
        d.time,
        " after 10 wrong sign-in attempts within an hour.",
      ),
      para("Nothing else was changed. After 15 minutes you can sign in as usual."),
    ],
    notYou: notYouFor(d.role),
  });
}

/** The same lock, to each owner (ADM-AUTH-06, 07-G): who, when, what to do, and "[Open in admin]". No "Not you?" line. */
export function staffLockoutOwner(d: LockoutOwnerData, opts: LayoutOptions): Rendered {
  return securityEmail(headerValue(SUBJECTS.lockoutOwner), opts, {
    before: [
      withTime(
        `${d.member_name}'s TecHaust admin account was locked for 15 minutes on `,
        d.time,
        " after 10 wrong sign-in attempts within an hour.",
      ),
      para(
        `If ${d.member_name} doesn't know about this, someone may be trying to guess the password. You can sign them out everywhere or deactivate the account under Users.`,
      ),
    ],
    action: { label: "Open in admin", url: d.admin_url },
  });
}

// ---- M3.1 (words: 07 §8 subject, 07-H body and test line, owner-approved 2026-10-24) ---------------------------------------

export type StaffInviteData = { inviter_name: string; role: string; url: string };

/** The invitation to join the admin (to the invited person, from no-reply@): link valid 48 h, authenticator app required. */
export function staffInvite(d: StaffInviteData, opts: LayoutOptions): Rendered {
  const subject = headerValue("You've been invited to TecHaust admin");
  const intro = `Hi, ${d.inviter_name} has invited you to join TecHaust admin as ${d.role}.`;
  const how =
    "To accept, choose a password and add TecHaust to an authenticator app on your phone, such as Google Authenticator, Microsoft Authenticator or 1Password: every sign-in needs a code from it.";
  const expiry = "The link works once and expires in 48 hours:";
  const ignore = "If you weren't expecting this, you can ignore this email.";
  const html = layout(
    subject,
    heading(e(subject)) +
      bodyP(e(intro)) +
      bodyP(e(how)) +
      bodyP(e(expiry), "padding-bottom:8px;") +
      button("Accept the invite", d.url) +
      bodyP(e(ignore), "padding-bottom:0;", true),
    opts,
  );
  return { subject, html, text: textOf([intro, how, `${expiry}\n${d.url}`, ignore]) };
}

// ---- M3.2 (the sender's own words; starting texts in 07-I, owner-approved 2026-10-24) -------------------------------------

export type LeadReplyData = { subject: string; body: string };

/**
 * A reply written on the lead page (to the lead, from hello@, Reply-To hello@). The text is the sender's, sent as plain text and
 * escaped in the HTML; blank lines start a new paragraph. It is a reply to an enquiry the person sent, so there is no "Why you're
 * receiving this" line and no unsubscribe link. The designer owns the layout polish; the words are never changed here.
 */
export function leadReply(d: LeadReplyData, opts: LayoutOptions): Rendered {
  const subject = headerValue(d.subject);
  const paragraphs = d.body
    .split(/\n{2,}|\r\n(?:\r\n)+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const html = layout(
    subject,
    paragraphs
      .map((p, i) => bodyP(lines(p), i === paragraphs.length - 1 ? "padding-bottom:0;" : ""))
      .join(""),
    opts,
  );
  return { subject, html, text: `${d.body.trim()}\n\n${FOOTER}\n` };
}

/**
 * Settings > Email "Send a test" (07-H section 1): the subject gets "Test: ", and one line goes above the email as it would be sent.
 * The line is put straight after the heading in the HTML (and first in the text), so the template itself is unchanged.
 */
export function withTestNotice(r: Rendered, templateName: string): Rendered {
  const subject = headerValue(`Test: ${templateName}`);
  const line = `This is a test of the ${templateName} email, sent from Settings to you only. It uses sample data, so the names, numbers and links below are not real.`;
  const notice = bodyP(`<strong style="font-weight:600;">${e(line)}</strong>`);
  const at = r.html.indexOf("</h1>");
  const html =
    at === -1
      ? r.html.replace(/<body[^>]*>/, (m) => `${m}${notice}`)
      : `${r.html.slice(0, at + 5)}${notice}${r.html.slice(at + 5)}`;
  return { subject, html, text: `${line}\n\n${r.text}` };
}
