# ADR 0013: New brand identity "Patina" replaces the supplied logo

- **Status:** Proposed (owner chose the concept on 2026-10-06; final approval with M1.1)
- **Date:** 2026-10-06

## Context
docs/06 (approved in Phase 4) planned to refine the owner's existing navy/orange "TECHAUST" logo. In M1.1 the owner asked for a completely new logo, favicon/profile icon and light/dark palette instead. The brief: "TecHaust" in mixed case, "calm, premium engineering".

## Decision
- **Identity:** of three concepts, the owner chose **Patina**:
  - a TH-ligature mark, one block split by a one-stroke diagonal channel
  - a custom Archivo wordmark
  - ink + verdigris on stone
- **Fonts:** Archivo + IBM Plex Mono replace Newsreader + IBM Plex Sans.
- **Generated, not hand-drawn:** the identity is generated from code (`packages/ui/src/brand/geometry.ts` → master SVG → every asset), and tests guard the geometry, contrast, fonts and print colours.
- **Audit:** refinements and scores are in [docs/11](../11-brand-audit.md).

## Consequences
- **Retired:** the old logo files in `brand-incoming/` (git-ignored, never committed).
- **Docs:** 06 §1–3 rewritten.
- **Ownership:** brand changes now happen in code, through a reviewed PR, never as one-off image edits.
- **Legal:** a trademark search is needed before printing at scale (VERIFY WITH LEGAL, 11 §4).
