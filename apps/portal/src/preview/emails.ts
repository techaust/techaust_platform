// PREVIEW ONLY: the two M4.5 emails (proposal sent, from hello@; acceptance confirmation, to both sides) in the brand
// layout of packages/email. The layout is the real one: `leadReply` renders it around a marker, and the marker's paragraph
// is swapped for this body, built with the same inline styles from the email tokens. The build moves these into
// packages/email as typed templates with their plain-text twins. Subjects and the core sentences are 07 §8 word for word;
// the rest is a "[Placeholder]".
import { emailTokens as T } from "@techaust/ui/email";
import { escapeHtml as e } from "../../../../packages/email/src/headers.ts";
import { FOOTER, leadReply } from "../../../../packages/email/src/templates.ts";

const C = T.color;
const FONT = T.font.sans;
const MARK = "@@PREVIEW_BODY@@";
const PH = "[Placeholder] ";

const textStyle = (size: number, lh: number, color: string, extra = "") =>
  `margin:0;font-family:${FONT};font-size:${size}px;line-height:${lh};color:${color};${extra}`;
const p = (html: string, extra = "", muted = false) =>
  `<p class="${muted ? "mu" : "tx"}" style="${textStyle(T.text.body.size, T.text.body.lineHeight, muted ? C.textMuted : C.text, `padding:0 0 16px;${extra}`)}">${html}</p>`;
const h1 = (html: string) =>
  `<h1 class="tx" style="${textStyle(T.text.h1.size, T.text.h1.lineHeight, C.text, "padding:0 0 16px;font-weight:600;")}">${html}</h1>`;

function button(label: string, url: string): string {
  const h = T.buttonHeight;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 12px;"><tr><td>
<a href="${e(url)}" class="bt" style="display:inline-block;min-width:152px;padding:0 24px;height:${h}px;line-height:${h}px;border-radius:${T.radius}px;background-color:${C.btnPrimaryBg};color:${C.btnPrimaryFg};font-family:${FONT};font-size:16px;font-weight:600;text-align:center;text-decoration:none;">${e(label)}</a>
</td></tr></table>
<p class="mu" style="${textStyle(T.text.sm.size, T.text.sm.lineHeight, C.textMuted, "padding:0 0 16px;word-break:break-all;")}"><a href="${e(url)}" class="lk" style="color:${C.textAccent};text-decoration:underline;">${e(url)}</a></p>`;
}

function facts(rows: [string, string][]): string {
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

function wrap(subject: string, inner: string, assetBase: string): string {
  const shell = leadReply({ subject, body: MARK }, { assetBase }).html;
  return shell.replace(new RegExp(`<p[^>]*>${MARK}</p>`), inner);
}

export type PreviewEmail = { from: string; to: string; subject: string; html: string; text: string };

export function proposalSent(
  d: {
    firstName: string;
    to: string;
    title: string;
    number: string;
    version: number;
    total: string;
    validUntil: string;
    url: string;
    attached: boolean;
  },
  assetBase: string,
): PreviewEmail {
  const subject = `Proposal: ${d.title} (${d.number} v${d.version})`;
  const lead = `Hi ${d.firstName}, your proposal is ready. It covers scope, timeline, price and payment schedule, and it's valid until ${d.validUntil}.`;
  const rows: [string, string][] = [
    ["Proposal", d.title],
    ["No.", `${d.number}, version ${d.version}`],
    ["Total", d.total],
    ["Valid until", d.validUntil],
  ];
  const pdf = `${PH}The proposal is attached to this email as a PDF.`;
  const questions = "Questions? Just reply to this email.";
  const html = wrap(
    subject,
    h1(e(subject)) +
      p(e(lead)) +
      facts(rows) +
      button("Review and accept", d.url) +
      (d.attached ? p(e(pdf)) : "") +
      p(e(questions), "padding-bottom:0;", true),
    assetBase,
  );
  const text = [
    lead,
    rows.map(([k, v]) => `${k}: ${v}`).join("\n"),
    `Review and accept: ${d.url}`,
    d.attached ? pdf : "",
    questions,
  ]
    .filter(Boolean)
    .join("\n\n");
  return {
    from: "TecHaust Technologies <hello@techaust.com>",
    to: d.to,
    subject,
    html,
    text: `${text}\n\n${FOOTER}\n`,
  };
}

export function proposalAccepted(
  d: {
    to: string;
    typedName: string;
    title: string;
    number: string;
    version: number;
    acceptedAt: string;
    pdfUrl: string;
    certificateUrl: string;
  },
  assetBase: string,
): PreviewEmail {
  const subject = `Accepted: ${d.title} (${d.number} v${d.version})`;
  const lead = `Thank you, ${d.typedName}. Your acceptance was recorded on ${d.acceptedAt}. Links to the accepted proposal and the acceptance certificate are below.`;
  const next = `Next: ${PH}we'll confirm the start date with you and send the first invoice.`;
  const html = wrap(
    subject,
    h1(e(subject)) +
      p(e(lead), "padding-bottom:8px;") +
      button("Download the accepted PDF", d.pdfUrl) +
      button("Download the acceptance certificate", d.certificateUrl) +
      p(e(next), "padding-bottom:0;"),
    assetBase,
  );
  const text = [
    lead,
    `Download the accepted PDF: ${d.pdfUrl}`,
    `Download the acceptance certificate: ${d.certificateUrl}`,
    next,
  ].join("\n\n");
  return {
    from: "TecHaust Technologies <hello@techaust.com>",
    to: d.to,
    subject,
    html,
    text: `${text}\n\n${FOOTER}\n`,
  };
}
