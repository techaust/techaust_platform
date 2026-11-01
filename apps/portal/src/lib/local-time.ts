// Times of day in the client's own clock (owner, 2026-11-01; docs/13; run file docs/runs/portal-local-time.md): every on-screen moment the
// portal shows as "dd Mon yyyy, HH:MM" (an acceptance, a decline, the deed's eSign) is written in the browser's zone with the zone's short
// name, one time only: "25 Oct 2026, 06:12 GMT" in London, "24 Oct 2026, 23:12 PDT" in Los Angeles (the local date when it differs). A clock
// on IST (+05:30) reads core's own IST text, so India sees exactly what the server and the PDF write. Dates alone (due dates, validity "(IST)",
// "Paid online on …") stay IST, and so do PDFs, emails and the admin.
// The zone's short name follows the website (apps/web/src/scripts/call-time.ts): Intl's name in the reader's English locale when they have
// one ("BST" for en-GB, "PDT" for en-US), else en-US; an offset-only name ("GMT+9", "GMT+5:45") is shown as given; "GMT+0" is "GMT". Any
// failure (an unknown zone, an engine without Intl zones) falls back to the IST text, never a blank. Intl only, no dependency.
import { formatDate, formatIstDateTime } from "@techaust/core/dates";

/** The reader's clock: the zone (undefined = the browser's own), the locale of the zone's short name, and a test override for that name. */
export type Clock = {
  timeZone?: string;
  locale?: string;
  /** For tests: the zone's short name at an instant, or undefined when the runtime gives none. */
  zoneName?: (at: Date) => string | undefined;
};

const MIN_MS = 60_000;
const IST_OFFSET_MIN = 330;
const pad = (n: number) => String(n).padStart(2, "0");

/** "GMT", "GMT+1", "GMT-3:30", "GMT+5:45": the zone's offset when the runtime gives no short name (Intl's own form, as on the website). */
export function gmtName(offsetMin: number): string {
  if (offsetMin === 0) return "GMT";
  const a = Math.abs(offsetMin);
  return `GMT${offsetMin < 0 ? "-" : "+"}${Math.floor(a / 60)}${a % 60 ? `:${pad(a % 60)}` : ""}`;
}

const formats = new Map<string, Intl.DateTimeFormat>();
function format(key: string, make: () => Intl.DateTimeFormat): Intl.DateTimeFormat {
  let f = formats.get(key);
  if (!f) {
    f = make();
    formats.set(key, f);
  }
  return f;
}

/** The instant's wall-clock reading in `timeZone`, as UTC milliseconds (so the zone's offset is wall − instant). Throws on an unknown zone. */
function wallClock(at: Date, timeZone: string | undefined): number {
  const f = format(
    `w|${timeZone ?? ""}`,
    () =>
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
      }),
  );
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(at)) if (part.type !== "literal") p[part.type] = Number(part.value);
  // Some engines still write midnight as hour 24 despite h23.
  return Date.UTC(p.year ?? 0, (p.month ?? 1) - 1, p.day ?? 1, (p.hour ?? 0) % 24, p.minute ?? 0);
}

function shortZoneName(at: Date, clock: Clock): string | undefined {
  if (clock.zoneName) return clock.zoneName(at);
  const locale = clock.locale ?? "en-US";
  return format(
    `z|${locale}|${clock.timeZone ?? ""}`,
    () => new Intl.DateTimeFormat(locale, { timeZone: clock.timeZone, timeZoneName: "short" }),
  )
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value;
}

/** The browser's clock: its own zone, and its first English locale for the zone's name (the sentence around it is English). */
const browserClock = (): Clock => {
  const languages = typeof navigator === "undefined" ? undefined : navigator.languages;
  return { locale: languages?.find((l) => /^en(-|$)/i.test(l)) ?? "en-US" };
};

/**
 * "25 Oct 2026, 06:12 GMT": a UTC instant as the reader's clock reads it, in the layout of core's `formatIstDateTime` (two-digit day, short
 * month, 24-hour time). A clock on IST, and any failure, gives core's "25 Oct 2026, 11:42 IST".
 */
export function localDateTime(utcMs: number, clock: Clock = browserClock()): string {
  try {
    // Whole minutes: the text shows none smaller, and the offset is then exact.
    const at = new Date(utcMs - (((utcMs % MIN_MS) + MIN_MS) % MIN_MS));
    const wall = wallClock(at, clock.timeZone);
    if (!Number.isFinite(wall)) return formatIstDateTime(utcMs);
    const offset = Math.round((wall - at.getTime()) / MIN_MS);
    if (offset === IST_OFFSET_MIN) return formatIstDateTime(utcMs);
    const w = new Date(wall);
    // Chromium writes London's winter zone as "GMT+0"; Node and Firefox write "GMT". One spelling: "GMT".
    const name = shortZoneName(at, clock)
      ?.trim()
      .replace(/^GMT[+-]0(?::00)?$/, "GMT");
    const date = formatDate({ year: w.getUTCFullYear(), month: w.getUTCMonth() + 1, day: w.getUTCDate() });
    return `${date}, ${pad(w.getUTCHours())}:${pad(w.getUTCMinutes())} ${name || gmtName(offset)}`;
  } catch {
    return formatIstDateTime(utcMs);
  }
}
