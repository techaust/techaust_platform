// Canonical JSON and SHA-256, the same two functions as packages/core/src/hash.ts on the M4.3 branch (`canonicalJson`, `sha256Hex`).
// Kept here until M4.3 is on `main`; the lead replaces this file with `export * from "@techaust/core/hash"` at the phase 2 merge
// (a test pins the format, so a difference would fail).

/** JSON with sorted keys and no spaces: the same data always gives the same text, so the same SHA-256. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(",")}}`;
}

/** Lower-case hex SHA-256 of a string. */
export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}
