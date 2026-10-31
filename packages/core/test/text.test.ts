import { describe, expect, it } from "vitest";
import { CONTACT_TOKEN_RE } from "../src/documents.ts";
import { escapeRegExp, wholeWordPattern } from "../src/text.ts";

describe("escapeRegExp", () => {
  it("makes every special character match as itself", () => {
    const s = "a.b*c+d?e^f$" + "{g}(h)|i[j]k\\l";
    expect(new RegExp(escapeRegExp(s)).test(s)).toBe(true);
    expect(new RegExp(escapeRegExp("a.b")).test("axb")).toBe(false);
  });
});

describe("wholeWordPattern", () => {
  it("matches whole words only, longest name first", () => {
    const re = wholeWordPattern(["Ram", "Ram Das"]);
    expect("Ram Das met Ram; Ramp-up, _Ram_, Ram2".replace(re, "X")).toBe("X met X; Ramp-up, _Ram_, Ram2");
  });
  it("treats a combining mark (an Indic vowel sign) as part of the word", () => {
    const re = wholeWordPattern(["राम"]);
    expect("राम और रामा और रामी".replace(re, "X")).toBe("X और रामा और रामी");
  });
  it("escapes the names", () => {
    expect("a.b and axb".replace(wholeWordPattern(["a.b"]), "X")).toBe("X and axb");
  });
  it("is case-sensitive by default; ignoreCase matches any case, still whole words only", () => {
    expect("ASHA RAO and Asha Rao".replace(wholeWordPattern(["Asha Rao"]), "X")).toBe("ASHA RAO and X");
    const re = wholeWordPattern(["Asha Rao", "asha@example.test"], { ignoreCase: true });
    expect("ASHA RAO, asha rao, Asha@Example.TEST and ASHA RAOS".replace(re, "X")).toBe(
      "X, X, X and ASHA RAOS",
    );
    expect("Élodie ÉLODIE élodies".replace(wholeWordPattern(["élodie"], { ignoreCase: true }), "X")).toBe(
      "X X élodies",
    );
    expect("राम और रामा".replace(wholeWordPattern(["राम"], { ignoreCase: true }), "X")).toBe("X और रामा");
  });
});

describe("CONTACT_TOKEN_RE", () => {
  it("reads the placeholder with or without spaces, nothing else", () => {
    expect("{{client.contact}} {{ client.contact }} {{client.name}}".replace(CONTACT_TOKEN_RE, "X")).toBe(
      "X X {{client.name}}",
    );
  });
});
