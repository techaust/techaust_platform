# ADR 0003: React SPA (React Router 8, data mode) + Hono per realm

- **Status:** Accepted (2026-10-06)
- **Context and decision:** No server-side rendering keeps each request within 10 ms CPU. Admin and portal are separate Workers on separate hosts.
- **Details:** [05 §4](../05-architecture.md) (Workers) and §7 (API design).
