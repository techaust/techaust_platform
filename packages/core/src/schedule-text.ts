// Payment-schedule text for the public site (WEB-SVC-05), formatted from the catalogue entry's steps and never typed:
// 40/30/30 → "40 % on acceptance, 30 % at the midpoint milestone, 30 % on delivery"; one full step → "Paid in full
// upfront" or "Monthly in advance". Percentages are basis points (integers); no floats. VERIFY WITH CA/LEGAL: the
// schedule itself is a setting (Q-P3-6), this only words it.

export const SCHEDULE_TRIGGERS = ["on_accept", "milestone", "delivery", "monthly"] as const;
export type ScheduleTrigger = (typeof SCHEDULE_TRIGGERS)[number];
export type ScheduleStepLike = { label: string; pctBp: number; trigger?: ScheduleTrigger };

/** 4000 → "40", 3350 → "33.5", 125 → "1.25". */
export function percentFromBp(bp: number): string {
  if (!Number.isSafeInteger(bp) || bp < 0) {
    throw new RangeError(`Basis points must be a non-negative integer: ${bp}`);
  }
  const whole = Math.trunc(bp / 100);
  const frac = String(bp % 100)
    .padStart(2, "0")
    .replace(/0+$/, "");
  return frac === "" ? String(whole) : `${whole}.${frac}`;
}

const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);
const PREPOSITION = /^(at|on|after|before)\b/i;
const hasPreposition = (label: string): boolean => PREPOSITION.test(label);

function when(step: ScheduleStepLike): string {
  switch (step.trigger) {
    case "on_accept":
      return "on acceptance";
    case "delivery":
      return "on delivery";
    case "monthly":
      return "monthly in advance";
    case "milestone":
      return hasPreposition(step.label) ? lowerFirst(step.label) : `at the ${lowerFirst(step.label)}`;
    default:
      return lowerFirst(step.label);
  }
}

/** The schedule as one sentence fragment. The steps must add up to 100 %. */
export function scheduleText(steps: readonly ScheduleStepLike[]): string {
  if (steps.length === 0) throw new RangeError("A payment schedule needs at least one step");
  if (steps.reduce((a, s) => a + s.pctBp, 0) !== 10_000) {
    throw new RangeError("Schedule steps must add up to 100 %");
  }
  const [only] = steps;
  if (only && steps.length === 1) {
    if (only.trigger === "monthly") return "Monthly in advance";
    if (only.trigger === "on_accept") return "Paid in full upfront";
    return `Paid in full ${when(only)}`;
  }
  return steps.map((s) => `${percentFromBp(s.pctBp)} % ${when(s)}`).join(", ");
}
