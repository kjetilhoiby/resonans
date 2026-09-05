# Importen tåler et avbrudd

Dato: 2026-09-05
Status: ferdig

## Kontekst

Første ekte kjøring av Strava-arkivimporten (5. september, 1019 økter) gikk
sakte, og døde etter noen minutter med **«Load failed»** i feltet. Det er ikke
en melding fra serveren — det er Safaris egen tekst for en fetch som ble drept,
og den ble drept fordi **telefonen låste skjermen** midt i en runde.

To ting gjorde utfallet verre enn nødvendig:

- **Ett `return` avsluttet HELE kjøringen.** En død runde av ~51 tok resten med
  seg.
- **Et nytt trykk begynte forfra.** Skrivingen var idempotent fra dag én
  (`findAlreadyImported` + `conflictMode: 'ignore'`), så et nytt forsøk var
  alltid TRYGT — men ikke billig: klienten sendte alle 1019 filene på nytt, og
  serveren pakket ut og parset dem for å kaste resultatet.

Målt etterpå på `/api/diagnostikk`: kjøringen skrev faktisk rader (fire
`workout_projection_refresh`-jobber opprettet 05:52–05:53 UTC). **De feilet alle
fire, 3 av 3 forsøk**, med fingeravtrykk `5acf44d8`/`db632c7f` — nye, mot de 28
gamle `a27126f1`/`7eb896ab`, og med feiltekst på 616 tegn mot 2000. Det er et
ANNET problem enn den kjente kjempe-inserten, og det er ikke løst her.

## Faser

### Fase 1: resume — serveren er fasit

`findImportedIds(userId, ids)` i `strava-import.ts` over den eksisterende
`findAlreadyImported`, eksponert som `POST /api/sensors/strava-import/status`
(JSON inn, JSON ut). Klienten spør ÉN gang før løkka og filtrerer køen.

Egen rute framfor en modus på importendepunktet: det tar `multipart/form-data`
med filer og krever manifestet, mens dette er en id-liste. En «modus» som
hopper over halve valideringen av kroppen er en gren som råtner.

### Fase 2: skjermlås

`navigator.wakeLock.request('screen')` mens kjøringen står på, sluppet i
`finally`. Feiler den, går importen videre uten — en manglende lås gjør bare
avbrudd mer sannsynlig, og fase 1 dekker det.

### Fase 3: en død runde river ikke resten

`shouldRetryBatch` og `retryDelayMs` i `$lib/domain/health/import-retry.ts`
(8 tester). Tre forsøk per runde med doblende pause; gir den seg, går løkka
VIDERE til neste runde og samler den i `deadRounds`, som vises på flaten.

## Beslutninger

- **Ingen framdrift i `localStorage`.** Den kan gå ut av takt med basen på en
  måte ingen ser: en rad skrevet i en runde der svaret aldri nådde fram ville
  stått som «ikke gjort» for alltid. Et oppslag mot radene som FINNES kan ikke
  lyve.
- **4xx retries ikke.** Samme skille som `shouldReleaseClaimOnDispatchError`:
  serveren har alt sagt hva den mener om denne kroppen, og mener det samme neste
  gang. En transportfeil har ikke fått svar i det hele tatt. 429 retries fordi
  «for fort» går over av seg selv; 5xx fordi en redeploy midt i importen er helt
  vanlig (hver push restarter containeren).
- **Et nytt forsøk er trygt fordi skrivingen er idempotent** — batchen kan i
  verste fall skrive det som alt er skrevet, og det svarer serveren «fantes fra
  før» på.
- **Resume SIES på flaten**, og framdriften måles mot denne kjøringens kø, ikke
  mot 1019. «Jobber… 20 av 1019» ville stått nesten stille gjennom en kjøring
  som var ferdig på et par minutter. Radnumrene i døde runder er merket som
  posisjon i kjøringen, siden de to er ulike etter et hopp.
- **`done` påstår ikke suksess når runder falt ut** — feltet sier hvor mange, og
  at et nytt trykk hopper over det som er inne.

## Verifisering

`npm test`: 4558 tester i 315 filer, alle grønne (8 nye på retry-regelen).
`npm run check`: 0 feil, 0 advarsler.

Typesjekken fanget noe `any` hadde skjult: løkka fikk en gren der svaret kan
være null, og da måtte responsen skrives ut. Første forsøk gjettet formen feil
på tre felt (`paceReferenceUsed` er et objekt, ikke en streng; `outcomes` er en
union der `error`/`reason` er påkrevd i hver variant). Typen speiler nå
`ImportOutcome`.

**Ikke verifisert:** resume mot ekte data. Neste trykk på knappen er prøven — og
det tallet å se etter er «N økter lå inne fra før og sendes ikke på nytt».

## Kjent rest

- **Hvorfor det gikk sakte er ikke målt.** Resume gjør prisen for et avbrudd
  proporsjonal med det som gjenstår, men gjør ikke selve kjøringen raskere.
  Utpakking i klienten skjer sekvensielt per fil, og hver skriving legger en
  projeksjonsjobb i køen — begge er kandidater, ingen av dem målt.
- **De fire feilede `workout_projection_refresh`-jobbene står igjen.** Uten dem
  når ikke de importerte øktene `canonical_workouts`, altså ingen formkurve,
  ingen år-mot-år og ingen rekorder. Feilteksten krever `/api/admin/logs`
  (admin-gatet) eller `DIAGNOSTICS_OPEN_ERRORS`.
