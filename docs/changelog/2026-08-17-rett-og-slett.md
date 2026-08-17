# «Rett og slett» — en kaskade fra Ekko gjennom Resonans og Apple Helse

Dato: 2026-08-17
Status: ferdig

## Kontekst

Felttest 17. august 2026 (sykkel til jobb, 19 min hver vei): økta ble startet gjennom Live
med sykkel som idrett, men landet som **løping**. Coachingen fulgte løpemodus, «Start
runder her» sto på en elsykkeltur, og økta ble lagret som løp — med **PR på 5 km i 12:25**,
altså tolv sekunder raskere enn verdensrekorden.

Rekorden nådde tre flater: Ekko, Resonans og Strava.

To ting manglet, og de er ulike:

1. **En vakt** mot at et umulig tall får bli en rekord. Den kom i #311
   (`isImplausibleEffort`, `WORLD_RECORD_SECONDS`) sammen med et
   vedlikeholdsendepunkt som rydder etter en sletting.
2. **En vei for brukeren.** #311 ga et admin-endepunkt man kaller med curl. Det er et
   verktøy for den som skrev koden, ikke en funksjon. Kjetil sa det rett ut: «når jeg har
   laget søppel med ekko burde jeg virkelig kunne trykke slett i ekko og få automatisk
   propagering til alle apper vi har kontroll på apiene til».

Og swipe-slettingen som *fantes* i Ekkos Feed var verre enn ingenting: den slettet den
lokale JSON-fila og lot økta stå urørt i Apple Helse og i Resonans, med rekorden intakt.
**En sletting som bare gjelder ett av tre steder ser ferdig ut.**

## Faser

### Fase 1: Én kjede, to innganger (Resonans)

`$lib/server/workouts/workout-cleanup.ts` eier nå «rydd etter en økt»:

- `findEkkoWorkoutEvents(userId, sessionId)` — Ekkos egne rader, matchet på
  `data.sessionId`.
- `removeWorkouts` — canonical → varsler → kilderader → `aggregatePeriodsFrom`.
- `correctWorkoutSport` — skriver om `data.sportType`, reprojiserer canonical
  (`WorkoutProjectionService.refreshForRange`) og reaggregerer.

`POST /api/helse/trening/slett-okt` (fra #311) er skrevet om til å bruke den. To
implementasjoner av samme opprydding driver fra hverandre, og den ene glemmer et lag — som
er nøyaktig det `POST /api/admin/cleanup-walking` gjør: den sletter `sensor_events` og
etterlater `canonical_workouts` og `sensor_aggregates` med tallene intakt.

### Fase 2: Endepunktet Ekko snakker med

`PATCH`/`DELETE /api/apps/workouts/<sessionId>`. Kontrakten står i
`docs/ekko-rett-og-slett.md`. Tre valg er verdt å notere:

- **`sportType` normaliseres før validering.** Ekko sender sin egen `eBiking`; uten
  `normalizeSportType` (samme kall som opplastingen gjør) ville rettingen til elsykkel —
  nettopp den 17. august krevde — blitt avvist som ukjent idrett.
- **Bare Ekkos rader.** Beskriver klokka eller Dropbox samme tur, står de igjen; de er
  ikke våre å rette herfra, og dedupliseringen tar dem fra da av. Svaret sier
  `matched: 0` framfor å late som noe ble gjort.
- **404 på `matched: 0`,** og appen leser det som «ingen rader», ikke som en feil.

### Fase 3: Kaskaden i Ekko

`Ekko/Services/WorkoutCascade.swift` kjører tre lag — Ekko, Apple Helse, Resonans — og
bygger kvitteringen. UI: `Rett idrett` og `Slett økta` i ••• på økt-detaljen, og
swipe-slettingen i Feed-en går nå gjennom kaskaden.

- **Retting er hovedveien.** 8,3 km elsykkel skal ikke kastes for å bli kvitt en falsk
  5 km-rekord.
- **Apple Helse kan ikke endre aktivitetstypen** på en lagret økt, så en retting der er
  slett + skriv på nytt. `TrackingSession.sportType` er derfor `var`, og
  `HealthKitExporter.deleteExported(id:)` er internal.
- `reexport` returnerer nå utfallet sitt. Et Helse-avslag som bare havnet i
  `HealthKitExportLog` ville sett ut som at rettingen gikk gjennom overalt.

## Beslutninger

**Rekkefølgen er motsatt i retting og sletting.** Retting skriver lokalt først (feiler et
senere steg, står appen med det nye og serveren med det gamle — den veien kan man prøve
igjen fra). Sletting sletter lokalt sist: forsvinner kortet først og Resonans feiler,
finnes det ikke lenger noe å trykke «slett» på.

**Kvitteringen nevner hvert lag som IKKE ble endret**, med grunnen — og Strava nevnes
alltid, også når alt gikk bra. Første utgave av teksten listet bare det som gikk bra, og
en avslått Helse-tilgang ble da usynlig: presis den feilen kaskaden er bygget for å gjøre
umulig.

**Bare feil sier fra i Feed-en.** Gikk slettingen bra, ER den forsvunne raden kvitteringen;
en dialog per swipe ville gjort sletting til noe man bekrefter to ganger. Raden fjernes
straks for respons, men lista lastes på nytt etterpå — feilet et lag, kommer økta tilbake,
og det er sant.

**Styrkeøkter dekkes bare i Ekko og Apple Helse.** De skrives som
`dataType: 'strength_workout'` gjennom `/api/apps/event` uten `data.sessionId`, så
endepunktet finner dem ikke. Kvitteringen sier det med ord framfor å se komplett ut. Kjent
rest.

**Strava er brukerens egen vei**, etter avklaring med Kjetil: «Så kan jeg ta strava selv».
Vi har `strava_uploads` (sessionId → aktivitets-id) og v3 har `PUT /activities/{id}`, så en
retting *kan* bygges senere; en sletting kan vi ikke se at API-et tilbyr.

## Verifisering

- `npm run check`: 0 feil, 0 advarsler.
- `npm test`: 3430 tester i 249 filer, alle grønne — inkludert vakten mot rå sensorlesing,
  der `workout-cleanup.ts` er lagt inn i `knownRawReaders` med begrunnelse (den må se hver
  enkelt kilderad; en dedupliserende leser gir klyngen).
- Ekko: kvitteringsteksten er dekket av `EkkoTests/WorkoutCascadeTests.swift`, og
  kompileringen av `ios-pr.yml` (xcodebuild mot simulator).
- Fortsatt ugjort: den faktiske søppeløkta fra 17. august står i prod. Den ryddes med
  `POST /api/helse/trening/slett-okt?date=2026-08-17&sport=running` (dryRun først) — eller
  nå: med «Rett idrett → Elsykkel» på økta i Ekko, som er hele poenget.
- Fortsatt uavklart: **hvorfor** økta ble løping. Diagnoseloggen på telefonen svarer på det
  (`LiveDiagnostics`, Innstillinger → Live-stemme → Kopier).
