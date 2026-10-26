// Browser Run pacing (M4.4, JOB-PDF-01): the Free plan allows one Quick Action request every 10 seconds. With `max_concurrency: 1`
// the consumer waits inside the message, so two calls start at least `minSpacingMs` apart. Pure: the clock and the sleep are
// passed in, so a test runs it on a fake clock.

export const DEFAULT_MIN_SPACING_MS = 10_000;
/** The longest wait the pacer ever sleeps (a bad setting cannot park a consumer for minutes: the queue allows 15 min of wall time). */
export const MAX_SPACING_MS = 60_000;

export type Clock = { now: () => number; sleep: (ms: number) => Promise<void> };

/** A real sleep: `scheduler.wait` where the runtime has it (Workers), else a timer. */
export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => {
    const s = (globalThis as { scheduler?: { wait?: (ms: number) => Promise<void> } }).scheduler;
    return typeof s?.wait === "function"
      ? s.wait(ms)
      : new Promise<void>((resolve) => setTimeout(resolve, ms));
  },
};

/** The spacing from the `PDF_MIN_SPACING_MS` var: an integer from 0 to 60 s, else the default. */
export function spacingFrom(value: string | undefined): number {
  if (value === undefined || !/^\d{1,6}$/.test(value)) return DEFAULT_MIN_SPACING_MS;
  return Math.min(Number(value), MAX_SPACING_MS);
}

/**
 * Runs `call`, then waits until `minSpacingMs` has passed since it STARTED (also when it throws), and returns its result.
 * The wait is wall time, not CPU.
 */
export async function paced<T>(
  call: () => Promise<T>,
  minSpacingMs: number,
  clock: Clock = realClock,
): Promise<T> {
  const started = clock.now();
  try {
    return await call();
  } finally {
    const wait = started + minSpacingMs - clock.now();
    if (wait > 0) await clock.sleep(wait);
  }
}
