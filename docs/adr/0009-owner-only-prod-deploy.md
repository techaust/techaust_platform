# ADR 0009: Owner-only manual production workflow

- **Status:** Accepted (2026-10-06)
- **Context and decision:** GitHub Free private repos can't enforce reviewers, so production deploys use workflow_dispatch with an actor guard, typed confirmation, a PRODUCTION_ENABLED variable and a prod-scoped token.
- **Details:** see docs/05-architecture.md.
