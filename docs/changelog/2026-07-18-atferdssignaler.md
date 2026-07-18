# Atferdssignaler: observert vs. selvrapportert

Dato: 2026-07-18
Status: ferdig (dev-verifisering gjenstår)

## Kontekst

Egenfrekvens-systemet lagrer selvrapporterte pyramide-årsaker per check-in
(`reasons.actions/feelings/thoughts` med verdier som `utsetter`, `mister_oversikt`,
`fullforer_noe`) — men ingen signal-produsent leste dem, og motsatt: atferden
observeres (dagsplaner, fullføringer, quick wins, fokusøkter, naps) men ble aldri
koblet til pyramide-språket. Brukerens idé: signaler fra *hva som planlegges og hva
som fullføres*, og fra observert hvile (powernaps — aktuelt tema hjemme).
`quick_win`- og `focus_session`-events ble skrevet men konsumert av ingen, og
`domain_signals` nådde aldri chat-konteksten (CLAUDE.md hevdet det, men stemte ikke).

## Faser

### Fase 1: Ren logikk (`src/lib/domain/`)

- `sleep-goals.ts`: `pairNapsWithPriorNights` — kobler hver nap mot siste ekte natt
  som sluttet før nappen (innen 24t). Grunnlaget for «søvnunderskudd → nap»-speiling.
- Ny `observed-behavior.ts`: `classifyFollowThrough` (planlagt→fullført→snoozet/
  skippet → pct/band/severity), `classifyNapLoad` (mål-bevisst: innenfor maxPerWeek
  er alltid info), `buildObservedBehaviorLines` (norske promptlinjer; tom array →
  blokken utelates). Alt testet.

### Fase 2: Delt innsamling (`observed-behavior-service.ts`)

`collectFollowThrough7d` (dagsplan-sjekklister `week:%:day:%`, inkl. `skipped_at`/
`snoozed_to_date` — «snoozer» er bokstavelig talt målbart), `collectProactivity7d`
(quick_win/focus_session), `collectNaps7d` (readSleepNights 9 døgn for natten-før-
kobling, nap-målets maxPerWeek), `collectObservedBehaviorInputs` (+ferskt
routine_adherence_7d-signal), `buildObservedBehaviorBlock` (chat-blokken).

### Fase 3: Tre nye signal-produsenter (`signal-service.ts`)

- `sleep_powernaps_7d` (health): antall + minutter + per-nap natten-før-timer;
  `shortNightNapCount` i context; severity via nap-målet. Produseres også ved 0 naps
  (en ren uke er informasjon) — null kun uten søvndata.
- `action_follow_through_7d` (home): observert «gjort»-dimensjon; null uten plan.
- `proactive_actions_7d` (home): quick wins + fokusøkter; null ved 0.

### Fase 4: Broen

- **Chat**: `ContextService.observedBehavior` → «OBSERVERT ATFERD (siste 7 dager)»-
  blokk i systemprompten (beregnes live fra tabellene, ikke cron-avhengig; try/catch
  — aldri kritisk). Første gang domain_signals-økosystemets data når AI-konteksten.
- **Egenfrekvens**: `buildEgenfrekvensReflectionContext` fikk `observedLines` +
  speilingsinstruks i refleksjonsprompten: valider når selvbildet er hardere enn
  tallene, utfordre varmt når det er motsatt. Ingen klient-endringer — server-prompten
  vinner allerede over registry-fallbacken i FlowSheet.

## Beslutninger

- **Live-beregning i chat/egenfrekvens, cron-signaler for historikk** — blokkene
  beregner ferskt fra tabellene (samme collect-funksjoner som produsentene), så
  speilingen aldri viser gårsdagens tall; domain_signals-radene gir tidsserie.
- **0 naps produserer signal, 0 planlagte punkter gjør ikke** — en ren nap-uke er
  et datapunkt («innenfor målet»); manglende dagsplan er fravær av grunnlag.
- **Terskel 6,5t for «kort natt»** i søvnunderskudd-koblingen.
- **Floker/oversikt-øvelsen utsatt** — trenger egen flyt-design (backlog sammen med
  «ti ting som stjeler fokus»-runden).

## Verifisering

- `npm test`: 1408 grønne (nye: classifyFollowThrough, classifyNapLoad,
  buildObservedBehaviorLines, pairNapsWithPriorNights). `npm run check`: 0 feil.
- Dev: chat-melding → systemprompt inneholder OBSERVERT ATFERD-blokk når data
  finnes; egenfrekvens-checkin → refleksjonen speiler mot observert uke; cron
  `/api/cron/domain-signals` → tre nye signalType-rader i domain_signals.
