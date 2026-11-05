// The email log's event-status rank in SQL (M7.2; run file A.5, L15), shared by the trigger set `email_event_triggers` (triggers.ts) and the SES hook's batch
// (email-events.ts). Its own module, with no imports: the jobs Worker imports the hook's batch, and `triggers.ts` would bring drizzle and the whole schema with it
// (about 100 KB, measured at the M7.2 early check).

/** The event statuses of `email_log` by rank (core `EMAIL_EVENT_RANK`, twin-tested): an event only ever moves a row up. `sent` is the floor an event starts from. */
export const EMAIL_EVENT_RANK_0074 = { sent: 1, delivered: 2, bounced: 3, complained: 4 } as const;

/** The rank of `col` (an `email_log.status` expression) as SQL: 1 to 4 for the event statuses, 0 for every other status. */
export const emailRankSql = (col: string): string =>
  `(CASE ${col} ${Object.entries(EMAIL_EVENT_RANK_0074)
    .map(([s, r]) => `WHEN '${s}' THEN ${r}`)
    .join(" ")} ELSE 0 END)`;
