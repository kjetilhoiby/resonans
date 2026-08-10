# En vei inn for nye treningsøkter

Dato: 2026-08-10
Status: ferdig

## Kontekst

«Når jeg har løpt i Ekko postes gpx-en til Resonans direkte. Det tar likevel lang
tid før jeg ser den i Resonans eller får push-varsel. Hvorfor?»

Opplastingen var ikke problemet. Ekko sender GPX-en synkront når økta stoppes
(`TrackingViewModel.uploadToResonans`), og `/api/apps/upload` skriver
`sensor_events`-raden med en gang. Problemet var at endepunktet ikke gjorde noe
*mer*: all etterbehandling av en økt lå inni Withings-synken og Dropbox-importen,
i hver sin kopi.

Konkret, før denne endringen:

| Etterbehandling | Ekko-opplasting | Dropbox-import | Withings-synk |
|---|---|---|---|
| `sensor_events` + projeksjon | ✅ umiddelbart | ✅ | ✅ |
| Push-varsel | ❌ **aldri** | ✅ | bare yoga |
| Autohaking (dag/uke) | ❌ | ❌ | ✅ |
| Målprogresjon på oppgaver | ❌ | ❌ | ✅ |
| Aggregater (`sensor_aggregates`) | ❌ | ❌ | ❌ |

Konsekvensene brukeren faktisk merket:

- **Pushen kom fra Dropbox-importen av den samme turen.** `notifyUserAboutImportedWorkouts`
  hadde tre kallsteder — `dropbox-sync.ts` og to e-postimportører — og ingen av
  dem var Ekko. Ventetiden var «når landet fila i Dropbox» pluss opptil 5 minutter
  cron, altså vilkårlig og ofte lang.
- **Form- og belastningskortene ventet til neste morgen.** `sensor_aggregates`
  skrives bare av `/api/cron/aggregate` (`0 3 * * *` UTC = 05:00 Oslo). Verken
  upload, dropbox-sync eller withings-synken aggregerte. En kveldstur var derfor
  ikke i CTL/ATL/TSB-kurven (`loadDailyEffort` i `training-dashboard.ts`) før
  dagen etter.
- **Haker og progresjon ventet på klokka.** `registerWorkoutsAsProgress` filtrerer
  på `createdAt >= syncStartTime`, altså kun rader skrevet *under den Withings-synken*.
  En Ekko-opplasting fra tre minutter tidligere falt helt utenfor det vinduet.

Selve økta *dukket* opp med en gang i aktivitetslista og i ukas effort-budsjett —
de leser live gjennom `buildUnifiedWorkoutActivities`/`canonical_workouts`. Så
«ser den ikke» avhang av hvor man så, noe som gjorde symptomet vanskelig å feste.

## Faser

### Fase 1: Delt beslutningslogikk

`src/lib/domain/health/workout-followup.ts` — ren, testet, ingen DB.

- `selectClustersToNotify` — hvilke aktivitetsklynger som skal varsles om.
- `pickLinkEvent` — hvilken kilde varselet skal lenke til.
- `selectFollowupDays` — hvilke Oslo-dager som skal autohakes.
- `aggregationStartDate` — hvor langt tilbake aggregeringen skal gå.

18 enhetstester i `workout-followup.test.ts`.

### Fase 2: Dedup-tabell

`workout_notifications` (migrasjon `0052_workout_notifications.sql`), unik på
`(user_id, sensor_event_id)`.

### Fase 3: Én delt inngang

`src/lib/server/workouts/after-workout-write.ts` — `runAfterWorkoutWrite` gjør,
i rekkefølge og med hvert steg i sin egen try/catch: aggregering → autohaking
(dag + uke) → målprogresjon → varsling.

### Fase 4: De tre kallstedene

- `routes/api/apps/upload/+server.ts` — kaller via `runInBackground` (waitUntil),
  så svaret til Ekko ikke blir tregere. Appen venter på det svaret før den kan
  merke økta som opplastet.
- `integrations/dropbox-sync.ts` — det direkte `notifyUserAboutImportedWorkouts`-kallet
  erstattet. `fullRescan` sendes videre som `backfill`.
- `integrations/withings-sync.ts` — den dupliserte autohak/progresjon-blokka
  erstattet. `notify: false`.

### Fase 5: `wasExisting` på skriveresultatet

`SensorEventService.write`/`writeMany` returnerer nå `wasExisting`, slik at
Withings-synken kan skille en ny økt fra en omskrevet uendret rad.

## Beslutninger

**Varselet dedupliseres per KILDE, ikke per klynge.** Klyngens `activityId` er
dens *eldste* evidence-event, og den flytter seg når en kilde med tidligere
tidsstempel lander etterpå — en Withings-rad stemplet 15:58 overtar id-en fra
Ekko-raden på 16:00. En dedup på `activityId` ville derfor sluppet varsel nummer
to gjennom for den samme turen. Vi bokfører i stedet én rad per kilde i klynga,
og hopper over hele klynga hvis *én* av kildene er varslet om før. Dette er
samme prinsipp som «treningsøkter teller én gang, aldri per kilde», anvendt på
varsling. Dekket av testen «varsler ikke to ganger selv om klyngens id flytter
seg til den nye kilden».

**Withings beholder sin egen smale varsling (`notify: false`).**
`notifyWithingsSyncResults` pusher bare på yoga og vekt, og det er et bevisst
produktvalg: klokka registrerer gåturer og småøkter av seg selv, og et varsel per
stykk ville blitt støy. De øvrige stegene deles.

**Bokføring skjer FØR utsending.** To samtidige skrivinger av samme tur (Ekko
laster opp i samme minutt som Dropbox-cronen importerer den) ville ellers begge
sett «ingen varsel sendt» og sendt hver sin. Unik-indeksen avgjør hvem som vant.
Prisen er at et varsel som feiler under utsending ikke prøves på nytt — riktig vei
å bomme, siden en tapt push er en økt du ser neste gang du åpner appen, mens
dobbeltvarsling er den støyen som får folk til å skru av varsler for godt.

**To ulike aldersvakter, med ulik begrunnelse.** `NOTIFY_MAX_AGE_DAYS` (7) hindrer
at en backfill tømmer varslingskanalen for tillit. `FOLLOWUP_MAX_AGE_DAYS` (7)
hindrer at en full Withings-synk løper `autocheckChecklistItemsForDay` én gang per
kalenderdag siden 2017 — tusenvis av spørringer inne i en synk med 120 sekunders
tak. `selectFollowupDays` returnerer `skipped` som logges, så en kapping ikke ser
ut som «alt ble behandlet».

**`AGGREGATE_MAX_LOOKBACK_DAYS` (90) er et tak, ikke en policy.** En økt datert
flere år tilbake skal ikke dra en full historikk-rebuild inn i en
opplastings-request. Nattjobbens `aggregateAllPeriods` tar de tilfellene.

**`wasExisting` er det som holder Withings-cronen billig.** Den inkrementelle
synken henter 7 dagers overlapp hvert 5. minutt for å fange retroaktive revisjoner
fra Withings. Uten filteret ville hver kjøring dratt med seg en re-aggregering av
en hel uke, døgnet rundt. Prisen er at en *revidert* økt ikke re-aggregeres før
nattjobben; projeksjonen oppdateres uansett, og det er den øktlistene leser.

**Varselet lenker til kilden med GPS-spor.** `/aktivitet/[id]` slår opp én
`sensor_events`-rad, så en lenke til en Withings-rad uten `trackPoints` ville gitt
et kart uten strek — selv når Ekko-raden ved siden av har hele sporet.

## Verifisering

- 18 nye enhetstester i `src/lib/domain/health/workout-followup.test.ts`.
- `npm test`: 3047 tester i 229 filer passerer.
- `npm run check`: 0 feil, 0 advarsler.
- `npm run build`: går gjennom.

**Ikke verifisert mot prod.** Sjekk etter neste løpetur i Ekko:

1. Vercel-loggen skal ha én `[after-workout-write] source=ekko_upload …`-linje
   med `aggregated=1 autocheck=1 progress=1 notified=1`.
2. Pushen skal komme innen sekunder, ikke minutter.
3. Lander den samme turen fra Dropbox eller klokka etterpå, skal den linja si
   `notified=0 dedup=1` — og telefonen skal være stille.

## Gjenstår

- `registerWorkoutsAsProgress` (kalt fra withings-synkens cron) har fortsatt sitt
  `createdAt >= syncStartTime`-vindu og ser derfor aldri en Ekko-opplasting. Den
  overlapper i formål med `syncSensorProgressForTasks`, som nå kjøres fra alle tre
  inngangene. Om den fortsatt trengs er ikke avklart.
- `/api/cron/domain-signals` går fortsatt bare hver time på :15.
