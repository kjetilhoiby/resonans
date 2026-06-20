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

**Claiming i chores-view:**
- Avkryssing = registrert fullført (`PATCH /api/checklists/[id]/items/[itemId]`).
- «+ Legg i min dag»-knapp per syklus → `POST /api/apps/ping/claim-day`
  (re-parenter syklusens husarbeid til dagslista).

> Vurdert og forkastet: en «Legg i min dag»-action-knapp direkte på ferdig-pushen.
> Notification action-knapper støttes ikke i web push på iOS/iPadOS (Apple
> ignorerer `actions`), og appen brukes primært på iPhone. Claiming holdes derfor
> i chores-viewet, og ferdig-varselet forblir et rent signal.

### Fase 2: rutine-/dagsoppgaver «eid av chores» via «chore:»-prefiks

Budsjettet (`getChoreStats`) teller **alt** med `metadata.chore = true`, ikke bare
apparat-genererte. For at rutine- og dagsoppgaver skal kunne eies av chores, ble
det innført en tekst-konvensjon på linje med «kjøp:»:

- `parseChorePrefix()` i `appliance-chores.ts` (ren, testet): et item-tekst som
  starter med «chore:» strippes og får `metadata.chore = true`.
- `checklist-item-builder.ts`: parser prefikset for alle manuelle/AI/dagsplan-items.
  `chore` lagt til i `PARSE_DERIVED_METADATA_KEYS` så re-parsing ved redigering
  følger med (legger man til/fjerner «chore:» oppdateres flagget).
- `routine-service.ts`: begge instansieringsstedene parser prefikset, slik at et
  rutine-item «chore: Tøm oppvask» (morgen/kveld) instansieres med
  `metadata.chore = true` og teller i budsjettet hver dag det dukker opp.

Slik kan f.eks. faste morgen-/kveldsrutine-gjøremål inngå i samme balanse-telling
som apparat-husarbeidet, uten ny UI.

## Beslutninger

- **Eget chores-view, ikke dagslista** som standard destinasjon (løser flommen).
- **Claiming i chores-view** (avkryssing + «Legg i min dag»). Push-action-knapp
  forkastet pga. manglende iOS-støtte.
- **Rullerende 7 dager** for tellingen.
- **Re-parenting** ved claim (flytter samme item) framfor kopiering — unngår
  dobbelttelling; `metadata.chore` gjør at det fortsatt teller uansett liste.
- **Kanonisk `chore`-flagg** (ikke bare `applianceChore`) i budsjett-tellingen,
  for å støtte fase 2 uten ny refaktorering.
- **«chore:»-prefiks** (tekst-konvensjon) framfor egen UI-toggle for å markere
  rutine-/dagsoppgaver som husarbeid — konsistent med «kjøp:».

## Verifisering

- `npm run check`: 0 errors, 0 warnings.
- `npm test`: 662 tester grønne (inkl. 7 nye for `appliance-chores`).
