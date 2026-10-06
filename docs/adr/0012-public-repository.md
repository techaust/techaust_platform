# ADR 0012: Public repository, protected main, fork-safe workflows

- **Status:** Accepted (2026-10-06)
- **Context:** The owner made `techaust/techaust_platform` public (it may go private later). Public repos get free Actions minutes and branch protection on GitHub Free, but everything committed is published and fork PRs can run workflows.
- **Decision:** (1) Branch protection on `main`: PR + CI `checks` required, linear history, admins included. (2) `deploy-staging.yml` runs only for `push` events on this repository's `main`, never for fork PRs; CI holds no secrets. (3) Nothing sensitive (secrets, personal or client data, new business-confidential material) is committed. (4) If the repo goes private on GitHub Free, re-check branch protection and the Actions billing block.
- **Risks accepted by the owner:** `docs/` already published the live site's unfixed weaknesses and business plans (see docs/08 §0 U-6; exact reproduction payloads redacted 2026-10-07, [01-A](../01-audit-appendix/A-code-build-security.md); the findings and severity stay).
