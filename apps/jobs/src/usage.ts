// M7.5 D1 (Q4 A): `usage.daily`, the account's Free-plan use of one UTC day, read from Cloudflare's GraphQL Analytics API with the read-only token
// `CF_ANALYTICS_TOKEN` (Account Analytics: Read; the owner creates it, scripts/set-cf-analytics-token.ps1) and kept in `stats_daily` as `cf.*` rows
// (`@techaust/core/usage`). The 03:30 IST cron only enqueues the message; this consumer makes ONE fetch (8 s timeout, no redirect followed) and ONE
// batch. Nothing personal is read or written: counts per Worker name, database id and queue action.
//   - no token or no account tag (local, production until L3): logged and acknowledged, nothing written;
//   - a timeout, a network error or a 5xx/429: retried by the queue (its dead letter is only logged: tomorrow's run reads the next day);
//   - a GraphQL error with no data, a 4xx, an answer that isn't JSON: logged and acknowledged (a retry can't help);
//   - partial data (a dataset missing): what came is written, the rest is logged as missing (never written as zero).
import {
  isUsageMessage,
  parseUsage,
  USAGE_QUERY,
  type UsageMessage,
  usageVariables,
} from "@techaust/core/usage";
import { logEvent } from "./log.ts";

export const GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";
export const USAGE_TIMEOUT_MS = 8_000;
/** The answer is a few KB; anything over this is refused unread past the cap. */
const MAX_ANSWER_BYTES = 256 * 1024;

/**
 * Clears the day's rows of the metrics this reading has (`?1` day, `?2` the rows JSON), then writes them again (one transaction): a rerun leaves exactly the
 * newest reading, and a dataset missing from a partial answer keeps its earlier rows.
 */
export const USAGE_CLEAR_SQL =
  "DELETE FROM stats_daily WHERE date = ?1 AND metric IN (SELECT DISTINCT json_extract(j.value, '$.metric') FROM json_each(?2) j)";
/** `?1` day, `?2` time, `?3` rows JSON. */
export const USAGE_INSERT_SQL = `INSERT INTO stats_daily (date, metric, dimension, value, updated_at)
  SELECT ?1, json_extract(j.value, '$.metric'), json_extract(j.value, '$.dimension'), json_extract(j.value, '$.value'), ?2 FROM json_each(?3) j WHERE true
  ON CONFLICT(date, metric, dimension) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`;

export type UsageVerdict = "ack" | "retry";

/** Handles one `usage.daily` message. */
export async function processUsage(env: Env, body: unknown, now = Date.now()): Promise<UsageVerdict> {
  if (!isUsageMessage(body)) {
    logEvent("usage.invalid_message");
    return "ack";
  }
  const token = (Reflect.get(env, "CF_ANALYTICS_TOKEN") as string | undefined) ?? "";
  const account = String(Reflect.get(env, "CF_ACCOUNT_TAG") ?? "");
  if (!token || !account) {
    logEvent("usage.not_configured", { token: token !== "", account: account !== "" });
    return "ack";
  }
  return readAndStore(env, body, token, account, now);
}

async function readAndStore(
  env: Env,
  msg: UsageMessage,
  token: string,
  account: string,
  now: number,
): Promise<UsageVerdict> {
  let res: Response;
  try {
    res = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: USAGE_QUERY, variables: usageVariables(account, msg.day) }),
      // workerd accepts "manual" (never "error"; #168): a redirect is an answer we don't follow.
      redirect: "manual",
      signal: AbortSignal.timeout(USAGE_TIMEOUT_MS),
    });
  } catch (e) {
    logEvent("usage.fetch_failed", { error: e instanceof Error ? e.name : "unknown" });
    return "retry";
  }
  if (res.status >= 500 || res.status === 429) {
    await res.body?.cancel();
    logEvent("usage.http", { status: res.status });
    return "retry";
  }
  if (res.status !== 200) {
    await res.body?.cancel();
    logEvent("usage.http", { status: res.status });
    return "ack";
  }
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > MAX_ANSWER_BYTES) {
    await res.body?.cancel();
    logEvent("usage.too_large");
    return "ack";
  }
  let text: string;
  try {
    text = await res.text();
  } catch (e) {
    logEvent("usage.fetch_failed", { error: e instanceof Error ? e.name : "unknown" });
    return "retry";
  }
  if (text.length > MAX_ANSWER_BYTES) {
    logEvent("usage.too_large");
    return "ack";
  }
  const parsed = parseUsage(text);
  if (!parsed.ok) {
    logEvent("usage.unread", { reason: parsed.reason });
    return "ack";
  }
  await env.DB.batch([
    env.DB.prepare(USAGE_CLEAR_SQL).bind(msg.day, JSON.stringify(parsed.rows)),
    env.DB.prepare(USAGE_INSERT_SQL).bind(msg.day, now, JSON.stringify(parsed.rows)),
  ]);
  logEvent("usage.recorded", {
    day: msg.day,
    rows: parsed.rows.length,
    missing: parsed.missing.join(",") || undefined,
    errors: parsed.errors || undefined,
  });
  return "ack";
}
