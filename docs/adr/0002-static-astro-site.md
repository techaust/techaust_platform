# ADR 0002: Static Astro site + hand-written /api Worker

- **Status:** Accepted (2026-10-06)
- **Context and decision:** Static pages cost no CPU. The public Worker runs only for /api/* and has no D1/R2 bindings (CI guard), so a compromise of the site can't read client data.
- **Details:** [05 §1](../05-architecture.md) and §7.4 (public endpoints).
