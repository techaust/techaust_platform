// The Worker's request schemas moved from classic zod to zod/mini (M1.5 part 2: ~150 KB less in the Worker bundle).
// This proves they accept and refuse exactly the same inputs, and give the same cleaned-up values, on a fixed corpus.
// `classic` below is the pre-M1.5 definition, kept here only as the reference.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { isClientHash } from "../src/password.ts";
import {
  docTokenRequest,
  inviteFinishRequest,
  inviteStartRequest,
  loginRequest,
  magicRequest,
  magicVerifyRequest,
  recoveryRequest,
  saltRequest,
  sessionIdParam,
  stepUpRequest,
  totpRequest,
} from "../src/schemas.ts";

const email = z.string().trim().toLowerCase().max(254).pipe(z.email());
const b64url43 = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const clientHash = b64url43.refine(isClientHash);
const classic = {
  saltRequest: z.object({ email }),
  loginRequest: z.object({ email, clientHash }),
  totpRequest: z.object({ challenge: z.string().max(512), code: z.string().regex(/^\d{6}$/) }),
  recoveryRequest: z.object({ challenge: z.string().max(512), code: z.string().max(40) }),
  stepUpRequest: z.object({ code: z.string().regex(/^\d{6}$/) }),
  sessionIdParam: z.object({ id: z.string().regex(/^[0-9a-f]{64}$/) }),
  inviteStartRequest: z.object({ token: b64url43 }),
  inviteFinishRequest: z.object({ token: b64url43, clientHash, name: z.string().trim().min(1).max(100) }),
  // portal (M1.6)
  magicRequest: z.object({ email }),
  magicVerifyRequest: z.object({ token: z.string().max(256) }),
  docTokenRequest: z.object({ token: z.string().max(256) }),
};
const mini = {
  saltRequest,
  loginRequest,
  totpRequest,
  recoveryRequest,
  stepUpRequest,
  sessionIdParam,
  inviteStartRequest,
  inviteFinishRequest,
  magicRequest,
  magicVerifyRequest,
  docTokenRequest,
};

const good43 = "A".repeat(43); // decodes to 32 zero bytes
const strings: unknown[] = [
  // emails
  "a@b.co",
  "  A@B.CO  ",
  "\ta@b.co\n",
  "UPPER@EXAMPLE.COM",
  "user+tag@example.com",
  "first.last@sub.example.in",
  "",
  " ",
  "x",
  "a@b",
  "a@@b.co",
  "a b@c.co",
  "é@x.co",
  "a@b.c",
  "a@b..co",
  ".a@b.co",
  "a.@b.co",
  "a@-b.co",
  `${"a".repeat(64)}@${"b".repeat(60)}.co`,
  `${"a".repeat(245)}@b.co`,
  `${"a".repeat(250)}@b.co`,
  // hashes and tokens (43 URL-safe characters)
  good43,
  "x".repeat(43),
  "-".repeat(43),
  "_".repeat(43),
  `${"A".repeat(42)}B`,
  `${"A".repeat(42)}Q`,
  "A".repeat(42),
  "A".repeat(44),
  `${"A".repeat(42)}=`,
  `${"A".repeat(42)}+`,
  "é".repeat(43),
  `${"a1B2".repeat(10)}abc`,
  // names
  "Asha",
  "  Asha  ",
  "A",
  "x\n y",
  "a".repeat(100),
  "a".repeat(101),
  `${" ".repeat(100)}a`,
  "💥",
  "   ",
  // codes
  "123456",
  "12345",
  "1234567",
  "12345a",
  " 123456",
  "123456 ",
  "１２３４５６",
  "000000",
  "123 456",
  // recovery codes and challenges
  "ABCD-EFGH-IJKL-MNOP",
  "abcd efgh ijkl mnop",
  "x".repeat(40),
  "x".repeat(41),
  "c".repeat(512),
  "c".repeat(513),
  // hex ids
  "a".repeat(255),
  "a".repeat(256),
  "a".repeat(257),
  "a".repeat(64),
  "A".repeat(64),
  "a".repeat(63),
  "a".repeat(65),
  "g".repeat(64),
  `${"a".repeat(63)}G`,
];
const nonStrings: unknown[] = [null, undefined, 0, 1, true, [], {}, ["a@b.co"], { nested: "x" }];

/** A string for every field of every schema, in turn (the others stay valid), plus whole-object oddities. */
function inputsFor(name: keyof typeof classic): unknown[] {
  const valid: Record<string, Record<string, unknown>> = {
    saltRequest: { email: "a@b.co" },
    loginRequest: { email: "a@b.co", clientHash: good43 },
    totpRequest: { challenge: "c", code: "123456" },
    recoveryRequest: { challenge: "c", code: "ABCD" },
    stepUpRequest: { code: "123456" },
    sessionIdParam: { id: "a".repeat(64) },
    inviteStartRequest: { token: good43 },
    inviteFinishRequest: { token: good43, clientHash: good43, name: "Asha" },
    magicRequest: { email: "a@b.co" },
    magicVerifyRequest: { token: good43 },
    docTokenRequest: { token: good43 },
  };
  const base = valid[name] as Record<string, unknown>;
  const out: unknown[] = [base, { ...base, extra: "ignored" }, null, undefined, "x", 1, [], [base]];
  for (const key of Object.keys(base)) {
    out.push(Object.fromEntries(Object.entries(base).filter(([k]) => k !== key))); // the field missing
    for (const v of [...strings, ...nonStrings]) out.push({ ...base, [key]: v });
  }
  return out;
}

describe("zod/mini request schemas = the classic ones [ADM-AUTH-01, -02, -03, -04, -08]", () => {
  for (const name of Object.keys(classic) as (keyof typeof classic)[]) {
    it(`${name}: the same accept / refuse decision and the same cleaned value on every corpus input`, () => {
      const inputs = inputsFor(name);
      let accepted = 0;
      let refused = 0;
      for (const input of inputs) {
        const a = classic[name].safeParse(input);
        const b = mini[name].safeParse(input);
        const label = `${name} ${JSON.stringify(input)?.slice(0, 120)}`;
        expect(b.success, label).toBe(a.success);
        if (a.success && b.success) {
          expect(b.data, label).toEqual(a.data);
          accepted++;
        } else refused++;
      }
      expect(accepted).toBeGreaterThan(0);
      expect(refused).toBeGreaterThan(0);
    });
  }

  it("the corpus covers the non-canonical 43-character client hashes that made the HMAC throw", () => {
    for (const bad of ["x".repeat(43), "-".repeat(43), `${"A".repeat(42)}B`]) {
      expect(isClientHash(bad)).toBe(false);
      expect(loginRequest.safeParse({ email: "a@b.co", clientHash: bad }).success).toBe(false);
      expect(inviteFinishRequest.safeParse({ token: good43, clientHash: bad, name: "A" }).success).toBe(
        false,
      );
      expect(classic.loginRequest.safeParse({ email: "a@b.co", clientHash: bad }).success).toBe(false);
    }
    expect(loginRequest.safeParse({ email: "a@b.co", clientHash: good43 }).success).toBe(true);
  });

  it("the cleaned values are what the Worker relies on: trimmed lower-case email, trimmed name", () => {
    expect(saltRequest.parse({ email: "  Mixed@Case.IN " })).toEqual({ email: "mixed@case.in" });
    expect(magicRequest.parse({ email: "  Mixed@Case.IN " })).toEqual({ email: "mixed@case.in" }); // [POR-01]
    // a token of the wrong shape is NOT a validation error (it is a counted failed check), only an oversize one is
    expect(magicVerifyRequest.safeParse({ token: "short" }).success).toBe(true);
    expect(docTokenRequest.safeParse({ token: "x".repeat(257) }).success).toBe(false);
    expect(inviteFinishRequest.parse({ token: good43, clientHash: good43, name: "  Asha Verma " }).name).toBe(
      "Asha Verma",
    );
  });
});
