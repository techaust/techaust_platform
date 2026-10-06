# techaust_platform

Public website, admin and client portal for TecHaust Technologies. Private repository.

- Rules for contributors and AI assistants: [CLAUDE.md](CLAUDE.md)
- Requirements, architecture, design, content, security and roadmap: [docs/](docs/)

```bash
pnpm install
pnpm dev
pnpm check && pnpm test && pnpm build
```

Production deploys run only from the owner-triggered `deploy-prod.yml` workflow.
