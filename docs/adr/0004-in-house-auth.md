# ADR 0004: In-house auth instead of Better Auth

- **Status:** Accepted (2026-10-06)
- **Context and decision:** Browser Argon2id + server HMAC with a pepper, TOTP, magic links. Better Auth's ~9 ms cold start is too close to the 10 ms limit and fits two realms poorly. To be confirmed by the M1.4 CPU gate (pending).
- **Details:** [05 §6](../05-architecture.md) (authentication).
