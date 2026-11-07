// M7.5 D1 (Q4 A): `usage.daily`, the account's Free-plan use of one UTC day, read from Cloudflare's GraphQL Analytics API with the read-only token
// `CF_ANALYTICS_TOKEN` (Account Analytics: Read; the owner creates it, scripts/set-cf-analytics-token.ps1) and kept in `stats_daily` as `cf.*` rows
// (`@techaust/core/usage`). The 06:00 IST hourly tick (00:30 UTC, L50) only enqueues the message; this consumer makes ONE fetch (8 s timeout, no redirect
// followed) and ONE batch. Nothing personal is read or written: counts per Worker name, database id and queue action.
//   - no token or no account tag: logged and acknowledged, nothing written; outside local (L55) the owners also get one bell per IST day;
//   - a 401 or 403 (the token was revoked, expired or lost its permission): logged and acknowledged, and the same bell (L55);
//   - a timeout, a network error or a 5xx/429: retried by the queue (its dead letter is only logged: tomorrow's run reads the next day);
//   - a GraphQL error with no data, another 4xx, an answer that isn't JSON or is over the cap: logged and acknowledged (a retry can't help);
//   - partial data (a dataset missing): what came is written, the rest is logged as missing (never written as zero).
import { istDate, toIsoDate } from "@techaust/core/dates";
import {
  isUsageMessage,
  parseUsage,
  USAGE_QUERY,
  type UsageMessage,
  usageTokenBellTitle,
  usageVariables,
} from "@techaust/core/usage";
import { logEvent } from "./log.ts";

export const GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";
export const USAGE_TIMEOUT_MS = 8_000;
/** The answer is a few KB; the stream is read with a byte count and refused as soon as it passes this (L53), whatever Content-Length said. */
export const MAX_ANSWER_BYTES = 256 * 1024;

/**
 * L55: one bell per active owner per IST day (`?1` the entity `token|<IST day>`, `?2` the title; the unique key is the member, the kind and the entity).
 * Link: the dashboard, where the usage tile shows the gap.
 */
export const USAGE_TOKEN_BELL_SQL = `INSERT OR IGNORE INTO notifications (id, user_id, kind, entity_type, entity_id, title, link)
  SELECT 'n_' || lower(hex(randomblob(16))), u.id, 'usage.token', 'usage', ?1, substr(?2, 1, 300), '/'
  FROM staff_users u WHERE u.role = 'owner' AND u.status = 'active'`;

/** L55: rings the owners' token bell once per IST day; a failed write is only logged (the next day's run rings again). */
async function ringTokenBell(env: Env, day: string, reason: string, now: number): Promise<void> {
  const istDay = toIsoDate(istDate(now));
  try {
    await env.DB.prepare(USAGE_TOKEN_BELL_SQL).bind(`token|${istDay}`, usageTokenBellTitle(day)).run();
    logEvent("usage.token_bell", { reason });
  } catch (e) {
    logEvent("usage.token_bell_failed", { reason, error: e instanceof Error ? e.name : "unknown" });
  }
}

/**
 * L53: the answer's text, read with a byte count: null as soon as it passes `cap` (the rest is cancelled unread). A read that fails throws (the caller
 * retries).
 */
export async function readCapped(res: Response, cap = MAX_ANSWER_BYTES): Promise<string | null> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

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
    // L55: locally there is never a token; anywhere else a missing one means the tile stops, so the owners hear of it.
    // (`Env` is typed from the staging config, so ENVIRONMENT is read as a plain string.)
    if (String(Reflect.get(env, "ENVIRONMENT") ?? "") !== "local")
      await ringTokenBell(env, body.day, "not_configured", now);
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
    // L55: the token was refused (revoked, expired, or without Account Analytics: Read).
    if (res.status === 401 || res.status === 403)
      await ringTokenBell(env, msg.day, `http_${res.status}`, now);
    return "ack";
  }
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > MAX_ANSWER_BYTES) {
    await res.body?.cancel();
    logEvent("usage.too_large");
    return "ack";
  }
  let text: string | null;
  try {
    text = await readCapped(res);
  } catch (e) {
    logEvent("usage.fetch_failed", { error: e instanceof Error ? e.name : "unknown" });
    return "retry";
  }
  if (text === null) {
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
