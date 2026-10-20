// Request shapes for the auth API, shared by the SPA and the Worker. They use `zod/mini` (tree-shakable functions,
// no method chains): the Worker bundle carries only the checks used here, not classic zod's ~150 KB. Their accept /
// reject behaviour is proved equal to the classic-zod originals on a fixed corpus (test/schemas.test.ts).
import * as z from "zod/mini";
import { isClientHash } from "./password.ts";

/** A trimmed, lower-cased, valid email (up to 254 characters). */
export const emailAddress = z.pipe(z.string().check(z.trim(), z.toLowerCase(), z.maxLength(254)), z.email());
const b64url43 = z.string().check(z.regex(/^[A-Za-z0-9_-]{43}$/));
/** The browser's Argon2id output: it must decode to 32 bytes, or the HMAC would throw (a 500 instead of a 401). */
const clientHash = z.string().check(z.regex(/^[A-Za-z0-9_-]{43}$/), z.refine(isClientHash));
const hex64 = z.string().check(z.regex(/^[0-9a-f]{64}$/));
const name = z.string().check(z.trim(), z.minLength(1), z.maxLength(100));
const code6 = z.string().check(z.regex(/^\d{6}$/));

export const saltRequest = z.object({ email: emailAddress });
export const loginRequest = z.object({ email: emailAddress, clientHash });
export const totpRequest = z.object({ challenge: z.string().check(z.maxLength(512)), code: code6 });
/** A recovery code as typed (any case, spaces or hyphens); the Worker normalises it and checks the shape. */
export const recoveryRequest = z.object({
  challenge: z.string().check(z.maxLength(512)),
  code: z.string().check(z.maxLength(40)),
});
export const stepUpRequest = z.object({ code: code6 });
export const sessionIdParam = z.object({ id: hex64 });
export const inviteStartRequest = z.object({ token: b64url43 });
/** `name`: the invitee types their own name at acceptance (the owner only chooses the email and the role). */
export const inviteFinishRequest = z.object({ token: b64url43, clientHash, name });
