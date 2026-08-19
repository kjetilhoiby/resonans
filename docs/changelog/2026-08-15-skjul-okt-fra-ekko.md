# Skjule en økt fra Ekko

Dato: 2026-08-15
Status: pågår (server ferdig, app står igjen)

## Kontekst

Etter at «Skjul» begynte å holde (`2026-08-15-skjul-okt-overlever-synken.md`)
var neste ønske å kunne gjøre det fra Ekko: gå på økta i appen, fjerne den, og
få det ryddet i Resonans i samme handling.

To ting sto i veien, og den første var ikke åpenbar.

**Ekko hadde ingen økt-liste.** App-flaten mot økter besto av
`/api/apps/upload` (skriving) og `/api/apps/workouts/[id]/analysis` (én økt på
id). Ingen av dem lister noe. Ekko kjenner sine egne opplastinger, men
søppeløkta som utløste hele saken kom fra **Withings** — den fantes bare i
Resonans, og var dermed uåtkommelig fra appen uansett hvilken slette-knapp
noen måtte bygge. Et skjule-endepunkt alene ville ikke løst oppgaven.

**Og «slette» er ikke mulig for en synket kilde.** Withings henter sju dagers
overlapp hvert femte minutt. En slettet rad ville vært tilbake innen fem
minutter — samme mekanisme som gjorde at `dismissed` ikke overlevde før forrige
rettelse, bare mer uopprettelig.

## Faser

### Fase 1: Én skjulesti, delt av begge flatene

`$lib/server/workouts/dismiss-workout.ts` (ny) eier `setWorkoutDismissed`:
oppslag → flagg → projeksjon → re-aggregering. Web-endepunktet er nå en tynn
kaller; Ekko-endepunktet er den andre.

Dette er ikke opprydding for ryddighetens skyld. Skjulestien manglet nettopp
re-aggregeringen som skrivestien alltid har hatt, og en andre kopi til Ekko
ville arvet eller mistet den rettelsen uten at noe sa fra. De rene delene
(scope-tolkning, parameterklipping) bor i `$lib/domain/health/workout-dismiss.ts`
med tester.

### Fase 2: `GET /api/apps/workouts`

Dedupliserte økter fra alle kilder, `days`/`limit` med klipping framfor 400.
Skjulte økter er ikke med — lista er det brukeren ville sett.

`id` i svaret er `sensor_events.id`, ikke canonical-id-en. Det er et bevisst
valg: `refreshForRange` sletter og bygger `canonical_workouts` på nytt, så en
canonical-id klienten har lagret kan være borte neste gang. Endepunktet godtar
begge former (samme konvensjon som `analysis`), men lista returnerer den stabile.

### Fase 3: `POST/DELETE /api/apps/workouts/[id]/dismiss`

Skjul og angre. Svaret bærer `hidden` og `reversible`, ikke `deleted`.

Kontrakten mot appen: `docs/ekko-skjul-okt.md`.

## Beslutninger

- **Skjuling, ikke sletting — og ordet følger med i API-et.** Det fristende var
  å gi Ekko et `DELETE` som fjerner raden. For en Withings-økt er det en
  operasjon som ser ut til å virke i fem minutter. Svaret sier derfor `hidden`
  og `reversible`, og kontrakten ber eksplisitt appen skrive «Skjul økt» framfor
  «Slett økt»: sier appen «slett» og økta kan gjenåpnes, har den løyet om noe
  brukeren kan etterprøve. En Ekko-egen økt *kunne* slettes hardt, men da ville
  samme knapp betydd to ulike ting avhengig av kilde — verre enn én ærlig.
- **Lista måtte til, selv om ønsket bare nevnte sletting.** Uten den er den ene
  økta brukeren faktisk ville fjerne ikke synlig i appen. Å levere bare
  skjule-endepunktet ville vært å levere halve funksjonen og kalle den ferdig.
- **`sources` er med i lista.** Den forteller hvor økta kom fra, og dermed
  hvorfor den ikke kan slettes ved roten. Uten det feltet er «skjul» en
  vilkårlig begrensning.
- **`dismiss-workout.ts` er lagt i `knownRawReaders`** med begrunnelse. Vakten
  fanget den, som den skal: skjuling MÅ treffe den rå raden, siden flagget bor
  på `sensor_events` og oppslaget er én bestemt rad på id.
- **Ingen ny støyfiltrering.** Uendret fra forrige runde, og av samme grunn.

## Verifisering

- `npm test`: 3427 tester i 250 filer, alle grønne. Elleve nye i
  `workout-dismiss.test.ts`.
- `npm run check`: 0 feil, 0 advarsler.
- `sensor-event-access`-vakten feilet først på den nye fila og ble tilfredsstilt
  med en begrunnet oppføring, ikke ved å omgå den.

## Gjenstår

App-siden i `resonans-lab/ekko`: økt-liste, «Skjul økt»-handling, og opprydding
av appens egen lokale kopi der økta er Ekkos egen. Serverdelen er bakoverkompatibel
— ingen eksisterende Ekko-kall er endret.
