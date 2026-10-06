// Browser side of the staff login (docs/05 §6.1 step 2): Argon2id over the password, run in a Web Worker so
// the page stays responsive. The result (the "client hash") is what the browser sends instead of the password.
import { argon2id } from "hash-wasm";
import { b64url, fromB64url } from "./crypto.ts";
import type { ArgonParams } from "./password.ts";

export async function clientHash(password: string, salt: string, params: ArgonParams): Promise<string> {
  const out = await argon2id({
    password: password.normalize("NFKC"),
    salt: fromB64url(salt),
    parallelism: params.p,
    iterations: params.t,
    memorySize: params.m,
    hashLength: 32,
    outputType: "binary",
  });
  return b64url(out);
}
