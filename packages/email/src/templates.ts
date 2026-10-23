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

// ---- M2.4b: the sign-in link and the staff security emails (PLACEHOLDERS) --------------------------------------------------
// The subjects are 07 §8 word for word; the bodies below only carry the facts in the M2.4 layout, so the queue, the
// consumer and the tests can run end to end. The designer replaces the bodies with the approved copy (07 §8 and the appendix
// 07-G) and the final layout; every line marked PLACEHOLDER is a gap, never final text. Variables are strings, escaped.

export type MagicLinkData = { url: string; org_name: string; expires_at: string };
export type StaffFacts = { name: string; time: string; device: string; location: string; admin_url: string };
export type TwoFaChangeData = StaffFacts & { change: string };
export type LockoutOwnerData = StaffFacts & {
  member_name: string;
  member_email: string;
  member_role: string;
};

/** 07 §8 subjects. `LOCKOUT_OWNER_SUBJECT_GAP` has no approved line yet (07-G): a visible placeholder. */
export const SUBJECTS = {
  magicLink: "Your sign-in link for the TecHaust client portal",
  newDevice: "New sign-in to your TecHaust admin account",
  twoFaChange: "Security change on your account",
  lockout: "Your account is temporarily locked",
  lockoutOwner: "PLACEHOLDER (copy pending 07-G): a staff account is temporarily locked",
} as const;

const PLACEHOLDER = "PLACEHOLDER (the designer writes this from 07 §8 and 07-G)";

/** Facts as label/value rows, in text and HTML. */
function factRows(rows: [string, string][]): { text: string; html: string } {
  const cell = `border-top:1px solid ${C.border};padding:10px 0;vertical-align:top;`;
  return {
    text: rows.map(([k, v]) => `${k}: ${v}`).join("\n"),
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;border-bottom:1px solid ${C.border};" class="ln">
${rows
  .map(
    ([k, v]) => `<tr>
<td class="ln k" width="152" style="${cell}width:152px;padding-right:16px;"><p class="mu" style="${textStyle(T.text.sm.size, T.text.sm.lineHeight, C.textMuted, "font-weight:500;padding-top:2px;")}">${e(k)}</p></td>
<td class="ln" style="${cell}"><p class="tx" style="${textStyle(T.text.body.size, T.text.body.lineHeight, C.text, "word-break:break-word;")}">${lines(v)}</p></td>
</tr>`,
  )
  .join("\n")}
</table>`,
  };
}

/** The sign-in link (to the client, from no-reply@). Sentences are 07 §8; the layout is the designer's. */
export function portalMagicLink(d: MagicLinkData, opts: LayoutOptions): Rendered {
  const subject = headerValue(SUBJECTS.magicLink);
  const use = "Use this link to sign in. It works once and expires in 15 minutes.";
  const ignore = "If you didn't ask for it, you can ignore this email.";
  const html = layout(
    subject,
    heading(e(subject)) +
      bodyP(e(`PLACEHOLDER layout. For: ${d.org_name}.`), "", true) +
      bodyP(e(use)) +
      button("Sign in", d.url) +
      bodyP(e(ignore)),
    opts,
  );
  return { subject, html, text: `${use}\n\nSign in: ${d.url}\n\n${ignore}\n\n${FOOTER}\n` };
}

function securityEmail(
  subject: string,
  facts: [string, string][],
  opts: LayoutOptions,
  lead: string,
  tail?: string,
): Rendered {
  const rows = factRows(facts);
  const html = layout(
    subject,
    heading(e(subject)) + bodyP(e(lead), "", true) + rows.html + (tail ? bodyP(e(tail)) : ""),
    opts,
  );
  return {
    subject,
    html,
    text: `${lead}

${rows.text}
${
  tail
    ? `
${tail}
`
    : ""
}
${FOOTER}
`,
  };
}

const whenWhere = (d: StaffFacts): [string, string][] => [
  ["Time", d.time],
  ["Location", d.location],
  ["Device", d.device],
];

/** New sign-in (to the staff member). 07 §8: time (IST), approximate location, device; "Not you? Contact the owner immediately." */
export function staffNewDevice(d: StaffFacts, opts: LayoutOptions): Rendered {
  return securityEmail(
    headerValue(SUBJECTS.newDevice),
    whenWhere(d),
    opts,
    `PLACEHOLDER layout. Hi ${d.name}.`,
    "Not you? Contact the owner immediately.",
  );
}

/** Security change on the account (to the staff member): which change, then the facts. The bodies are a gap (07-G). */
export function staffTwoFaChange(d: TwoFaChangeData, opts: LayoutOptions): Rendered {
  const subject = headerValue(SUBJECTS.twoFaChange);
  return securityEmail(
    subject,
    [["Change", d.change], ...whenWhere(d)],
    opts,
    `${PLACEHOLDER}. Hi ${d.name}.`,
  );
}

/** The account is locked (to the staff member). The body is a gap (07-G). */
export function staffLockout(d: StaffFacts, opts: LayoutOptions): Rendered {
  const subject = headerValue(SUBJECTS.lockout);
  return securityEmail(subject, whenWhere(d), opts, `${PLACEHOLDER}. Hi ${d.name}.`);
}

/** The same lock, to each owner (ADM-AUTH-06). Subject and body are a gap (07-G). */
export function staffLockoutOwner(d: LockoutOwnerData, opts: LayoutOptions): Rendered {
  const subject = headerValue(SUBJECTS.lockoutOwner);
  return securityEmail(
    subject,
    [["Member", d.member_name], ["Address", d.member_email], ["Role", d.member_role], ...whenWhere(d)],
    opts,
    `${PLACEHOLDER}. Hi ${d.name}.`,
  );
}
