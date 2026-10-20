// Request shapes for the auth API, shared by the SPA and the Worker.
import { z } from "zod";

const email = z.string().trim().toLowerCase().max(254).pipe(z.email());
const b64url43 = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const name = z.string().trim().min(1).max(100);

export const saltRequest = z.object({ email });
export const loginRequest = z.object({ email, clientHash: b64url43 });
export const totpRequest = z.object({ challenge: z.string().max(512), code: z.string().regex(/^\d{6}$/) });
/** A recovery code as typed (any case, spaces or hyphens); the Worker normalises it and checks the shape. */
export const recoveryRequest = z.object({ challenge: z.string().max(512), code: z.string().max(40) });
export const stepUpRequest = z.object({ code: z.string().regex(/^\d{6}$/) });
export const sessionIdParam = z.object({ id: hex64 });
export const inviteStartRequest = z.object({ token: b64url43 });
/** `name`: the invitee types their own name at acceptance (the owner only chooses the email and the role). */
export const inviteFinishRequest = z.object({ token: b64url43, clientHash: b64url43, name });
