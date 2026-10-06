// Argon2id runs here, off the main thread, so the page stays responsive (docs/05 §6.1 step 2).

import type { ArgonParams } from "@techaust/auth";
import { clientHash } from "@techaust/auth/client";

export type HashRequest = { password: string; salt: string; params: ArgonParams };
export type HashResponse = { ok: true; hash: string; ms: number } | { ok: false };

self.onmessage = async (e: MessageEvent<HashRequest>) => {
  const started = performance.now();
  try {
    const hash = await clientHash(e.data.password, e.data.salt, e.data.params);
    self.postMessage({ ok: true, hash, ms: Math.round(performance.now() - started) } satisfies HashResponse);
  } catch {
    self.postMessage({ ok: false } satisfies HashResponse);
  }
};
