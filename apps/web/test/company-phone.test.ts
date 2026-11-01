// The company phone is typed in five places (owner, 2026-11-01; run file company-phone, review finding 7): site.ts
// `phone.display` (as it is written everywhere), `phone.dial` (tel: links and the JSON-LD telephone), `whatsapp` (wa.me),
// and the business card and letterhead lines in packages/ui/src/brand/print.ts. This ties them to `display`, so a change
// to one that misses the others fails here. print.ts is Node-only (fonts, pdf-lib), so its source is read as text.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { site } from "../src/config/site";
import { organizationNode } from "../src/lib/structured-data";

const printSource = readFileSync(new URL("../../../packages/ui/src/brand/print.ts", import.meta.url), "utf8");

/** "+91 98830 23931" → "+919883023931"; empty stays empty. */
const dialOf = (display: string) => (display ? `+${display.replace(/\D/g, "")}` : "");

describe("the company phone, one number everywhere", () => {
  it("writes the display form as the owner gave it", () => {
    expect(site.phone.display).toMatch(/^\+91 \d{5} \d{5}$/);
  });

  it("dials and chats on the same number", () => {
    expect(site.phone.dial).toBe(dialOf(site.phone.display));
    expect(site.whatsapp).toBe(site.phone.dial.replace(/^\+/, ""));
  });

  it("prints the display form on the business card and the letterhead", () => {
    const card =
      /lines:\s*\[([^\]]*)\]/.exec(printSource.slice(printSource.indexOf("export const CARD")))?.[1] ?? "";
    const footer =
      /=\s*\[([^\]]*)\]/.exec(
        printSource.slice(printSource.indexOf("export const LETTERHEAD_FOOTER")),
      )?.[1] ?? "";
    const phones = (text: string) => [...text.matchAll(/"(\+[\d ]+)"/g)].map((m) => m[1]);
    expect(phones(card)).toEqual([site.phone.display]);
    expect(phones(footer)).toEqual([site.phone.display]);
  });

  it("gives search engines the number the site shows, and none while it is hidden", () => {
    expect(organizationNode(site)).toHaveProperty("telephone", site.phone.dial);
    const hidden = { ...site, phone: { display: "", dial: dialOf("") } };
    expect(organizationNode(hidden)).not.toHaveProperty("telephone");
  });
});
