// P7-C (docs/runs/p7-launch.md): the postal address has ONE source, `POSTAL_ADDRESS` in company.ts, read by the website's
// site.ts and by the jobs Worker's Rule 9 block. These tests pin the value's shape, the 07-A §8 wording around it, and that
// no marked gap ("[Placeholder] postal address") is left anywhere a Worker or the website reads it.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { POSTAL_ADDRESS } from "../src/company.ts";
import { APPROVED_07ZR, RULE9_BLOCK } from "../src/copy-zr.ts";

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("POSTAL_ADDRESS (P7-C)", () => {
  it("is the owner's address, filled in, trimmed, on one line, without a trailing country", () => {
    expect(POSTAL_ADDRESS).toBe("Pirozpur, Balurghat, Dakshin Dinajpur, West Bengal 733133");
    expect(POSTAL_ADDRESS).toBe(POSTAL_ADDRESS.trim());
    expect(POSTAL_ADDRESS).not.toMatch(/[\r\n"]/);
    expect(POSTAL_ADDRESS).not.toMatch(/India\s*$/);
    expect(POSTAL_ADDRESS).not.toMatch(/Placeholder/i);
  });

  it("fills the Rule 9 block word for word as 07-A §8 (the bold name is the template's, not the text's)", () => {
    const section8 = read("../../../docs/07-content-appendix/A-legal-pages.md");
    const line =
      "**Rupak Sarkar**, Founder, TecHaust Technologies · privacy@techaust.com · {{postal_address}}.";
    expect(section8).toContain(line);
    expect(APPROVED_07ZR).toBe(true);
    expect(RULE9_BLOCK(POSTAL_ADDRESS)).toBe(
      line.replaceAll("**", "").replace("{{postal_address}}", POSTAL_ADDRESS),
    );
    expect(RULE9_BLOCK(POSTAL_ADDRESS)).not.toContain("[Placeholder");
  });

  it("is the one source: the website re-exports it and the jobs Worker passes it to the Rule 9 block", () => {
    const site = read("../../../apps/web/src/config/site.ts");
    expect(site).toMatch(/from "@techaust\/core\/company"/);
    expect(site).toMatch(/\bpostalAddress:\s*POSTAL_ADDRESS\b/);
    expect(site).not.toContain(POSTAL_ADDRESS);
    const alerts = read("../../../apps/jobs/src/portal-alerts.ts");
    expect(alerts).toMatch(/from "@techaust\/core\/company"/);
    expect(alerts).toContain("RULE9_BLOCK(POSTAL_ADDRESS)");
    expect(alerts).not.toMatch(/RULE9_BLOCK\(\s*null\s*\)/);
  });

  it("leaves no marked postal gap in the Rule 9 source or the email fixture", () => {
    expect(read("../src/copy-zr.ts")).not.toContain("[Placeholder] postal address");
    expect(read("../../email/src/fixtures.ts")).not.toContain("[Placeholder] postal address");
  });
});
