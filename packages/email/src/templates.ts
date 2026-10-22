// Email templates: typed functions returning { subject, html, text }. Subjects and text bodies are word for word
// from docs/07 §8. The HTML here is PLACEHOLDER markup (plain, unstyled); the designer replaces it with the branded
// table layout (docs/06 §6) in step 2 of M2.4. Variables are strings; everything is escaped before it reaches HTML.
import { escapeHtml, headerValue } from "./headers.ts";

export type Rendered = { subject: string; html: string; text: string };

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
  /** "Open in admin" target (the admin home until M3). */
  admin_url: string;
};

const wrap = (inner: string) =>
  `<!doctype html><html lang="en"><body>${inner}<p>${escapeHtml(FOOTER)}</p></body></html>`;

/** Lead acknowledgement (to the visitor, from hello@). */
export function leadAcknowledgement(d: AcknowledgementData): Rendered {
  const subject = headerValue(`We've received your request (${d.ref})`);
  const call = d.cal_link ? ` If you'd like to pick a call time now: ${d.cal_link}.` : "";
  const body =
    `Hi ${d.first_name}, thanks for getting in touch about ${d.service_name}. ` +
    `We'll reply within one business day (Mon–Sat, 10:00–19:00 IST).${call} Your reference: ${d.ref}. — TecHaust Technologies`;
  const callHtml = d.cal_link
    ? ` If you'd like to pick a call time now: <a href="${escapeHtml(d.cal_link)}">${escapeHtml(d.cal_link)}</a>.`
    : "";
  const html = wrap(
    `<p>Hi ${escapeHtml(d.first_name)}, thanks for getting in touch about ${escapeHtml(d.service_name)}. ` +
      `We'll reply within one business day (Mon–Sat, 10:00–19:00 IST).${callHtml} ` +
      `Your reference: ${escapeHtml(d.ref)}. — TecHaust Technologies</p>`,
  );
  return { subject, html, text: `${body}\n\n${FOOTER}\n` };
}

/** Internal lead alert (to LEAD_ALERT_TO). */
export function leadAlert(d: AlertData): Rendered {
  const subject = headerValue(`New lead ${d.ref}: ${d.service_name} · ${d.budget_band} · ${d.country}`);
  const all: [string, string | undefined][] = [
    ["Reference", d.ref],
    ["Service", d.service_name],
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
  const lines = all.filter((l): l is [string, string] => !!l[1]);
  const text = `${lines.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\nOpen in admin: ${d.admin_url}\n\n${FOOTER}\n`;
  const html = wrap(
    `<table>${lines
      .map(([k, v]) => `<tr><th align="left">${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`)
      .join("")}</table><p><a href="${escapeHtml(d.admin_url)}">Open in admin</a></p>`,
  );
  return { subject, html, text };
}

/** Internal "a lead or email failed after 5 tries" alert (DLQ consumers; sent directly, not through the queue). */
export function dlqAlert(d: { queue: string; admin_url: string }): Rendered {
  const line = "A lead or email failed after 5 tries: open the admin.";
  return {
    subject: headerValue(`Failed after 5 tries (${d.queue})`),
    html: wrap(`<p>${escapeHtml(line)} <a href="${escapeHtml(d.admin_url)}">Open in admin</a></p>`),
    text: `${line}\n${d.admin_url}\n\n${FOOTER}\n`,
  };
}
