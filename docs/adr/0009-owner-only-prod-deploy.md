# ADR 0009: Owner-only manual production workflow

- **Status:** Accepted (2026-10-06)
- **Context and decision:** GitHub Free private repos can't enforce reviewers, so production deploys use workflow_dispatch with an actor guard, typed confirmation, a PRODUCTION_ENABLED variable and a prod-scoped token.
- **Details:** [05 §12](../05-architecture.md) (deployment pipeline).
- **Update 2026-10-07:** the premise changed: the repository has been public since [ADR 0012](0012-public-repository.md), and public repos on GitHub Free *can* use required reviewers and environment secrets ([05-A §14](../05-research-appendix/A-stack-verification.md)). The decision stands until the owner revisits it, for example by adding a `production` environment with a required reviewer.
