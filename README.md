# techaust_platform

Public website, admin and client portal for TecHaust Technologies. This repository is public (owner decision, ADR 0012): nothing secret or personal is committed.

- Rules for contributors and AI assistants: [CLAUDE.md](CLAUDE.md)
- Where things stand: [docs/12-status.md](docs/12-status.md) · decisions: [docs/13-decisions.md](docs/13-decisions.md) · merged changes: [CHANGELOG.md](CHANGELOG.md)
- Requirements, architecture, design, content, security and roadmap: [docs/](docs/)
- Brand assets (logos, icons, social images, print PDFs): [packages/ui/brand/](packages/ui/brand/); rules in [docs/06 §1](docs/06-design-system.md)

Prerequisites: Node 24 (`.nvmrc`) and pnpm (any 12.x; it switches itself to the pinned 12.9.1).

```bash
pnpm install
pnpm dev
pnpm check && pnpm test && pnpm build
```

Production deploys run only from the owner-triggered `deploy-prod.yml` workflow.
