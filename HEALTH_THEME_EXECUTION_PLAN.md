# Health Theme Execution Plan

Status: In progress
Last updated: 2026-03-29
Owner: Copilot

## Goal
Fix health flow so users land in a stable Health theme experience after Withings connect without unnecessary onboarding when theme already exists.

## Constraints
- No permanent tab bar.
- Health dashboard should live inside Health theme data tab.
- New comparison charts must go through design page first before app use.
- Keep working autonomously and test frequently.

## Workstreams

### 1) Onboarding and connect behavior
- [x] Auto-create/fix missing Health theme on Withings callback.
- [x] Only trigger handoff onboarding for newly created theme.
- [x] Ensure existing Health theme users go directly to data tab without intro handoff.
- [x] Add note for future SpareBank1 parity (later scope).

### 2) Health dashboard integration
- [x] Reusable health dashboard component.
- [x] Health route uses reusable component.
- [x] Theme data tab embeds health dashboard when theme = Helse.
- [x] Validate no regressions in ThemePage interactions.

### 3) Validation and shipping
- [x] Run svelte-check after onboarding fix.
- [x] Smoke-check Withings callback types/redirect behavior.
- [ ] Commit with clear message.
- [ ] Push to main.

## Execution log
- 2026-03-29: Added reusable health dashboard and server loaders; embedded in Health theme and Health route.
- 2026-03-29: Added helper to ensure/create themes for integrations.
- 2026-03-29: Refined Withings callback onboarding: `handoff=1` is now sent only when `Helse` theme is newly created.
- 2026-03-29: Existing users with existing `Helse` theme now land directly on `tab=data` without intro handoff.
- 2026-03-29: `npm run check` executed. Result: scope files are clean, but workspace has pre-existing chart/type errors outside health/onboarding scope.
- 2026-03-29: SpareBank1 parity note: when implementing economy-theme auto-provisioning later, mirror the same `created`/`handoff` gating used in Withings callback.

## Resume notes
- Key files:
  - src/lib/server/themes.ts
  - src/routes/api/sensors/withings/callback/+server.ts
  - src/lib/components/ui/ThemePage.svelte
  - src/lib/components/ui/HealthDashboard.svelte
- If context resets, continue from Workstream 1 item 2.
