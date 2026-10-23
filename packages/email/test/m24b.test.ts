// The five M2.4b templates (placeholder bodies until the designer's step): the 07 §8 subjects, the no-reply sender with
// Reply-To contact@techaust.com, every variable escaped, and the facts present. The designer adds snapshots of the final HTML.
import { describe, expect, it } from "vitest";
import { NO_REPLY_REPLY_TO, renderEmail, SENDERS } from "../src/index.ts";
import { SUBJECTS } from "../src/templates.ts";

const opts = { assetBase: "https://assets.example.test/brand/" };
const facts = {
  name: "Asha <b>Rao</b>",
  time: "23 Oct 2026, 14:05 IST",
  device: "Chrome on Windows",
  location: "Kolkata, India",
  admin_url: "https://admin.example/",
};

describe("sender and subjects [ADM-MAIL-01]", () => {
  it("no-reply@ sends them, replies go to contact@techaust.com", () => {
    expect(SENDERS.noReply).toEqual({ name: "TecHaust Technologies", address: "no-reply@techaust.com" });
    expect(NO_REPLY_REPLY_TO).toBe("contact@techaust.com");
    for (const [template, data] of [
      [
        "portal.magic_link",
        { url: "https://portal.example/auth/callback#t=abc", org_name: "Org", expires_at: "1" },
      ],
      ["staff.new_device", facts],
      ["staff.2fa_change", { ...facts, change: "recovery_code_used" }],
      ["staff.lockout", facts],
      [
        "staff.lockout_owner",
        { ...facts, member_name: "M", member_email: "m@example.test", member_role: "staff" },
      ],
    ] as const) {
      const r = renderEmail(template, data, opts);
      expect(r.from).toEqual(SENDERS.noReply);
      expect(r.replyTo).toBe("contact@techaust.com");
      expect(r.subject.length).toBeGreaterThan(0);
      expect(r.html).toContain("<!doctype html>");
      expect(r.text).toContain(
        "TecHaust Technologies · Balurghat, West Bengal, India · contact@techaust.com",
      );
    }
  });

  it("uses the 07 §8 subjects word for word", () => {
    const m = renderEmail(
      "portal.magic_link",
      { url: "https://p.example/#t=x", org_name: "O", expires_at: "1" },
      opts,
    );
    expect(m.subject).toBe("Your sign-in link for the TecHaust client portal");
    expect(renderEmail("staff.new_device", facts, opts).subject).toBe(
      "New sign-in to your TecHaust admin account",
    );
    expect(renderEmail("staff.2fa_change", { ...facts, change: "x" }, opts).subject).toBe(
      "Security change on your account",
    );
    expect(renderEmail("staff.lockout", facts, opts).subject).toBe("Your account is temporarily locked");
    // the owner's lockout subject has no approved line yet: a visible placeholder, not final copy
    expect(SUBJECTS.lockoutOwner).toMatch(/^PLACEHOLDER/);
  });
});

describe("what the bodies carry", () => {
  it("the link email puts the link in the button and in the plain text, and says it works once for 15 minutes", () => {
    const url = "https://portal.example/auth/callback#t=Zm9v";
    const r = renderEmail("portal.magic_link", { url, org_name: "Org <script>", expires_at: "1" }, opts);
    expect(r.html).toContain(`href="${url}"`);
    expect(r.text).toContain(url);
    expect(r.text).toContain("It works once and expires in 15 minutes");
    expect(r.text).toContain("If you didn't ask for it, you can ignore this email.");
    expect(r.html).not.toContain("<script>");
  });

  it("the security emails carry time, place and device; the new-device one adds the 07 §8 line; names are escaped", () => {
    const r = renderEmail("staff.new_device", facts, opts);
    for (const part of [facts.time, facts.location, facts.device]) {
      expect(r.text).toContain(part);
      expect(r.html).toContain(part);
    }
    expect(r.text).toContain("Not you? Contact the owner immediately.");
    expect(r.html).not.toContain("<b>Rao</b>");
    expect(r.html).toContain("&lt;b&gt;Rao&lt;/b&gt;");
  });

  it("the owner's copy names the locked member", () => {
    const r = renderEmail(
      "staff.lockout_owner",
      { ...facts, member_name: "Meera", member_email: "meera@example.test", member_role: "staff" },
      opts,
    );
    for (const part of ["Meera", "meera@example.test", "staff"]) expect(r.text).toContain(part);
  });

  it("an unknown template still throws (the consumer logs it failed)", () => {
    expect(() => renderEmail("staff.nope", {}, opts)).toThrow(/Unknown email template/);
  });
});
