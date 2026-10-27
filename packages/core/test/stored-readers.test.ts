// The readers of stored settings that the jobs Worker uses WITHOUT zod, the delay of an out-of-window message and the invoice link (M5.4 stage B; ADM-INV-13, ADM-INV-19,
// POR-06, LD63, LD64). A malformed row is the default, never an error: the daily work must not stop because a settings row fails its schema.
import { describe, expect, it } from "vitest";
import { fromIst, parseIsoDate } from "../src/dates.ts";
import { alertDaysFromStoredTax } from "../src/export-invoice.ts";
import { INVOICE_LINK_DAYS, invoiceLinkExpiry, invoiceLinkUrl, mintOfferToken } from "../src/offers.ts";
import {
  DEFAULT_REMINDER_WINDOW,
  QUEUE_MAX_DELAY_SECONDS,
  reminderWindowFromStored,
  windowDelaySeconds,
} from "../src/reminders.ts";

const day = (iso: string, hour = 0, minute = 0, second = 0, ms = 0) => {
  const d = parseIsoDate(iso);
  if (!d) throw new Error("bad date");
  return fromIst(d, hour, minute, second) + ms;
};

describe("reminderWindowFromStored", () => {
  it("reads a stored window and falls back to 09:00 to 19:00 for anything else", () => {
    expect(reminderWindowFromStored({ reminderWindowIst: { fromHour: 10, toHour: 18 } })).toEqual({
      fromHour: 10,
      toHour: 18,
    });
    expect(reminderWindowFromStored({ reminderWindowIst: { fromHour: 0, toHour: 24 } })).toEqual({
      fromHour: 0,
      toHour: 24,
    });
    for (const bad of [
      null,
      undefined,
      "x",
      [],
      {},
      { reminderWindowIst: null },
      { reminderWindowIst: { fromHour: 9 } },
      { reminderWindowIst: { fromHour: "9", toHour: 19 } },
      { reminderWindowIst: { fromHour: 9.5, toHour: 19 } },
      { reminderWindowIst: { fromHour: -1, toHour: 19 } },
      { reminderWindowIst: { fromHour: 9, toHour: 25 } },
      { reminderWindowIst: { fromHour: 19, toHour: 9 } },
      { reminderWindowIst: { fromHour: 9, toHour: 9 } },
    ])
      expect(reminderWindowFromStored(bad), JSON.stringify(bad)).toEqual(DEFAULT_REMINDER_WINDOW);
  });
});

describe("windowDelaySeconds", () => {
  const w = { fromHour: 9, toHour: 19 };
  it("is 0 inside the window, from 09:00:00.000 to 18:59:59.999", () => {
    expect(windowDelaySeconds(day("2026-11-05", 9), w)).toBe(0);
    expect(windowDelaySeconds(day("2026-11-05", 18, 59, 59, 999), w)).toBe(0);
  });
  it("waits for 09:00 the same day before the window, and the next day after it", () => {
    expect(windowDelaySeconds(day("2026-11-05", 8), w)).toBe(3_600);
    expect(windowDelaySeconds(day("2026-11-05", 8, 59, 59, 500), w)).toBe(1);
    expect(windowDelaySeconds(day("2026-11-05", 19), w)).toBe(14 * 3_600);
    expect(windowDelaySeconds(day("2026-11-05", 23, 59, 59, 999), w)).toBe(9 * 3_600 + 1);
  });
  it("one hop is enough for any window: the longest wait stays under the Queues maximum", () => {
    expect(QUEUE_MAX_DELAY_SECONDS).toBe(86_400);
    for (let h = 0; h < 24; h++)
      expect(windowDelaySeconds(day("2026-11-05", h), { fromHour: 9, toHour: 10 })).toBeLessThan(
        QUEUE_MAX_DELAY_SECONDS,
      );
  });
});

describe("alertDaysFromStoredTax", () => {
  it("reads a whole number from 1 to 30 and falls back to 25", () => {
    expect(alertDaysFromStoredTax({ invoiceAlertDays: 10 })).toBe(10);
    expect(alertDaysFromStoredTax({ invoiceAlertDays: 1 })).toBe(1);
    expect(alertDaysFromStoredTax({ invoiceAlertDays: 30 })).toBe(30);
    for (const bad of [
      null,
      "x",
      [],
      {},
      { invoiceAlertDays: 0 },
      { invoiceAlertDays: 31 },
      { invoiceAlertDays: 2.5 },
      { invoiceAlertDays: "9" },
    ])
      expect(alertDaysFromStoredTax(bad), JSON.stringify(bad)).toBe(25);
  });
});

describe("the invoice link", () => {
  it("puts the token in the fragment of /i, whatever the base ends with", async () => {
    const { token, hash } = await mintOfferToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(invoiceLinkUrl("https://portal.example/", token)).toBe(`https://portal.example/i#t=${token}`);
    expect(invoiceLinkUrl("https://portal.example", token)).toBe(`https://portal.example/i#t=${token}`);
  });
  it("lives 180 days from the moment it is minted", () => {
    expect(INVOICE_LINK_DAYS).toBe(180);
    expect(invoiceLinkExpiry(1_000)).toBe(1_000 + 180 * 86_400_000);
  });
});
