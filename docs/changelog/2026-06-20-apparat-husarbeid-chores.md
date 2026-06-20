# Apparat-husarbeid → chores-view (ikke dagslista)

Dato: 2026-06-20
Status: pågår

## Kontekst

Når et apparat ble ferdig, dyttet vi automatisk gjøremål («Tøm vaskemaskin»,
«Heng opp klær», …) rett inn i **dagens dagsliste**. Det er nyttig automatikk,
men på en vaskedag (15–20 sykluser) flommer dagslista over med oppgaver brukeren
ikke nødvendigvis selv skal gjøre.

Brukerinnsikt: hvis Resonans skal fremdrive **balanse** mellom hvem som gjør hva,
er volumet et *signal* — men det bør ikke lande i den personlige dagslista.
Signalet hører hjemme i et eget **chores-view på hjem**, med en telling av
**brutto sannsynlige oppgaver vs. registrerte fullførte**.

## Faser

### Fase 1: Chores-view + telling (denne endringen)

**Datamodell (ingen schema-migrasjon):** husarbeid lagres som `checklist_items` i
én liste per bruker med `context = 'home_chores'`. Markeres med
`metadata.chore = true` (budsjett-markør) og `metadata.applianceChore = true`
(kilde). Gjenbruker eksisterende tabeller — ingen nye kolonner.

- `src/lib/domains/home/appliance-chores.ts` (ny): ren logikk —
  `APPLIANCE_CHORES`-katalog, `choresForAppliance()`, `computeChoreStats()`.
  Co-located tester i `appliance-chores.test.ts`.
- `src/lib/server/services/chore-service.ts` (ny): `addChoresForCycle()` (lager
  husarbeid i chores-lista, idempotent per `cycleId`), `getChoreStats()` (brutto
  vs. fullført, rullerende 7 dager, teller alt med `metadata.chore`),
  `listPendingChores()`, `claimCycleToDay()` (re-parenter en syklus' husarbeid til
  dagslista).
- `src/lib/server/ping-notifications.ts`: ferdig-event lager nå husarbeid via
  `addChoresForCycle()` i stedet for å skrive til dagslista. Gammel
  `createApplianceTask` fjernet.
- `src/routes/api/tema/[id]/dashboard/home/+server.ts`: returnerer `chores`
  (stats + ventende items).
- `src/lib/components/domain/HomeDashboard.svelte`: ny «🧺 Husarbeid»-seksjon med
  telling (brutto vs. fullført, progressbar) og ventende husarbeid gruppert per
  syklus. Avkryssing = registrert fullført; «+ Legg i min dag» tar syklusen inn i
  dagslista.

**Claiming (begge mekanismer):**
- Avkryssing i chores-view (`PATCH /api/checklists/[id]/items/[itemId]`).
- Push-knapp «Legg i min dag» på ferdig-varselet → `POST /api/apps/ping/claim-day`.
  - `src/service-worker.ts`: håndterer notification `actions` og `claim-day`-action
    (same-origin fetch med cookie-auth).
  - `src/lib/server/services/push-delivery-service.ts` + `web-push`-kjeden:
    `actions`/`data` føres gjennom til varselet.

### Fase 2 (planlagt, ikke bygget): rutine-/dagsoppgaver «eid av chores»

Foundation er på plass: budsjettet (`getChoreStats`) teller **alt** med
`metadata.chore = true`, ikke bare apparat-genererte. Neste steg er å la
enkelte rutine-items (morgen/kveld) og ad-hoc dagsoppgaver markeres som chores
slik at de instansieres med `metadata.chore = true` og dermed teller i
budsjettet. Krever felt på `routineDefinitions.items` + propagering ved
instansiering + en toggle i UI. Avventer produktbeslutning.

## Beslutninger

- **Eget chores-view, ikke dagslista** som standard destinasjon (løser flommen).
- **Begge** claim-mekanismer: avkryssing i chores-view + push-knapp.
- **Rullerende 7 dager** for tellingen.
- **Re-parenting** ved claim (flytter samme item) framfor kopiering — unngår
  dobbelttelling; `metadata.chore` gjør at det fortsatt teller uansett liste.
- **Kanonisk `chore`-flagg** (ikke bare `applianceChore`) i budsjett-tellingen,
  for å støtte fase 2 uten ny refaktorering.

## Verifisering

- `npm run check`: 0 errors, 0 warnings.
- `npm test`: 662 tester grønne (inkl. 7 nye for `appliance-chores`).
