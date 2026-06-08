# Health + Economics Autonomous Execution Plan

Status: In progress
Last updated: 2026-03-29
Owner: Copilot

## Goals
- Build a clearer Health experience with readable widgets, simple diagrams, and mobile-first browsing patterns.
- Refactor Economics page onto the same UI pattern with shared components reused from design-oriented building blocks.
- Keep onboarding behavior strict: only run handoff intro on first-time created theme after integration connect.
- Work autonomously, test often, and push to main when stable.

## Style constraints
- Minimal ornamental style.
- Mobile-readable typography and spacing first.
- Reuse existing design primitives where sensible (`GoalRing`, `PeriodPills`, compact cards).

## Workstreams

### 1) Shared UI foundation
- [x] Add compact, reusable transaction/event list component for mobile browsing.
- [x] Add lightweight trend chart component usable in both Health and Economics.
- [x] Keep components low-ornament and high readability.

### 2) Health first
- [x] Extend health server load with recent health source + event browsing data.
- [x] Upgrade health page/dashboard with widgets + trend + event browsing using shared components.
- [x] Keep Health theme embedding compatible.

### 3) Economics on same pattern
- [x] Add summary widgets and compact trend section to economics account page.
- [x] Add mobile transaction browser panel in economics page.
- [x] Reuse shared list/chart primitives and existing account/tabs navigation.

### 4) Onboarding behavior
- [x] Apply theme ensure + created/handoff gating to SpareBank1 callback (parity with Withings).
- [x] Verify callback redirects do not always trigger onboarding.

### 5) Validation + shipping
- [x] Run targeted diagnostics after each major patch.
- [x] Run project checks and document unrelated baseline failures if present.
- [x] Commit and push increments to main.

## Execution log
- 2026-03-29: Plan initialized.
- 2026-03-29: Added shared UI components `CompactRecordList` and `CompactTrendChart` for reusable mobile browsing and compact graphs.
- 2026-03-29: Extended health loader to include sources and recent events; upgraded health dashboard with trend cards and event browsing.
- 2026-03-29: Updated ThemePage health embedding to carry source/event payload.
- 2026-03-29: Refactored economics account page with shared pills/ring widgets and new `transaksjoner` tab backed by `/api/economics/transactions`.
- 2026-03-29: Added SpareBank1 callback parity with `ensureThemeForUser` and `created`-gated handoff behavior.
- 2026-03-29: Targeted diagnostics passed for all touched files.
- 2026-03-29: Full `npm run check` executed; existing baseline chart errors remain in `BalanceChart`, `Line`, `Markers`, and `RunningProgress` outside this scope.
- 2026-03-29: Committed as `c492ddd` and pushed to `main`.
- 2026-03-29: Added editable theme instruction file under Filer-tab with API persistence, plus onboarding-future-vision seeding support.

## Resume notes
- Start with shared components under `src/lib/components/ui`.
- Then wire health data loader and health page.
- Then economics route polish + callback parity.
