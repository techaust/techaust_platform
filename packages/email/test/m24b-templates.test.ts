// The M2.4b emails in the brand layout (docs/06 §6; designer): HTML and text snapshots of every variant, with clearly fake
// sample data, and the words checked against 07 §8 and the owner-approved 07-G, sentence by sentence. The snapshots are
// files, so a reviewer can open the HTML in a browser. [POR-01, ADM-AUTH-06, ADM-AUTH-09, ADM-MAIL-01]
import { describe, expect, it } from "vitest";
import { FOOTER, NOT_YOU, renderEmail } from "../src/index.ts";

const OPTS = { assetBase: "https://assets.example.test/brand/" };
const TIME = "23 Oct 2026, 14:05 IST";
const ADMIN = "http://localhost:5173/";
const who = { name: "Sample Staff (test)", first_name: "Sample" };

/** Every variant, sample data only (example.test, a fake person and organisation, a dummy token). */
const CASES = {
  "portal-magic-link": [
    "portal.magic_link",
    {
      url: "http://localhost:5174/auth/callback#t=SAMPLE-TOKEN-NOT-REAL-0000000000000000000",
      org_name: "Sample Client A (sample)",
      expires_at: "1792748400000",
      accounts: "1",
    },
  ],
  "portal-magic-link-two-orgs": [
    "portal.magic_link",
    {
      url: "http://localhost:5174/auth/callback#t=SAMPLE-TOKEN-NOT-REAL-1111111111111111111",
      org_name: "Sample Client B (sample)",
      expires_at: "1792748400000",
      accounts: "2",
    },
  ],
  "staff-new-device": [
    "staff.new_device",
    { ...who, time: TIME, device: "Chrome on Windows", location: "Kolkata, India", role: "staff" },
  ],
  "staff-new-device-owner": [
    "staff.new_device",
    { ...who, time: TIME, device: "Safari on iPhone", location: "Unknown location", role: "owner" },
  ],
  "staff-2fa-recovery-code-used": ["staff.2fa_change", { ...who, time: TIME, change: "recovery_code_used" }],
  "staff-2fa-recovery-codes-regenerated": [
    "staff.2fa_change",
    { ...who, time: TIME, change: "recovery_codes_regenerated" },
  ],
  "staff-2fa-reset-by-owner": ["staff.2fa_change", { ...who, time: TIME, change: "reset_by_owner" }],
  "staff-lockout": ["staff.lockout", { ...who, time: TIME, role: "staff" }],
  "staff-lockout-owner": [
    "staff.lockout_owner",
    {
      name: "Sample Owner (test)",
      first_name: "Sample",
      member_name: "Sample Staff (test)",
      time: TIME,
      admin_url: ADMIN,
    },
  ],
} as const satisfies Record<string, readonly [string, Record<string, string>]>;

const render = (k: keyof typeof CASES) => renderEmail(CASES[k][0], CASES[k][1], OPTS);

describe("M2.4b emails: snapshots", () => {
  for (const k of Object.keys(CASES) as (keyof typeof CASES)[]) {
    it(`${k}: HTML and text`, async () => {
      const r = render(k);
      await expect(r.html).toMatchFileSnapshot(`./__snapshots__/${k}.html`);
      await expect(r.text).toMatchFileSnapshot(`./__snapshots__/${k}.txt`);
    });
  }
});

describe("M2.4b emails: the words, word for word (07 §8, 07-G)", () => {
  it("magic link: 07 §8 body, the button with the plain URL under it; the organisation line only for 2+ links", () => {
    const one = render("portal-magic-link");
    const url = CASES["portal-magic-link"][1].url;
    expect(one.text).toBe(
      `Use this link to sign in. It works once and expires in 15 minutes:\n${url}\n\nIf you didn't ask for it, you can ignore this email.\n\n${FOOTER}\n`,
    );
    expect(one.html).toContain(">Sign in</a>");
    // the button, Outlook's button, and the plain URL under them (its href and its text)
    expect(one.html.split(url).length - 1).toBe(4);
    const two = render("portal-magic-link-two-orgs");
    expect(two.text.startsWith("This link signs you in to Sample Client B (sample).\n\nUse this link")).toBe(
      true,
    );
    // above the button
    expect(two.html.indexOf("This link signs you in to")).toBeLessThan(two.html.indexOf(">Sign in</a>"));
  });

  it("login alert: the 07-G sentences, the three facts, and the reader's 'Not you?' line", () => {
    const r = render("staff-new-device");
    expect(r.text).toBe(
      [
        "Hi Sample, your TecHaust admin account was just signed in to from a device or browser we haven't seen before.",
        `When: ${TIME}.\nWhere (approximate): Kolkata, India.\nDevice: Chrome on Windows.`,
        "If this was you, there's nothing to do.",
        "Not you? Contact the owner immediately.",
        `${FOOTER}\n`,
      ].join("\n\n"),
    );
    expect(render("staff-new-device-owner").text).toContain(NOT_YOU.owner);
    expect(render("staff-new-device-owner").text).not.toContain(NOT_YOU.member);
  });

  it("2FA change: the three 07-G bodies by change", () => {
    expect(render("staff-2fa-recovery-code-used").text).toBe(
      [
        `Hi Sample, a recovery code was used to sign in to your TecHaust admin account on ${TIME}. That code can't be used again.`,
        "When you can, sign in and create a new set of recovery codes under Account.",
        "Not you? Contact the owner immediately.",
        `${FOOTER}\n`,
      ].join("\n\n"),
    );
    expect(render("staff-2fa-recovery-codes-regenerated").text).toBe(
      [
        `Hi Sample, a new set of recovery codes was created for your TecHaust admin account on ${TIME}. Your old codes no longer work.`,
        "Not you? Contact the owner immediately.",
        `${FOOTER}\n`,
      ].join("\n\n"),
    );
    expect(render("staff-2fa-reset-by-owner").text).toBe(
      [
        `Hi Sample, the owner reset the password and two-step sign-in on your TecHaust admin account on ${TIME}, and you were signed out everywhere.`,
        "To get back in, use the new link the owner sends you (it works for 48 hours) to choose a new password and set up your authenticator app again.",
        "If you didn't expect this, contact the owner.",
        `${FOOTER}\n`,
      ].join("\n\n"),
    );
  });

  it("2FA change: no device or place line in any of the three, even when the data carried one", () => {
    for (const change of ["recovery_code_used", "recovery_codes_regenerated", "reset_by_owner"]) {
      const r = renderEmail(
        "staff.2fa_change",
        { ...who, time: TIME, change, device: "Chrome on Windows", location: "Kolkata, India" },
        OPTS,
      );
      for (const out of [r.text, r.html]) {
        expect(out).not.toMatch(/Where \(approximate\)|Device:|>Device<|Chrome|Kolkata/);
      }
    }
  });

  it("2FA change: an unknown change throws (nothing is sent; jobs never queues one)", () => {
    expect(() => renderEmail("staff.2fa_change", { ...who, time: TIME, change: "other" }, OPTS)).toThrow();
  });

  it("lockout: the member's and the owner's 07-G bodies with the literal '15 minutes' and '10 wrong … within an hour'", () => {
    expect(render("staff-lockout").text).toBe(
      [
        `Hi Sample, your TecHaust admin account was locked for 15 minutes on ${TIME} after 10 wrong sign-in attempts within an hour.`,
        "Nothing else was changed. After 15 minutes you can sign in as usual.",
        "Not you? Contact the owner immediately.",
        `${FOOTER}\n`,
      ].join("\n\n"),
    );
    const owner = render("staff-lockout-owner");
    expect(owner.text).toBe(
      [
        `Sample Staff (test)'s TecHaust admin account was locked for 15 minutes on ${TIME} after 10 wrong sign-in attempts within an hour.`,
        "If Sample Staff (test) doesn't know about this, someone may be trying to guess the password. You can sign them out everywhere or deactivate the account under Users.",
        `Open in admin: ${ADMIN}`,
        `${FOOTER}\n`,
      ].join("\n\n"),
    );
    expect(owner.html).toContain(">Open in admin</a>");
  });
});

describe("M2.4b emails: the layout rules", () => {
  it("every variant: lang, presentation tables, dark mode, the badge lockup, the subject as the one heading, footer, ≥ 12 px", () => {
    for (const k of Object.keys(CASES) as (keyof typeof CASES)[]) {
      const r = render(k);
      expect(r.html).toMatch(/<html lang="en-IN"/);
      expect(r.html).toContain("@media (prefers-color-scheme: dark)");
      expect(r.html).toContain(`src="${OPTS.assetBase}logo-email-badge%402x.png"`);
      for (const table of r.html.match(/<table\b[^>]*>/g) ?? [])
        expect(table).toContain('role="presentation"');
      expect(r.html.match(/<h1\b/g)).toHaveLength(1);
      expect(r.html).toContain(`>${r.subject.replace("'", "&#39;")}</h1>`);
      expect(r.html).toContain(FOOTER);
      for (const m of r.html.matchAll(/font-size:(\d+)px/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(12);
    }
  });

  it("security emails carry no marketing line and no unsubscribe link (transactional)", () => {
    for (const k of Object.keys(CASES) as (keyof typeof CASES)[]) {
      const r = render(k);
      expect(`${r.text}${r.html}`).not.toMatch(/unsubscribe|Why you're receiving this/i);
    }
  });

  it("escapes every value", () => {
    const r = renderEmail(
      "staff.lockout_owner",
      { ...CASES["staff-lockout-owner"][1], member_name: "<b>x</b>", admin_url: 'http://a.test/"><script>' },
      OPTS,
    );
    expect(r.html).not.toContain("<b>x</b>");
    expect(r.html).not.toContain("<script>");
  });
});
