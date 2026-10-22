// The branded email layout (docs/06 §6; M2.4 designer): snapshots of both lead emails (HTML and text, with clearly fake
// sample data) and the rules the layout must keep. The snapshots are files, so a reviewer can open the HTML.
import { describe, expect, it } from "vitest";
import { FOOTER, leadAcknowledgement, leadAlert } from "../src/index.ts";

/** The logos come from the Worker's EMAIL_ASSET_BASE; the package holds no host, so the tests use a made-up one. */
const ASSET_BASE = "https://assets.example.test/brand/";
const OPTS = { assetBase: ASSET_BASE };

/** Sample data only (example.test addresses, an obviously fake person). */
const ack = { first_name: "Sample", service_name: "Discovery Sprint", ref: "L-7K3Q9" };
const alert = {
  ref: "L-7K3Q9",
  service_name: "AI Document Automation",
  budget_band: "1l-3l",
  country: "IN",
  name: "Sample Visitor",
  email: "sample.visitor@example.test",
  phone: "+91 90000 00000",
  company: "Example Traders (sample)",
  timeline: "1-3-months",
  currency: "INR",
  tools: "tally, excel-sheets",
  call_window: "10:00–13:00 IST",
  message: "Sample message (test data).\nWe retype about 400 supplier invoices a month into Tally.",
  source_page: "/services/ai-document-automation",
  admin_url: "http://localhost:5173/",
};

describe("lead emails in the brand layout (docs/06 §6)", () => {
  it("acknowledgement: HTML and text snapshots", async () => {
    const r = leadAcknowledgement(ack, OPTS);
    await expect(r.html).toMatchFileSnapshot("./__snapshots__/lead-acknowledgement.html");
    await expect(r.text).toMatchFileSnapshot("./__snapshots__/lead-acknowledgement.txt");
  });

  it("acknowledgement with a Cal.com link: HTML snapshot", async () => {
    const r = leadAcknowledgement({ ...ack, cal_link: "https://cal.example.test/techaust/discovery" }, OPTS);
    await expect(r.html).toMatchFileSnapshot("./__snapshots__/lead-acknowledgement-cal.html");
  });

  it("internal alert: HTML and text snapshots", async () => {
    const r = leadAlert(alert, OPTS);
    await expect(r.html).toMatchFileSnapshot("./__snapshots__/lead-alert.html");
    await expect(r.text).toMatchFileSnapshot("./__snapshots__/lead-alert.txt");
  });

  it("the wordmark is a hosted image with alt text, never live text; light badge and dark lockup", () => {
    for (const html of [leadAcknowledgement(ack, OPTS).html, leadAlert(alert, OPTS).html]) {
      expect(html).toContain(`src="${ASSET_BASE}logo-email-badge%402x.png"`);
      expect(html).toContain(`src="${ASSET_BASE}logo-email-dark%402x.png"`);
      expect(html.match(/alt="TecHaust Technologies"/g)?.length).toBe(2);
      // "TecHaust" as text appears only in the footer line and the sign-off, never as a header in a live font.
      expect(html).not.toMatch(/<h1[^>]*>[^<]*TecHaust/);
    }
  });

  it("the image host comes only from the caller (EMAIL_ASSET_BASE), never from this package", () => {
    const html = leadAcknowledgement(ack, { assetBase: "https://techaust.com/brand/" }).html;
    expect(html).toContain('src="https://techaust.com/brand/logo-email-badge%402x.png"');
    expect(html).not.toContain(ASSET_BASE);
    expect(html).not.toContain("workers.dev");
  });

  it("the alert shows the quote link's type and plan, and a dead-lettered lead says so in subject and body", () => {
    const r = leadAlert(
      { ...alert, type: "pilot", plan: "essential", failed_queue: "techaust-staging-leads-dlq" },
      OPTS,
    );
    expect(r.subject).toBe(
      "Failed after 5 tries (techaust-staging-leads-dlq): New lead L-7K3Q9: AI Document Automation · 1l-3l · IN",
    );
    expect(r.text).toContain("Type: pilot\nPlan: essential");
    expect(r.text).toContain("This lead failed after 5 tries and may be missing from the admin.");
    expect(leadAlert(alert, OPTS).text).not.toContain("failed after 5 tries");
  });

  it("keeps the email rules: lang, presentation tables, dark mode, 600 px, the 07 §8 footer, a VML button", () => {
    const html = leadAlert(alert, OPTS).html;
    expect(html).toMatch(/<html lang="en-IN"/);
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    expect(html).toContain("@media (prefers-color-scheme: dark)");
    expect(html).toContain("max-width:600px");
    for (const table of html.match(/<table\b[^>]*>/g) ?? []) expect(table).toContain('role="presentation"');
    expect(html).toContain(FOOTER);
    expect(html).toContain("v:roundrect");
    // The plain URL repeated under the button (06 §6).
    expect(html.match(/http:\/\/localhost:5173\//g)?.length).toBeGreaterThanOrEqual(3);
    // Body text is never below 12 px.
    for (const m of html.matchAll(/font-size:(\d+)px/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(12);
  });

  it("keeps the visitor's line breaks in the alert and escapes everything", () => {
    const html = leadAlert({ ...alert, message: "<script>x</script>\nline two" }, OPTS).html;
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;<br>line two");
    expect(html).not.toContain("<script>");
  });
});
