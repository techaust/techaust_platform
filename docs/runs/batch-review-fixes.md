Status: open
Tier: C
Usage: (filled in per agent run)

# Batch review fixes (UI/UX sweep and copy, after the owner's M3.4 to M4.5 test)

Branch `fix/batch-review-ui` from main at 2bde203. The owner tested all seven batch milestones on staging on 2026-10-26 and found them working apart from UI issues. Owner's words: "once you fix them we are good to go to M5". On this task's approval on staging, the batch (M3.4, M3.5, M4.1 to M4.5) is approved and M5 may start.

Plan approved by the owner (2026-10-26):
1. A full UI/UX check by the reviewer (read-only, every admin and portal screen).
2. At the same time, the lead drafts one copy page: every `[Placeholder]` line and open copy question from 07-K to 07-P, with suggested wording. The owner approves it word for word.
3. One fix task for the designer: the owner's findings, the check's findings that the lead accepts, and the approved copy.
4. Re-check by the reviewer, PR (auto-merge, Auto-fix), staging.
5. The owner looks at staging (before and after screenshots); "approved" closes the batch.

## Owner's findings (2026-10-26)
1. **Empty states on list pages** (seen on Projects): the empty-state box touches the filter panel above it (no gap), takes about half the width instead of lining up with the panel, and the Client filter field is too narrow (its hint is cut off). The shared `EmptyState` (`apps/admin/src/components/display.tsx`) is used on 19 admin screens. The Client filter hint is still a `[Placeholder]` line (copy page).
2. **Two-column forms** (seen on New care plan, Billing): fields side by side don't line up. Billing day has a hint above its input and Start date has none, so the inputs sit at different heights. In the same shot, the native date input shows the browser locale's order (10/26/2026) and its calendar icon is dark on the dark theme (barely visible).

## Staging data change by the lead (2026-10-26)
Catalogue `deliverables_md` filled for S1, S2, S4 to S7 and S10 to S14, and `assumptions_md` for S1 ("What we need from you: …"), word for word from the site's 07 content (first letter capitalised as the site does; "↔" set as an en dash, as the arrow isn't in the fonts). Direct D1 update with `wrangler d1 execute --remote`, only where the field was empty; no audit row. S9, S16 and S18 have no 07 deliverables, and no service has exclusions in 07 (owner chose "seed only 07"; empty sections are hidden when sending).

## Brief: reviewer, full UI/UX check (lead, 2026-10-26)
**Goal:** find every UI/UX defect on the admin and portal screens, so the designer can fix them in one pass. This is an audit of what is on `main`, not a diff review: there is no diff. **Change no code**, no commits.

**Allowed beyond the reviewer's usual read commands (local only):** `pnpm install --frozen-lockfile --offline`, `pnpm dev:secrets`, `pnpm db:migrate:local`, `pnpm db:seed:local`, `pnpm portal:sample`, `pnpm invite …`, `pnpm portal:link …`, the admin and portal dev servers, and making sample data through the local screens or API (names marked "(sample)", emails `@example.test`). Never touch staging or any hosted service. Stop every dev server before you report.

**Skills first:** `frontend-design:frontend-design` (as the design bar), `dataviz` (the dashboard tiles and the hours bars), `code-review` only if you read code to find a cause.

**Screens (admin):** sign-in and invite, shell and rail, dashboard, leads (list, board, lead page), clients (list, page, every tab, data-tool dialogs), projects (list, new, page and every tab), care plans (list, new, plan page, change terms, change status), time (week, entry dialog, export), catalogue (services, templates, publish), documents (list, proposal and estimate editor, PDF panel, signature control, send dialog, approvals), users, every Settings screen, the audit log, account, the bell, search.
**Screens (portal):** sign-in, callback, the home page, the offer page (view, accept, decline, confirmation), the offer-link page, not found.
**Also glance at:** a proposal PDF, an estimate PDF and the acceptance certificate, if the local setup can render them; skip and say so if it can't.

**For each screen:** 1280, 768 and 375 px wide, light and dark; the empty, loading, error and full states where they exist; dialogs open. Look for:
- **Layout:** alignment, spacing and gaps between panels, widths that don't line up, fields side by side at different heights, cut-off or overflowing text, sideways scroll at 375.
- **Controls:** native inputs in dark mode (date and time pickers, selects, checkboxes, icons), the date order (the product shows IST and Indian conventions, docs/06), 44 px targets, visible focus, keyboard order, no traps, Escape on dialogs.
- **Consistency:** the same pattern drawn the same way on every screen (filters, tables, empty states, toasts, confirmations, stale notices); tokens only.
- **Accessibility:** axe (WCAG 2.2 A/AA; a temporary copy in `public/` is fine if deleted before you report), text sizes, contrast, reduced motion.
- Console errors.

The owner's two findings above are known. Confirm them and list every screen each one affects; don't stop at them.

**Report:** most severe first. For each finding: severity, the screens affected, `file:line` of the likely cause (shared component or CSS) where you can find it, the problem and the fix you suggest. Group findings that share one cause. List every `[Placeholder]` line you saw on screen, with its screen (the lead drafts the copy). Screenshots go under `.logs/shots/batch-review-fixes/` in your worktree, with absolute filenames. End with **APPROVE** (nothing above low) or **SEND BACK**.
