// M3.1 emails: the staff invite (07 section 8 subject, 07-H body, word for word) and the Settings test send (07-H section 1).
import { describe, expect, it } from "vitest";
import { NO_REPLY_REPLY_TO, renderEmail, SENDERS } from "../src/index.ts";

const opts = { assetBase: "https://assets.example.test/brand/" };
const invite = {
  inviter_name: "Sample Owner (test)",
  role: "accountant",
  url: "https://admin.example/invite#t=abc",
};

describe("staff invite [ADM-AUTH-07, ADM-MAIL-01]", () => {
  const r = renderEmail("staff.invite", invite, opts);

  it("has the 07 section 8 subject, the no-reply sender and Reply-To contact@", () => {
    expect(r.subject).toBe("You've been invited to TecHaust admin");
    expect(r.from).toEqual(SENDERS.noReply);
    expect(r.replyTo).toBe(NO_REPLY_REPLY_TO);
  });

  it("says 07-H's words, with the inviter, role and link filled in (plain text and HTML)", () => {
    expect(r.text).toContain("Hi, Sample Owner (test) has invited you to join TecHaust admin as accountant.");
    expect(r.text).toContain(
      "To accept, choose a password and add TecHaust to an authenticator app on your phone, such as Google Authenticator, Microsoft Authenticator or 1Password: every sign-in needs a code from it.",
    );
    expect(r.text).toContain(
      "The link works once and expires in 48 hours:\nhttps://admin.example/invite#t=abc",
    );
    expect(r.text).toContain("If you weren't expecting this, you can ignore this email.");
    expect(r.html).toContain("Accept the invite");
    expect(r.html).toContain("expires in 48 hours");
    expect(r.text).toContain("TecHaust Technologies · Balurghat, West Bengal, India · contact@techaust.com");
    expect(`${r.text}${r.html}`).not.toMatch(/unsubscribe|Why you're receiving this/i);
  });

  it("escapes every value", () => {
    const x = renderEmail("staff.invite", { ...invite, inviter_name: "<script>x</script>" }, opts);
    expect(x.html).not.toContain("<script>x</script>");
  });
});

describe("Settings test send [ADM-SET-07]", () => {
  it("prefixes the subject with 'Test: ' and puts the sample-data line first, above the normal email", () => {
    const r = renderEmail("staff.invite", { ...invite, test_name: "Staff invite" }, opts);
    const line =
      "This is a test of the Staff invite email, sent from Settings to you only. It uses sample data, so the names, numbers and links below are not real.";
    expect(r.subject).toBe("Test: Staff invite");
    expect(r.text.startsWith(`${line}\n\n`)).toBe(true);
    expect(r.text).toContain("has invited you to join TecHaust admin");
    const at = r.html.indexOf("This is a test of the Staff invite email");
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(r.html.indexOf("has invited you to join"));
  });

  it("works for every other template too (the line is added to whatever the template renders)", () => {
    const r = renderEmail(
      "staff.lockout",
      { name: "Sample", first_name: "Sample", time: "1 Jan 2027, 10:00 IST", test_name: "Lockout" },
      opts,
    );
    expect(r.subject).toBe("Test: Lockout");
    expect(r.html).toContain("This is a test of the Lockout email");
  });

  it("without test_name the email is untouched", () => {
    const r = renderEmail("staff.invite", invite, opts);
    expect(r.text).not.toContain("This is a test of");
  });
});
