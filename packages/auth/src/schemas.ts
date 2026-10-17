// Request shapes for the auth API, shared by the SPA and the Worker.
import { z } from "zod";

const email = z.string().trim().toLowerCase().max(254).pipe(z.email());
const b64url43 = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const saltRequest = z.object({ email });
export const loginRequest = z.object({ email, clientHash: b64url43 });
export const totpRequest = z.object({ challenge: z.string().max(512), code: z.string().regex(/^\d{6}$/) });
export const inviteStartRequest = z.object({ token: b64url43 });
export const inviteFinishRequest = z.object({ token: b64url43, clientHash: b64url43 });
