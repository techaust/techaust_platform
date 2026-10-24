// M2.4b in the jobs Worker, in workerd with a real D1 [ADM-AUTH-06, ADM-AUTH-09, ADM-MAIL-01, POR-01]: a staff alert (the audit
// row's ID) becomes the right emails for the right people; sign-in link emails are not sent once expired; the dead-letter
// alert names no address, link, token or summary; and no log line holds personal data. The email queue and the transport
// are recording fakes.
import { env as realEnv } from "cloudflare:workers";
import { type EmailMessage, emailMessage, uuidv7 } from "@techaust/core";
import type { SendInput, Transport } from "@techaust/email";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emailLogId, processDeadLetter, processEmail } from "../src/email.ts";
import { handleQueue } from "../src/queue.ts";
import { processStaffAlert } from "../src/staff-alerts.ts";

// 23 Oct 2026, 14:05 IST
const AT = Date.UTC(2026, 9, 23, 8, 35);
const HOUR = 3_600_000;

let queued: EmailMessage[];
const makeEnv = (over: Record<string, unknown> = {}) =>
  ({
    DB: realEnv.DB,
    ENVIRONMENT: "local",
    LEAD_ALERT_TO: "owner-alert@example.test",
    EMAIL_ALLOWED_RECIPIENTS: "",
    EMAIL_TRANSPORT: "log",
    ADMIN_URL: "https://admin.example/",
    EMAIL_ASSET_BASE: "https://assets.example.test/brand/",
    EMAIL_QUEUE: {
      sendBatch: async (items: { body: EmailMessage }[]) => {
        for (const i of items) queued.push(i.body);
      },
    },
    ...over,
  }) as unknown as Env;

const recorder = () => {
  const sent: SendInput[] = [];
  const transport: Transport = {
    async send(input) {
      sent.push(input);
      return { kind: "sent", messageId: `m-${sent.length}` };
    },
  };
  return { sent, transport };
};

let logs: string[];
const spies: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(async () => {
  queued = [];
  logs = [];
  for (const m of ["log", "error", "warn", "info"] as const)
    spies.push(
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" "))),
    );
  await realEnv.DB.batch([
    realEnv.DB.prepare("DELETE FROM email_log"),
    realEnv.DB.prepare("DELETE FROM email_suppressions"),
  ]);
});
afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore();
});

// ---- data ----------------------------------------------------------------------------------------------------------------

let seq = 0;
type Role = "owner" | "staff" | "sales" | "accountant";
async function member(o: { role?: Role; status?: string; name?: string; email?: string } = {}) {
  const id = uuidv7();
  const n = ++seq;
  const email = o.email ?? `person-${n}@example.test`;
  const name = o.name ?? `Person ${n}`;
  await realEnv.DB.prepare(
    "INSERT INTO staff_users (id, email, name, role, status) VALUES (?1, ?2, ?3, ?4, ?5)",
  )
    .bind(id, email, name, o.role ?? "staff", o.status ?? "active")
    .run();
  return { id, email, name };
}

type AlertOpts = { at?: number; summary?: unknown; action?: string; entityType?: string };
async function alertRow(userId: string, o: AlertOpts = {}) {
  const id = uuidv7();
  await realEnv.DB.prepare(
    "INSERT INTO audit_log (id, at, actor_type, actor_id, role, action, entity_type, entity_id, summary, ip, user_agent, request_id) VALUES (?1, ?2, 'staff', ?3, NULL, ?4, ?5, ?3, ?6, '203.0.113.5', 'SomeAgent/1.0', 'rid-1')",
  )
    .bind(
      id,
      o.at ?? AT,
      userId,
      o.action ?? "alert.new_device",
      o.entityType ?? "staff_user",
      JSON.stringify(
        o.summary ?? {
          ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
          country: "IN",
          city: "Kolkata",
        },
      ),
    )
    .run();
  return id;
}

const alertMsg = (auditId: string) => ({ kind: "staff.alert", auditId });
const expand = async (auditId: string, env = makeEnv()) => {
  queued = [];
  const result = await processStaffAlert(env, alertMsg(auditId));
  return { result, mails: [...queued] };
};

// ---- the expansion -------------------------------------------------------------------------------------------------------

describe("a new-device alert [ADM-AUTH-09]", () => {
  it("tells the member: time in IST, device and place, the member's name, and an ordinary EmailMessage the consumer accepts", async () => {
    const m = await member({ name: "Asha Rao" });
    const auditId = await alertRow(m.id);
    const { result, mails } = await expand(auditId);
    expect(result).toBe("queued");
    expect(mails).toEqual([
      {
        template: "staff.new_device",
        to: m.email,
        data: {
          name: "Asha Rao",
          first_name: "Asha",
          role: "staff",
          time: "23 Oct 2026, 14:05 IST",
          device: "Chrome on Windows",
          location: "Kolkata, India",
        },
        entity: { type: "audit_log", id: auditId },
      },
    ]);
    for (const mail of mails) expect(emailMessage.safeParse(mail).success).toBe(true);
    // the audit row's own IP and user-agent text never reach an email
    expect(JSON.stringify(mails)).not.toMatch(/203\.0\.113\.5|SomeAgent|Mozilla/);
  });

  it("with the SES transport it primes the signing key first (CPU tuning 4): nothing is sent, the secret is never logged", async () => {
    const m = await member();
    const auditId = await alertRow(m.id);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const sign = vi.spyOn(crypto.subtle, "sign");
    try {
      const secret = "prime-secret-from-alert-test";
      const env = makeEnv({
        EMAIL_TRANSPORT: "ses",
        SES_ACCESS_KEY_ID: "AKIAPRIMETEST00000",
        SES_SECRET_ACCESS_KEY: secret,
        SES_REGION: "ap-south-1",
      });
      const { result, mails } = await expand(auditId, env);
      expect([result, mails.length]).toEqual(["queued", 1]);
      expect(sign).toHaveBeenCalledTimes(5);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(logs.join("\n")).not.toContain(secret);
    } finally {
      fetchSpy.mockRestore();
      sign.mockRestore();
    }
  });

  it("an invited member is told, a deactivated one is not", async () => {
    const invited = await member({ status: "invited" });
    expect((await expand(await alertRow(invited.id))).mails).toHaveLength(1);
    const gone = await member({ status: "deactivated" });
    const none = await expand(await alertRow(gone.id));
    expect([none.result, none.mails]).toEqual(["none", []]);
  });

  it("falls back to 'Unknown location' and 'Unknown browser' when the request carried neither", async () => {
    const m = await member();
    const { mails } = await expand(
      await alertRow(m.id, { summary: { ua: null, country: null, city: null } }),
    );
    expect(mails[0]?.data).toMatchObject({ device: "Unknown browser", location: "Unknown location" });
    const onlyCountry = await expand(
      await alertRow(m.id, { summary: { ua: null, country: "IN", city: null } }),
    );
    expect(onlyCountry.mails[0]?.data.location).toBe("India");
  });

  it("a summary that is not JSON still gives an email", async () => {
    const m = await member();
    const id = uuidv7();
    await realEnv.DB.prepare(
      "INSERT INTO audit_log (id, at, actor_type, actor_id, action, entity_type, entity_id, summary) VALUES (?1, ?2, 'staff', ?3, 'alert.new_device', 'staff_user', ?3, 'not json')",
    )
      .bind(id, AT, m.id)
      .run();
    expect((await expand(id)).mails).toHaveLength(1);
  });
});

describe("a 2FA-change alert [ADM-AUTH-09]", () => {
  it.each(["recovery_code_used", "recovery_codes_regenerated", "reset_by_owner"])(
    "carries change: %s",
    async (change) => {
      const m = await member();
      const { mails } = await expand(
        await alertRow(m.id, {
          action: "alert.2fa_change",
          summary: { ua: null, country: "IN", city: null, change },
        }),
      );
      expect(mails).toHaveLength(1);
      expect(mails[0]).toMatchObject({ template: "staff.2fa_change", to: m.email, data: { change } });
    },
  );

  it("carries the time and the first name only: no device and no place (an owner's reset would show the owner's browser)", async () => {
    const m = await member({ name: "Meera Iyer" });
    for (const change of ["recovery_code_used", "recovery_codes_regenerated", "reset_by_owner"]) {
      const { mails } = await expand(
        await alertRow(m.id, {
          action: "alert.2fa_change",
          summary: { ua: "Mozilla/5.0 Chrome/140.0", country: "IN", city: "Kolkata", change },
        }),
      );
      expect(Object.keys(mails[0]?.data ?? {}).sort()).toEqual([
        "change",
        "first_name",
        "name",
        "role",
        "time",
      ]);
      expect(mails[0]?.data.first_name).toBe("Meera");
      expect(JSON.stringify(mails)).not.toMatch(/Kolkata|Chrome|admin\.example/);
    }
  });

  it("an unknown or missing change sends nothing: it is logged ignored, never guessed at or echoed", async () => {
    const m = await member();
    for (const summary of [{ change: "<script>" }, { ua: null }, { change: 5 }]) {
      const { result, mails } = await expand(await alertRow(m.id, { action: "alert.2fa_change", summary }));
      expect([result, mails]).toEqual(["ignored", []]);
    }
    expect(
      logs.filter((l) => l.includes("staff_alert.ignored") && l.includes('"why":"change"')),
    ).toHaveLength(3);
    expect(logs.join("\n")).not.toContain("<script>");
  });
});

describe("a lockout alert [ADM-AUTH-06]", () => {
  it("tells the member and each active owner once, with the owners' copy naming the member", async () => {
    const o1 = await member({ role: "owner", name: "Owner One" });
    const o2 = await member({ role: "owner", name: "Owner Two" });
    await member({ role: "owner", status: "invited" }); // not active: not told
    await member({ role: "owner", status: "deactivated" });
    const staff = await member({ role: "staff", name: "Meera Iyer" });
    const auditId = await alertRow(staff.id, { action: "alert.lockout" });
    const { mails } = await expand(auditId);
    const entity = { type: "staff_lockout", id: `${staff.id}:${Math.floor(AT / HOUR)}` };
    expect(mails.map((m) => [m.template, m.to]).sort()).toEqual(
      [
        ["staff.lockout", staff.email],
        ["staff.lockout_owner", o1.email],
        ["staff.lockout_owner", o2.email],
      ].sort(),
    );
    for (const m of mails) expect(m.entity).toEqual(entity);
    const ownerCopy = mails.find((m) => m.to === o1.email) as EmailMessage;
    // the owner's copy: who is locked and when, and the "[Open in admin]" link; not the member's address or role
    expect(ownerCopy.data).toEqual({
      name: "Owner One",
      first_name: "Owner",
      member_name: "Meera Iyer",
      time: "23 Oct 2026, 14:05 IST",
      admin_url: "https://admin.example/",
    });
    // the member's copy: the time alone (no device or place of whoever typed the passwords, no admin link)
    expect((mails.find((m) => m.to === staff.email) as EmailMessage).data).toEqual({
      name: "Meera Iyer",
      first_name: "Meera",
      role: "staff",
      time: "23 Oct 2026, 14:05 IST",
    });
  });

  it("an owner whose own account is locked gets one email, their own", async () => {
    const o = await member({ role: "owner" });
    const other = await member({ role: "owner" });
    const { mails } = await expand(await alertRow(o.id, { action: "alert.lockout" }));
    expect(mails.map((m) => [m.template, m.to])).toEqual(
      expect.arrayContaining([
        ["staff.lockout", o.email],
        ["staff.lockout_owner", other.email],
      ]),
    );
    expect(mails.filter((m) => m.to === o.email)).toHaveLength(1);
    // their own copy says they are an owner, so it carries 07-G's owner "Not you?" line
    expect(mails.find((m) => m.to === o.email)?.data.role).toBe("owner");
  });

  it("a deactivated member gets none, the owners still do", async () => {
    const o = await member({ role: "owner" });
    const gone = await member({ role: "staff", status: "deactivated" });
    const { mails } = await expand(await alertRow(gone.id, { action: "alert.lockout" }));
    expect(mails.map((m) => [m.template, m.to])).toContainEqual(["staff.lockout_owner", o.email]);
    expect(mails.some((m) => m.to === gone.email)).toBe(false);
  });

  it("at most one lockout email per person per clock hour (UTC): a second lock in the same hour is acked and sends nothing new", async () => {
    const o = await member({ role: "owner" });
    const staff = await member({ role: "staff" });
    const { sent, transport } = recorder();
    const run = async (at: number) => {
      const { mails } = await expand(await alertRow(staff.id, { action: "alert.lockout", at }));
      const results = [];
      for (const m of mails) results.push(await processEmail(makeEnv(), m, transport, at));
      return results;
    };
    // (the owners of the other tests in this file are in the database too: "everyone" is the member and every active owner)
    const everyone = async (at: number) => [...new Set(await run(at))];
    expect(await everyone(AT)).toEqual(["sent"]); // the member and the owners
    const firstSent = sent.length;
    expect(firstSent).toBeGreaterThanOrEqual(2);
    expect(sent.map((s) => s.to)).toEqual(expect.arrayContaining([o.email, staff.email]));
    expect(await everyone(AT + 20 * 60_000)).toEqual(["duplicate"]); // 08:55, the same clock hour: nothing new
    expect(sent).toHaveLength(firstSent);
    // The throttle is the clock hour, not a sliding 60 minutes: a lock 10 minutes later that crosses 09:00 is told again, so
    // at most two emails in any 60 minutes.
    expect(await everyone(AT + 30 * 60_000)).toEqual(["sent"]); // 09:05
    expect(sent).toHaveLength(2 * firstSent);
    // every lock wrote its audit row
    expect(
      (
        await realEnv.DB.prepare(
          "SELECT count(*) AS n FROM audit_log WHERE action = 'alert.lockout' AND entity_id = ?1",
        )
          .bind(staff.id)
          .first<{ n: number }>()
      )?.n,
    ).toBe(3);
  });
});

describe("redelivery, bad input and missing rows [NFR-7]", () => {
  it("a redelivered staff.alert gives the same emails, and the email consumer sends each once", async () => {
    const m = await member();
    const auditId = await alertRow(m.id);
    const { sent, transport } = recorder();
    const first = await expand(auditId);
    const second = await expand(auditId);
    expect(second.mails).toEqual(first.mails);
    for (const mail of [...first.mails, ...second.mails]) await processEmail(makeEnv(), mail, transport, AT);
    expect(sent).toHaveLength(1);
  });

  it("an alert whose row is missing is acknowledged and logged without data", async () => {
    const message = {
      id: "1",
      timestamp: new Date(),
      body: alertMsg(uuidv7()),
      attempts: 1,
      ack: vi.fn(),
      retry: vi.fn(),
    };
    await handleQueue(
      { queue: "techaust-local-email", messages: [message] } as unknown as MessageBatch<unknown>,
      makeEnv(),
    );
    expect(message.ack).toHaveBeenCalled();
    expect(message.retry).not.toHaveBeenCalled();
    expect(logs.some((l) => l.includes("staff_alert.missing"))).toBe(true);
    expect(queued).toEqual([]);
  });

  it("an invalid staff alert is acknowledged and logged, never retried", async () => {
    const message = {
      id: "1",
      timestamp: new Date(),
      body: { kind: "staff.alert", auditId: "not-a-uuid", extra: "a@example.test" },
      attempts: 1,
      ack: vi.fn(),
      retry: vi.fn(),
    };
    await handleQueue(
      { queue: "techaust-local-email", messages: [message] } as unknown as MessageBatch<unknown>,
      makeEnv(),
    );
    expect(message.ack).toHaveBeenCalled();
    expect(message.retry).not.toHaveBeenCalled();
    expect(logs.some((l) => l.includes("staff_alert.invalid_message"))).toBe(true);
    expect(logs.join("\n")).not.toContain("a@example.test");
  });

  it("an audit row that is not one of the three alerts is ignored", async () => {
    const m = await member();
    const ok = await alertRow(m.id, { action: "auth.login" });
    expect((await expand(ok)).result).toBe("ignored");
    const wrongEntity = await alertRow(m.id, { entityType: "client_session" });
    expect((await expand(wrongEntity)).result).toBe("ignored");
  });

  it("a queue that fails to take the emails makes the alert retry (the redelivery sends them once)", async () => {
    const m = await member();
    const auditId = await alertRow(m.id);
    const message = {
      id: "1",
      timestamp: new Date(),
      body: alertMsg(auditId),
      attempts: 1,
      ack: vi.fn(),
      retry: vi.fn(),
    };
    const broken = makeEnv({
      EMAIL_QUEUE: {
        sendBatch: async () => {
          throw new Error(`down for ${m.email}`);
        },
      },
    });
    await handleQueue(
      { queue: "techaust-local-email", messages: [message] } as unknown as MessageBatch<unknown>,
      broken,
    );
    expect(message.ack).not.toHaveBeenCalled();
    expect(message.retry).toHaveBeenCalled();
    expect(logs.join("\n")).not.toContain(m.email); // the error text is never logged
  });

  it("an email and a staff alert on the same queue each reach their own consumer", async () => {
    const m = await member();
    const auditId = await alertRow(m.id);
    const mail = (to: string): EmailMessage => ({
      template: "lead.alert",
      to,
      data: { ref: "L-23456", admin_url: "https://admin.example/" },
      entity: { type: "lead", id: "L-23456" },
    });
    const mk = (body: unknown) => ({
      id: "1",
      timestamp: new Date(),
      body,
      attempts: 1,
      ack: vi.fn(),
      retry: vi.fn(),
    });
    const a = mk(alertMsg(auditId));
    const b = mk(mail("someone@example.test"));
    await handleQueue(
      { queue: "techaust-local-email", messages: [a, b] } as unknown as MessageBatch<unknown>,
      makeEnv(),
    );
    expect(a.ack).toHaveBeenCalled();
    expect(b.ack).toHaveBeenCalled();
    expect(queued.map((q) => q.template)).toEqual(["staff.new_device"]); // the alert was expanded; the email was not
  });
});

// ---- the sign-in link email ----------------------------------------------------------------------------------------------

describe("the sign-in link email [POR-01]", () => {
  const link = (hash: string, expiresAt: number, to = "client@example.test"): EmailMessage => ({
    template: "portal.magic_link",
    to,
    data: {
      url: `https://portal.example/auth/callback#t=${"Q".repeat(43)}`,
      org_name: "Acme Ltd",
      expires_at: String(expiresAt),
    },
    entity: { type: "magic_link", id: hash },
  });

  it("is sent from no-reply@ with Reply-To contact@ while live, and not again when delivered twice", async () => {
    const { sent, transport } = recorder();
    const m = link("h".repeat(64), AT + 15 * 60_000);
    expect(await processEmail(makeEnv(), m, transport, AT)).toBe("sent");
    expect(await processEmail(makeEnv(), m, transport, AT + 1_000)).toBe("duplicate");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.from.address).toBe("no-reply@techaust.com");
    expect(sent[0]?.replyTo).toBe("contact@techaust.com");
    expect(sent[0]?.text).toContain("auth/callback#t=");
  });

  it("two real requests (two token hashes) are two emails; two organisations are two emails", async () => {
    const { sent, transport } = recorder();
    for (const hash of ["a".repeat(64), "b".repeat(64)])
      expect(await processEmail(makeEnv(), link(hash, AT + 900_000), transport, AT)).toBe("sent");
    expect(sent).toHaveLength(2);
  });

  it("a link that expired before sending is logged skipped / expired and never sent", async () => {
    const { sent, transport } = recorder();
    const m = link("e".repeat(64), AT);
    expect(await processEmail(makeEnv(), m, transport, AT + 1)).toBe("skipped");
    expect(sent).toEqual([]);
    const row = await realEnv.DB.prepare("SELECT status, error FROM email_log WHERE id = ?1")
      .bind(emailLogId(m))
      .first();
    expect(row).toEqual({ status: "skipped", error: "expired" });
    // the very last millisecond of its life still goes
    expect(await processEmail(makeEnv(), link("f".repeat(64), AT), transport, AT)).toBe("sent");
  });

  it("is skipped for a suppressed address and, on staging, for one not on the allow-list", async () => {
    const { sent, transport } = recorder();
    await realEnv.DB.prepare(
      "INSERT INTO email_suppressions (email, reason, at) VALUES ('blocked@example.test', 'bounce', ?1)",
    )
      .bind(AT)
      .run();
    expect(
      await processEmail(makeEnv(), link("1".repeat(64), AT + 1000, "blocked@example.test"), transport, AT),
    ).toBe("skipped");
    const staging = makeEnv({ ENVIRONMENT: "staging", EMAIL_ALLOWED_RECIPIENTS: "admin@example.test" });
    expect(
      await processEmail(staging, link("2".repeat(64), AT + 1000, "stranger@example.test"), transport, AT),
    ).toBe("skipped");
    expect(
      await processEmail(staging, link("3".repeat(64), AT + 1000, "admin@example.test"), transport, AT),
    ).toBe("sent");
    expect(sent.map((s) => s.to)).toEqual(["admin@example.test"]);
  });
});

// ---- dead letters ----------------------------------------------------------------------------------------------------------

describe("dead letters name no address, link, token or summary [NFR-7]", () => {
  it("a dead-lettered sign-in link marks its email_log row failed and alerts with the template only", async () => {
    const { sent, transport } = recorder();
    const m: EmailMessage = {
      template: "portal.magic_link",
      to: "client-dlq@example.test",
      data: {
        url: `https://portal.example/auth/callback#t=${"Z".repeat(43)}`,
        org_name: "Acme Ltd",
        expires_at: String(AT),
      },
      entity: { type: "magic_link", id: "d".repeat(64) },
    };
    await realEnv.DB.prepare(
      "INSERT INTO email_log (id, to_email, template, entity_type, entity_id, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, 'queued', ?6, ?6)",
    )
      .bind(emailLogId(m), m.to, m.template, m.entity.type, m.entity.id, AT)
      .run();
    expect(await processDeadLetter(makeEnv(), "techaust-local-email-dlq", m, transport)).toBe(true);
    const row = await realEnv.DB.prepare("SELECT status FROM email_log WHERE id = ?1")
      .bind(emailLogId(m))
      .first<{ status: string }>();
    expect(row?.status).toBe("failed");
    expect(sent).toHaveLength(1);
    const alert = JSON.stringify(sent[0]);
    expect(alert).toContain("portal.magic_link");
    for (const secret of ["client-dlq@example.test", "#t=", "ZZZZ", "Acme Ltd", "d".repeat(64)])
      expect(alert).not.toContain(secret);
    expect(logs.join("\n")).not.toMatch(/client-dlq|#t=|ZZZZ/);
  });

  it("a dead-lettered staff alert is named 'staff alert' and nothing else about it", async () => {
    const m = await member({ name: "Hidden Name" });
    const auditId = await alertRow(m.id, {
      summary: { ua: "SecretAgent/9", country: "IN", city: "Secretville" },
    });
    const { sent, transport } = recorder();
    expect(await processDeadLetter(makeEnv(), "techaust-local-email-dlq", alertMsg(auditId), transport)).toBe(
      true,
    );
    const alert = JSON.stringify(sent[0]);
    expect(alert).toContain("staff alert");
    for (const secret of [auditId, m.email, "Hidden Name", "SecretAgent", "Secretville"])
      expect(alert).not.toContain(secret);
    expect(logs.join("\n")).not.toContain(auditId);
  });
});

// ---- privacy -------------------------------------------------------------------------------------------------------------

describe("no log line holds personal data [NFR-6]", () => {
  it("through a full alert, send and dead-letter run", async () => {
    const o = await member({ role: "owner", name: "Private Owner" });
    const m = await member({ name: "Private Member" });
    const { transport } = recorder();
    for (const action of ["alert.new_device", "alert.2fa_change", "alert.lockout"]) {
      const { mails } = await expand(await alertRow(m.id, { action }));
      for (const mail of mails) await processEmail(makeEnv(), mail, transport, AT);
    }
    await processStaffAlert(makeEnv(), alertMsg(uuidv7()));
    const all = logs.join("\n");
    expect(all.length).toBeGreaterThan(0);
    for (const forbidden of [
      m.email,
      o.email,
      "Private Member",
      "Private Owner",
      "Kolkata",
      "Chrome",
      "203.0.113.5",
      "SomeAgent",
    ])
      expect(all).not.toContain(forbidden);
  });
});
