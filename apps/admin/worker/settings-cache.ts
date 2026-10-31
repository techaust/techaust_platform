// The per-isolate settings cache (M6.2 CPU diagnosis, lead decision 2, 2026-11-01): resolving a settings row (JSON parse, the defaults under it, the zod check)
// cost 1.1 to 1.5 ms on an isolate's first request and 0.2 ms warm, on every invoice path. A row is resolved once per isolate for each exact stored text and
// version: the key is the group, the row's `version` and its whole stored `value`, so a saved change (a new version, a new text) is a new key and is resolved
// afresh on the next read; nothing is ever served from an older row. The results are deep-frozen, so no caller can change what the next request reads.
// Holds only settings values (company, tax, terms, numbering, email, gateways): no personal data, nothing from a request. At most 64 entries; the map is
// cleared when full (a long-lived isolate that saw many saves never grows without bound).
import { resolveSetting, type SeededSettingKey, type Settings } from "@techaust/core/settings";

const MAX_ENTRIES = 64;
const cache = new Map<string, unknown>();

/** Freezes `v` and everything inside it (settings values are plain JSON: objects, arrays, strings, numbers, booleans, null). */
export function deepFreeze<T>(v: T): T {
  if (v !== null && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v as Record<string, unknown>)) deepFreeze(x);
  }
  return v;
}

/** A stored settings row as the readers select it (`key, value, version`), or undefined when the group was never saved. */
export type StoredSetting = { readonly value: string; readonly version: number };

/**
 * `resolveSetting(key, JSON.parse(row.value))`, once per isolate for each exact (key, version, value); undefined: the defaults. A corrupted row still throws (a
 * 500), every time: nothing is cached for it.
 */
export function cachedSetting<K extends SeededSettingKey>(
  key: K,
  row: StoredSetting | undefined,
): Settings[K] {
  const ck = row ? `${key}\u0000${row.version}\u0000${row.value}` : `${key}\u0000`;
  const hit = cache.get(ck);
  if (hit !== undefined) return hit as Settings[K];
  const value = deepFreeze(resolveSetting(key, row ? JSON.parse(row.value) : undefined));
  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(ck, value);
  return value;
}

/** How many resolved rows this isolate holds (tests only). */
export const settingsCacheSize = (): number => cache.size;
