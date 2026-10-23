// The five M2.4b templates (placeholder bodies until the designer's step): the final subjects (07 §8 and 07-G), the no-reply
// sender with Reply-To contact@techaust.com, every variable escaped, and the facts present. The designer adds snapshots of
// the final HTML.
import { describe, expect, it } from "vitest";
import { NO_REPLY_REPLY_TO, renderEmail, SENDERS } from "../src/index.ts";
import { SUBJECTS } from "../src/templates.ts";

const opts = { assetBase: "https://assets.example.test/brand/" };
const who = { name: "Asha <b>Rao</b>", first_name: "Asha" };
const time = "23 Oct 2026, 14:05 IST";
const data = {
  link: {
    url: "https://portal.example/auth/callback#t=abc",
    org_name: "Org",
    expires_at: "1",
    accounts: "1",
  },
  newDevice: { ...who, time, device: "Chrome on Windows", location: "Kolkata, India" },
  twoFa: { ...who, time, change: "recovery_code_used" },
  lockout: { ...who, time },
  lockoutOwner: { ...who, time, member_name: "Meera Iyer", admin_url: "https://admin.example/" },
};

describe("sender and subjects [ADM-MAIL-01]", () => {
  it("no-reply@ sends them, replies go to contact@techaust.com", () => {
    expect(SENDERS.noReply).toEqual({ name: "TecHaust Technologies", address: "no-reply@techaust.com" });
    expect(NO_REPLY_REPLY_TO).toBe("contact@techaust.com");
    for (const [template, d] of [
      ["portal.magic_link", data.link],
      ["staff.new_device", data.newDevice],
      ["staff.2fa_change", data.twoFa],
      ["staff.lockout", data.lockout],
      ["staff.lockout_owner", data.lockoutOwner],
    ] as const) {
      const r = renderEmail(template, d, opts);
      expect(r.from).toEqual(SENDERS.noReply);
      expect(r.replyTo).toBe("contact@techaust.com");
      expect(r.subject.length).toBeGreaterThan(0);
      expect(r.html).toContain("<!doctype html>");
      expect(r.text).toContain(
        "TecHaust Technologies · Balurghat, West Bengal, India · contact@techaust.com",
      );
    }
  });

  it("uses the 07 §8 and 07-G subjects word for word", () => {
    expect(renderEmail("portal.magic_link", data.link, opts).subject).toBe(
      "Your sign-in link for the TecHaust client portal",
    );
    expect(renderEmail("staff.new_device", data.newDevice, opts).subject).toBe(
      "New sign-in to your TecHaust admin account",
    );
    expect(renderEmail("staff.2fa_change", data.twoFa, opts).subject).toBe("Security change on your account");
    expect(renderEmail("staff.lockout", data.lockout, opts).subject).toBe(
      "Your account is temporarily locked",
    );
    expect(renderEmail("staff.lockout_owner", data.lockoutOwner, opts).subject).toBe(
      "A team member's admin account is locked",
    );
    expect(Object.values(SUBJECTS)).toHaveLength(5);
  });
});

describe("what the bodies carry", () => {
  it("the link email puts the link in the button and in the plain text, and says it works once for 15 minutes", () => {
    const url = "https://portal.example/auth/callback#t=Zm9v";
    const r = renderEmail("portal.magic_link", { ...data.link, url, org_name: "Org <script>" }, opts);
    expect(r.html).toContain(`href="${url}"`);
    expect(r.text).toContain(url);
    expect(r.text).toContain("It works once and expires in 15 minutes");
    expect(r.text).toContain("If you didn't ask for it, you can ignore this email.");
    expect(r.html).not.toContain("<script>");
  });

  it("names the organisation only when the request made two or more links (07-G)", () => {
    const one = renderEmail("portal.magic_link", { ...data.link, org_name: "Acme Ltd", accounts: "1" }, opts);
    expect(one.text).not.toContain("This link signs you in to");
    expect(one.text).not.toContain("Acme Ltd");
    const two = renderEmail("portal.magic_link", { ...data.link, org_name: "Acme Ltd", accounts: "2" }, opts);
    expect(two.text).toContain("This link signs you in to Acme Ltd.");
    expect(two.html).toContain("This link signs you in to Acme Ltd.");
    // a message from before `accounts` existed shows no line
    expect(
      renderEmail(
        "portal.magic_link",
        { url: "https://p.example/#t=x", org_name: "O", expires_at: "1" },
        opts,
      ).text,
    ).not.toContain("This link signs you in to");
  });

  it("the new-device email carries time, place and device and the 07 §8 line; names are escaped", () => {
    const r = renderEmail("staff.new_device", data.newDevice, opts);
    for (const part of [time, "Kolkata, India", "Chrome on Windows"]) {
      expect(r.text).toContain(part);
      expect(r.html).toContain(part);
    }
    expect(r.text).toContain("Not you? Contact the owner immediately.");
    expect(r.text).toContain("Hi Asha");
    expect(r.html).not.toContain("<b>Rao</b>");
  });

  it("the 2FA and lockout emails carry the time and no device or place", () => {
    for (const [template, d] of [
      ["staff.2fa_change", data.twoFa],
      ["staff.lockout", data.lockout],
    ] as const) {
      const r = renderEmail(template, d, opts);
      expect(r.text).toContain(time);
      expect(r.text).not.toMatch(/Device|Where|Kolkata|Chrome/);
    }
  });

  it("the owner's copy names the locked member, links to the admin and has the owner's line", () => {
    const r = renderEmail("staff.lockout_owner", data.lockoutOwner, opts);
    expect(r.text).toContain("Meera Iyer");
    expect(r.text).toContain("https://admin.example/");
    expect(r.html).toContain('href="https://admin.example/"');
    expect(r.text).toContain(
      "Not you? Sign in now, choose Sign out everywhere under Account, and create new recovery codes.",
    );
  });

  it("an unknown template still throws (the consumer logs it failed)", () => {
    expect(() => renderEmail("staff.nope", {}, opts)).toThrow(/Unknown email template/);
  });
});
