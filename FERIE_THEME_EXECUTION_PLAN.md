# Ferie Theme Execution Plan

Status: Fase 1 ferdig (DB-verifisering gjenstår) — Fase 2 & 3 ikke startet
Last updated: 2026-06-03
Owner: Claude
Branch: `claude/family-vacation-planning-ytQvk`

## Goal
Gi familien et eget **ferie**-dashboard, distinkt fra reise (`TripDashboard`).
Kjernen er en *oppholdsplan*: hvem av familiemedlemmene er dekket/udekket hver dag
i en ferieperiode, slik at man ser når man **må** eller **kan** ta ut ferie, og kan
grovplanlegge reiser inni ferien.

## Modell (avklart med bruker)
Subtraktiv: barn har normalt positivt oppholdstilbud (skole/bhg/AKS). I ferier stenger
dette → et **hull** (negativt oppholdstilbud). Hullet fylles med alternativt tilbud
(sommerskole, fotballskole, svømmeskole, sommer-AKS, besteforeldre, leir) eller av en
hjemmeværende/ferierende forelder. Arbeidsflyt: **lag hullet først**, fyll det, se hva
som gjenstår udekket.

Per celle (medlem × dag):
- blank = normal dekning (barn: åpen skole/bhg/aks — voksen: jobb)
- `stengt` = hull
- positiv status = fylt hull (grønn); voksen `ferie`/`hjemme` = dekker barnas hull
- gjenstående gap (rød) = barn `stengt` OG ingen voksen hjemme den dagen

## Constraints
- Ferie er distinkt fra reise — ikke gjenbruk `TripDashboard`.
- Følg DB-rutinen i CLAUDE.md: eksplisitt idempotent SQL-migrasjon er autoritativ.
- Dark-tema-konvensjoner (`--tp-*`-variabler), ingen lokal tab-bar.
- `parentTheme` er en kategori-tekst, IKKE en tema-FK → reiser kobles via
  `ferieProfile.trips[].linkedThemeId`.

## Workstreams

### Fase 1 — Oppholdsplanen (ferdig)
- [x] `themes.ferie_profile` JSONB i `schema.ts`
- [x] Idempotent SQL-migrasjon `scripts/db-migrations/0010_theme_ferie_profile.sql`
- [x] Dashboard-type `'ferie'` splittet ut fra `'travel'` i `theme-dashboard-registry.ts`
- [x] `ferie` lagt til i `DashboardPayloadMap` (`dashboard-cache.ts`)
- [x] API `PUT/GET /api/tema/[id]/ferie/+server.ts` (speiler trip-endepunktet)
- [x] Placeholder `GET /api/tema/[id]/dashboard/ferie/+server.ts`
- [x] Wiring: `+page.server.ts` (load `ferieProfile`), `+page.svelte`, `ThemePage.svelte`
      (`isFerie`, `availableTabs`, `currentFerieProfile`, render-gren, import)
- [x] `FerieDashboard.svelte`: medlemsoppsett (fra `persons` + manuelt), ferievindu,
      «Lag hullet»-knapp, palett + bulk-maling, dekningskalender (dager × medlemmer,
      sticky dato-kolonne, ukenummer-grupper, helger tonet), hull-teller, autolagring
- [x] `manage_theme`: `ferieStartDate`/`ferieEndDate`/`ferieType` for opprettelse via chat
- [x] `npm run check` grønn (0 feil)
- [x] Produksjonsbygg `✔ done` (med dummy-env, da miljøet mangler `DATABASE_URL`)
- [ ] **Ende-til-ende-verifisering mot DB** (krever miljø med `DATABASE_URL`):
      kjør `npm run db:sql-migrate`, opprett «Sommerferie»-tema, test hull→fyll→gap-flyt,
      bekreft persistens, bekreft at reise-tema fortsatt får `TripDashboard`
- [ ] Lag PR (avventer brukerens ønske)

### Fase 2 — Reiser på tidslinje (ikke startet)
- [ ] Render `ferieProfile.trips[]` som blokker oppå oppholdsplanen (sted + datoer)
- [ ] «Forfrem til reise-tema»-knapp: opprett reise-tema med `tripProfile` fra blokka,
      lagre `linkedThemeId` tilbake, lenk til reise-temaets `TripDashboard`
- [ ] UI for å legge til / redigere / slette grove reise-blokker

### Fase 3 — Feriedagbok (ikke startet)
- [ ] Ny `ReflectionKind` `'feriedagbok'` i `src/lib/server/reflections.ts`
- [ ] Per-dag dagbok (sted + setning) lagret i `reflections` (themeId + periodKey=ISO-dato)
- [ ] Værvarsel-snapshot via `src/lib/utils/weather.ts` (api.met.no)

## Execution log
- 2026-06-03: Designdiskusjon med bruker. Avklart: fasevis, rikt status-sett, flagg
  dekningshull (uten feriedag-teller), grove reise-blokker → forfrem til reise-tema.
- 2026-06-03: Bruker presiserte subtraktiv modell (lag hullet først, fyll, se gjenstående).
  Planen skrevet om rundt dekning/hull/fyll-klasser.
- 2026-06-03: Fase 1 implementert. Schema + migrasjon 0010, registry-splitt, API-endepunkt,
  `FerieDashboard.svelte`, ThemePage-wiring, manage_theme-parametere.
- 2026-06-03: `npm run check` → 0 feil. Produksjonsbygg → `✔ done`. Ende-til-ende mot DB
  ikke kjørt (miljøet har ingen `DATABASE_URL`).
- 2026-06-03: Committet `2d95789` og pushet til `claude/family-vacation-planning-ytQvk`.

## Resume notes
- Nøkkelfiler:
  - `src/lib/components/domain/FerieDashboard.svelte` (hovedkomponent)
  - `src/lib/db/schema.ts` (`themes.ferieProfile`)
  - `scripts/db-migrations/0010_theme_ferie_profile.sql`
  - `src/lib/domain/theme-dashboard-registry.ts` (matcher + definisjon)
  - `src/routes/api/tema/[id]/ferie/+server.ts`
  - `src/lib/components/domain/ThemePage.svelte` (render-gren `isFerie`)
  - `src/lib/ai/tools/manage-theme.ts` (ferie-parametere)
- Hvis kontekst nullstilles: fullfør DB-verifiseringen i Fase 1, og fortsett deretter
  på Fase 2 (reiser på tidslinje). `ferieProfile.trips[]` er allerede definert i
  schema-typen og klar til bruk.
