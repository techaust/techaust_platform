# techaust_platform

Public website, admin and client portal for TecHaust Technologies. This repository is public (owner decision, ADR 0012): nothing secret or personal is committed.

- Rules for contributors and AI assistants: [CLAUDE.md](CLAUDE.md)
- Requirements, architecture, design, content, security and roadmap: [docs/](docs/)
- Brand assets (logos, icons, social images, print PDFs): [packages/ui/brand/](packages/ui/brand/); rules in [docs/06 §1](docs/06-design-system.md)

```bash
pnpm install
pnpm dev
pnpm check && pnpm test && pnpm build
```

Production deploys run only from the owner-triggered `deploy-prod.yml` workflow.
