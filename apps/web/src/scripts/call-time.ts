// Times in the visitor's own clock (owner, 2026-11-01; docs/07 §1 "Times"): the working hours (Mon–Sat, 10:00–19:00 IST)
// and the quote form's "Best time for a call" windows are set in IST and shown in the visitor's zone, one time only, with
// the zone's short name and no IST beside it. A visitor whose clock is on IST, and every visitor without JavaScript, sees
// the IST text the server wrote. When the window crosses the visitor's midnight its end gets "next day" (owner-approved
// words) and the weekdays move with the start ("Sun–Fri, 20:30–05:30 next day PST" in Los Angeles in winter).
// Pure (Intl only, no DOM), so Node tests it (test/forms-m24.test.ts); the page side is scripts/local-time.ts.

/** IST is UTC+5:30 all year (no daylight saving). */
export const IST_OFFSET_MIN = 330;
const MIN_MS = 60_000;
const DAY_MS = 86_400_000;

/** English short weekday names, Sunday first (Date#getUTCDay order). Fixed: the site is in English whatever the browser. */
export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** The two owner-approved words for a window that ends after the visitor's midnight. */
export const NEXT_DAY = "next day";

/**
 * A window in IST: `from` and `to` in minutes after midnight IST (`to` later than `from`, same IST day), and, for the
 * working hours, the first and last weekday it runs on (0 = Sunday … 6 = Saturday).
 */
export type IstWindow = { from: number; to: number; days?: readonly [number, number] };

/** A window as the visitor's clock reads it. `days` only when the IST window has days. */
export type LocalWindow = { days?: string; from: string; to: string; nextDay: boolean; zone: string };

/** The visitor's clock: the zone (undefined = the runtime's own), the locale for the zone's short name, an override. */
export type Clock = {
  timeZone?: string;
  /** Locale of the zone's short name ("en-US" writes PST, "en-GB" writes BST). Default "en-US". */
  locale?: string;
  /** For tests: the zone's short name at an instant, or undefined when the runtime gives none. */
  zoneName?: (at: Date) => string | undefined;
};

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const dayRange = (first: number, last: number) =>
  `${WEEKDAYS[((first % 7) + 7) % 7]}–${WEEKDAYS[((last % 7) + 7) % 7]}`;

/** The IST window in the same shape as a local one (the server's text, and India's). */
export function istWindow(w: IstWindow): LocalWindow {
  return {
    ...(w.days ? { days: dayRange(w.days[0], w.days[1]) } : {}),
    from: hhmm(w.from),
    to: hhmm(w.to),
    nextDay: false,
    zone: "IST",
  };
}

/**
 * The runs a line may break between, never inside: "Sun–Fri," · "20:30–05:30" · "next day PST" (so no line ends on
 * "Sun–" or starts with a lone "day"). Joined with spaces they are `localText`.
 */
export function textRuns(l: LocalWindow): string[] {
  return [
    ...(l.days ? [`${l.days},`] : []),
    `${l.from}–${l.to}`,
    l.nextDay ? `${NEXT_DAY} ${l.zone}` : l.zone,
  ];
}

/** A window as one line: "Mon–Sat, 10:00–19:00 IST", "Sun–Fri, 20:30–05:30 next day PST", "04:30–07:30 GMT". */
export const localText = (l: LocalWindow): string => textRuns(l).join(" ");

/** "Mon–Sat, 10:00–19:00 IST" or "10:00–13:00 IST": the text the server writes, and what India and no-script visitors read. */
export const istText = (w: IstWindow): string => localText(istWindow(w));

/**
 * Search engines run the page's scripts on a clock that is not IST, so without this the indexed text and snippets
 * would carry the crawler's zone while the meta description and the FAQ structured data say IST. A crawler keeps the
 * server's IST text (company-phone review 2). Lighthouse is not a crawler: performance runs still exercise the rewrite.
 * A phone whose name holds "bot" (a Cubot) also reads IST, which is still the true time.
 */
export const CRAWLER_UA = /bot|crawl|spider|slurp|inspectiontool/i;
export const isCrawler = (userAgent: string): boolean => CRAWLER_UA.test(userAgent);

/** "GMT", "GMT+1", "GMT-3:30", "GMT+5:45": the zone's offset when the runtime gives no short name (Intl's own form). */
export function gmtName(offsetMin: number): string {
  if (offsetMin === 0) return "GMT";
  const a = Math.abs(offsetMin);
  return `GMT${offsetMin < 0 ? "-" : "+"}${Math.floor(a / 60)}${a % 60 ? `:${pad(a % 60)}` : ""}`;
}

const wallCache = new Map<string, Intl.DateTimeFormat>();
/** The instant's wall-clock time in `timeZone`, as UTC milliseconds (so its offset is wall − instant). */
function wallClock(at: Date, timeZone: string | undefined): number {
  const key = timeZone ?? "";
  let f = wallCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    });
    wallCache.set(key, f);
  }
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(at)) if (part.type !== "literal") p[part.type] = Number(part.value);
  // Some engines still write midnight as hour 24 despite h23.
  return Date.UTC(p.year ?? 0, (p.month ?? 1) - 1, p.day ?? 1, (p.hour ?? 0) % 24, p.minute ?? 0);
}

function shortZoneName(at: Date, clock: Clock): string | undefined {
  if (clock.zoneName) return clock.zoneName(at);
  try {
    return new Intl.DateTimeFormat(clock.locale ?? "en-US", {
      timeZone: clock.timeZone,
      timeZoneName: "short",
    })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value;
  } catch {
    return undefined;
  }
}

/**
 * The IST window `w` on today's IST date (the day of `now` in India) as the visitor's clock reads it, or null when that
 * clock is on IST already (the server's IST text stays). Daylight saving is the one in force on that date.
 */
export function localWindow(w: IstWindow, now: Date, clock: Clock = {}): LocalWindow | null {
  const istDay = Math.floor((now.getTime() + IST_OFFSET_MIN * MIN_MS) / DAY_MS) * DAY_MS;
  const start = new Date(istDay + (w.from - IST_OFFSET_MIN) * MIN_MS);
  const end = new Date(istDay + (w.to - IST_OFFSET_MIN) * MIN_MS);
  const wallStart = wallClock(start, clock.timeZone);
  const wallEnd = wallClock(end, clock.timeZone);
  const offset = Math.round((wallStart - start.getTime()) / MIN_MS);
  if (offset === IST_OFFSET_MIN) return null;
  const startDay = Math.floor(wallStart / DAY_MS);
  const shift = startDay - istDay / DAY_MS;
  const time = (wall: number) => hhmm(Math.round((wall - Math.floor(wall / DAY_MS) * DAY_MS) / MIN_MS));
  // Chromium writes London's winter zone as "GMT+0"; Node and Firefox write "GMT". One spelling: "GMT".
  const name = shortZoneName(start, clock)
    ?.trim()
    .replace(/^GMT[+-]0(?::00)?$/, "GMT");
  return {
    ...(w.days ? { days: dayRange(w.days[0] + shift, w.days[1] + shift) } : {}),
    from: time(wallStart),
    to: time(wallEnd),
    nextDay: Math.floor(wallEnd / DAY_MS) > startDay,
    zone: name || gmtName(offset),
  };
}
