# Akser inn i Resonans

Dato: 2026-10-06
Status: pågår (fase 1, 4 og Resonans-delen av 5 i drift 6. oktober 2026; app-delene av 2, 3 og 5 skrevet og ikke bygget)

## Kontekst

Akser (`resonans-lab/akser`, flyttet fra eget repo 6. oktober 2026) sporer posisjon i
bakgrunnen og bygger en tidslinje av opphold, reiser og etapper med transportform.
Deteksjonen ble skrevet om i oktober 2026 og kalibrert mot et års ekte data fra telefonen.
I dag lever tidslinjen bare på telefonen.

Resonans mangler det Akser har:

- **En hjemadresse.** Vær og opphold henter posisjonen fra koordinater festet på
  sjekklistepunkter (`checklist_items.metadata`), og `trip-geo` har ingen observerte opphold
  utenfor Ekkos live-økter.
- **Hva som faktisk skjedde i løpet av dagen.** `gatherDayContext` bygger «hvor er
  brukeren i dag» av det som er planlagt.
- **Et skille mellom pendling og trening.** Elsykkelpendling telles som trening: én uke sto
  den for 172 av 514 effort-poeng (`2026-08-09-effort-kalibrering-og-to-dommer.md`).

Ekko har sitt eget stedsbegrep (`SavedPlace`, geofence, `SavedRoute`), også bare lokalt.

Kontrakten mot Akser står i `docs/akser-tidslinje.md`.

## Faser

### Fase 0: Akser klar (resonans-lab)

- Flyttet inn i `resonans-lab/akser` med historikken. Swift-pakken bor i
  `akser/AkserIOS/AkserKit/`, så path-filteret i Xcode Cloud er én mappe (`akser/AkserIOS`)
  som for de andre appene.
- `e_bike` lagt til som transportform i Akser, med samme råverdi som her. Klassifisereren
  foreslår den ikke ennå; den settes av brukeren eller av fasit fra Resonans.
- Gjenstår: Xcode Cloud-workflow og TestFlight, en testplan som faktisk har tester, og å
  arkivere det gamle repoet.

### Fase 1: Resonans tar imot (ferdig)

- `akser` i `APP_REGISTRY` (`location_tracker`/`iphone`, deep link `akser://`). Innloggingen
  (`/api/apps/authorize?app=akser`) virker da uten mer kode.
- Endepunktene under `src/routes/api/apps/akser/`: `GET status`, `PUT places`,
  `POST`/`DELETE timeline`.
- Validering rent i `$lib/domain/movement/timeline.ts` og `places.ts`, 28 tester. Felt for
  felt, aldri med en spread; ukjent transportform eller sted avvises.
- Lagring i `$lib/server/movement/akser-store.ts`: `sensor_events` med datatypene
  `movement_day`, `movement_stay` og `movement_journey`, erstattet per (sensor, Oslo-dag) i
  én transaksjon. `movement_day` bærer `generatedAt` og `detectorVersion`, og finnes også for
  en dag uten bevegelse.
- Steder i den nye tabellen `app_places` (migrasjon `0074_app_places.sql`), med `app` som
  kolonne så Ekkos steder kan legges ved siden av senere.
- `lastSync` og `lastError` skrives i samme oppdatering ved hver kontakt; avviste dager står
  i `lastError`. `akser` i `FRESHNESS_THRESHOLDS` med 48 timer.
- `$lib/server/app-sensor.ts` er en delt get-or-create for appsensorer. `/api/apps/event`,
  `/api/apps/upload` og `healthkit/*` har fortsatt hver sin private kopi.

### Fase 2: Akser sender (skrevet, ikke bygget)

I `resonans-lab/akser`, beskrevet i Aksers `DATAFLOW.md`, fase 6. **Skrevet uten
Swift-verktøykjede: verken kompilert eller kjørt.**

- «Koble til Resonans» i Aksers innstillinger: `ASWebAuthenticationSession` mot
  `/api/apps/authorize?app=akser`, hemmeligheten i nøkkelringen, URL-skjemaet `akser`.
- `ResonansTimelineMapper` (ren, med tester) oversetter tidslinjen: Oslo-døgn uavhengig av
  telefonens tidssone, klipping over midnatt med distansen fordelt etter tid, `still`/`noise`
  ut, steder som ikke er i lista blir ukjente steder med avrundet sentrum, tidspunkter rundet
  ned til hele sekunder før klipping.
- `ResonansSync` bruker statussvaret i stedet for en lokal kø: de sju siste dagene bygges hver
  runde, deretter dager Resonans mangler (nyeste først, 31 per runde) og dager fra en eldre
  detektor. Et avtrykk per dag hindrer at uendret innhold sendes igjen, og en avvist dag
  prøves ikke igjen før innholdet endres.
- En rettelse er en ny opplasting av samme dag, men bare innenfor de sju siste dagene. Eldre
  rettelser når Resonans først når detektorversjonen bumpes.

### Fase 3: Fasit fra Resonans (skrevet, ikke bygget)

Akser leser `GET /api/apps/workouts` én gang per synkrunde (`WorkoutLabeler` i
`AkserKit/Sources/Akser/Resonans/`). En etappe som ligger minst 80 % inne i en økt og dekker
minst halve den, sendes med øktas transportform, `modeSource: label` og `labelRef`. Brukerens
rettelse vinner fortsatt, og tidene er alltid Aksers. Etikettene lagres ikke lokalt; en ny økt
endrer dagens avtrykk, så dagen sendes på nytt innenfor de sju siste dagene. Appens egen
tidslinjevisning viser fortsatt bare Aksers gjetning. Ingen endring i Resonans:
`/api/apps/workouts` hadde alt den formen som trengtes, og CLAUDE.md sier at lista har to
konsumenter.

### Fase 4: Resonans bruker dataene (ferdig)

- **`query_movement`** (`$lib/ai/tools/query-movement.ts`) på begge chatflatene, reglene rent
  i `$lib/domain/movement/movement-summary.ts`, lesingen i `$lib/server/movement/movement-read.ts`.
  Fire utsnitt: `day`, `arrivals` («når kom jeg på jobb, og hvordan»), `last_visit` («når var
  jeg sist på hytta») og `places`. Svaret bærer aldri koordinater.
  - **Gruppe `kjerne`, ikke `helse`.** Spørsmålene ser ut som hverdagsprat og ruter til
    `general`; da ville verktøyet falt ut idet utvalget skrus på. Derfor ingen nye ord i
    `detectPromptFocusModules` heller — kjernen følger alltid med. Prompten nevner verktøyet i
    `BASE_PROMPT` og i Ekko-assistentens systemprompt.
  - **Et opphold fra 00:00 er ikke en ankomst.** Akser klipper natta til dagen, så «når kom
    jeg hjem» ville ellers svart 00:00 hver dag.
  - **Reisen dit er den siste som sluttet innen 15 minutter før oppholdet**, ikke bare en
    eksakt match: en kort pause skal ikke gjøre ankomsten transportløs.
  - **Steder matches på navn før kategori**, med norske bøyninger («hytta»/«hytte») og
    stoppord. Treffer ingenting, svarer verktøyet med stedene som finnes — det gjetter ikke.
- **Hjemmet til været.** `weather_forecast` uten koordinater brukte Oslo sentrum; nå brukes
  Aksers `home`-sted (`$lib/domain/movement/home-place.ts`), avrundet til to desimaler (~1 km)
  før det sendes til MET, og koordinatene gis ikke videre til modellen.
- **Faktisk dag i dagskonteksten.** `gatherDayContext` har et nytt felt `observed` for en dag
  som er over (Akser sender ferdige dager, så i dag har det aldri). Det følger med i
  `/api/apps/day` og Ekko-assistentens `dayPlan`; Ekko-appen leser det ikke ennå.
- **Reisedager i `trip-geo`.** En lagret Akser-dag inne i et reise-tema skriver
  `geoByDay` med kilde `observed`: oppholdet som varer til midnatt (der brukeren sov), ellers
  det lengste. Samme presedens som Ekkos kjøretur; det sist skrevne vinner. Best-effort i
  opplastingen — en feil her gjør ikke opplastingen mislykket.

### Fase 5: Ekko og stedene (Resonans ferdig, Ekko skrevet og ikke bygget)

- **Ekko laster opp `SavedPlace`** (`PUT /api/apps/ekko/places`, samme form som Aksers) ved
  hver lagring og ved oppstart. Ekko har ingen kategori og sender `unknown`.
- **Resonans kobler** (`app_place_links`, migrasjon `0075`; regelen i
  `$lib/domain/movement/place-links.ts`, lagringen i `$lib/server/movement/place-links-store.ts`).
  - Overlapp (avstand under summen av radiene) og samme kategori eller samme navn → `auto`.
    Overlapp ellers → `suggested`, besvart med «Samme sted» / «Ikke samme sted» på
    `/settings/sources` (`PlaceLinksCard`, `/api/steder/koblinger`).
  - **Ekkos kategori utledes av navnet** («Hjem», «Jobben», «Hos svigers»). Et navn som ikke
    sier noe gir `unknown`, som aldri er «samme kategori» som noe.
  - **Hvert sted kobles høyst én gang**, automatiske par først og deretter nærmeste. Akser
    hadde 22 «Nytt sted» innenfor 300 m fra hjemmet; uten grensa ville Ekkos «Hjem» fått 22
    forslag.
  - Brukerens valg står: et avvist par foreslås ikke igjen, og et sted med en bekreftet
    kobling får ikke en til. `auto` og `suggested` regnes ut på nytt ved hver stedsliste.
  - Nøklene er appenes egne id-er, så et sted som arkiveres og kommer tilbake beholder
    koblingen. «Slett alt» fra Akser sletter også koblingene.
- **Bruken:** et koblet Ekko-navn er et alias for Akser-stedet i `query_movement`. Et sted Akser
  kaller «Nytt sted» heter da «Barnehagen» i svaret og kan spørres etter.
- Ekko fikk samtidig standardadressen `resonans.apps.hoi.by`; en lagret Vercel-adresse eller et
  tomt felt faller tilbake på den.
- Gjenstår: navnet fra appen man sist rettet i skal vinne i Resonans (i dag vinner Akser-navnet
  når stedet er navngitt der), og rutegjenkjenning og pendling-ghosts i Ekko, bygget på Aksers
  akser (Ekkos `PLAN.md`, fase 6).

### Senere: pendling

Et pendlingsflagg og hva det skal endre i effort, ankeret og energiregnskapet tas i en egen
runde, når fase 1 har samlet noen uker med reiser mellom kjente steder.

## Beslutninger

- **Akser er en egen app, og Resonans er knutepunktet.** Akser viser det som skjedde
  (passiv, alltid på); Ekko viser det du gjør nå. De snakker aldri direkte med hverandre.
  Prisen er to apper som ber om «Alltid»-posisjon.
- **Bare opphold og reiser forlater telefonen, aldri rå GPS.** Det dekker dag, ferie, chat
  og pendling. Rå punkter ville gitt mer fleksibilitet og mye mer ansvar.
- **En dag erstattes i sin helhet.** Akser bygger dagen på nytt etter algoritmeendringer,
  rettelser og ny fasit, og starttidspunktene flytter seg. Unikhetsindeksen på `sensor_events`
  ville gjort hver revisjon til en duplikat. Slettingen avgrenses til nøyaktig den dagen og
  den sensoren, samme regel som «refresh sletter aldri mer enn den bygger opp igjen».
- **En Akser-reise blir aldri en `workout`.** Samme tur skrives alt av opptil tre kilder;
  en fjerde ville telt med i kilometer, effort og streaks.
- **Hver app eier sine steder. Resonans kobler, slår ikke sammen og skriver ikke tilbake.**
  Overlappende radius med samme kategori kobles automatisk; overlapp med ulik kategori eller
  ulikt navn blir et forslag brukeren bekrefter. Navnet fra appen man sist rettet i vinner i
  Resonans. Fjernes en app, står den andres steder urørt.
- **Fasit fra Resonans er en egen kilde, ikke en brukerrettelse.** Prioritet: brukerens
  rettelse > økt fra Resonans > Aksers gjetning. Etiketten hentes på nytt hver gang dagen
  bygges, så en økt Ekko har rettet slår gjennom av seg selv.
- **Økta sier hva, Akser sier når.** Ekkos start og stopp er knappetrykk, og stoppet kommer
  ofte for sent («den glemte trackeren»). Grensene på en etappe tas aldri fra økta.
- **Elsykkel er en egen transportform i Akser** (`e_bike`). En kontraktsendring senere ville
  kostet mer enn et tilfelle klassifisereren ikke bruker ennå.
- **Bare brukeren selv, uten utløp.** Tidslinjen beholdes som annen helsehistorikk, og kan
  slettes per dag og i sin helhet.
- **Pendling venter.** Hva et pendlingsflagg skal endre er en egen avgjørelse, tatt på ekte
  data.
- **Resonans er navet, og begge appene «kobler til Resonans».** Akser fungerer fullt ut uten:
  uten tilkobling sender den ingenting, legger ingenting i kø og henter ingen fasit. Ekko og
  Akser kjenner ikke hverandre (ingen app group, ingen delt iCloud), så synk mellom dem krever
  en Resonans-konto — i dag en Google-innlogging på allowlisten. Direkte synk tas eventuelt
  opp igjen ved et ekstremt behov.
- **Tidspunkter må ha offset.** Uten den tolkes de i serverens tidssone (UTC i drift).
- **Sentrum avrundes også på serveren.** Akser avrunder selv, men grensa håndheves der
  dataene lagres.

### Retning for Aksers deteksjon (ikke bygget)

Notert her fordi det avgjør hvilke data Akser trenger fra Resonans:

- Fart alene er for svakt. Rutematching per par av steder avslører transportform i de fleste
  tilfellene der traseene skilles; fingeravtrykk tar resten: tid i fartssoner, stopp på
  stasjoner, GPS-hull under bakken og CoreMotion-historikken, som er gratis å spørre i
  etterkant.
- Elsykkel kjennes på fart **mot stigning**: motoren slutter på 25 km/t, så over 25 skjer
  bare i nedoverbakke, mens bil holder farten oppover. Det krever høydeprofiler per kjent
  rute, fra kart eller fra tidligere Ekko-spor. GPS-høyde er for grov.
- Mengde, ikke ett punkt: én nedoverbakke på 55 km/t skal ikke gjøre en elsykkeltur til bil.

## Verifisering

Fase 4: `npm test` (5265) og `npm run check` grønne, med 30 nye tester. Mot en lokal
Postgres med hele skjemaet (ikke committet): lesing av dager og steder, alle fire utsnittene
av `query_movement` inkludert ukjent sted og ikke tilkoblet, hjemmet, `observed` i
dagskonteksten (og fravær for i dag), og `geoByDay` på et reise-tema.

Fase 5 (Resonans): `npm test` (5284) og `npm run check` grønne, 15 nye tester for koblingen
og aliasene. Mot lokal Postgres: migrasjonen to ganger, automatisk kobling og forslag,
bekreftelse (og at en annen bruker ikke kan bekrefte), at valget overlever en ny beregning,
aliasene, og at et arkivert Ekko-sted mister aliaset mens valget står. `PlaceLinksCard` er ikke
sett i en nettleser, og `/settings/sources` er ikke i den visuelle testsuiten. Ekko-delen er
ukompilert (tre nye tester i `PlaceSyncTests`).

Fase 3: ingenting kjørt (sju nye XCTest-er i `WorkoutLabelerTests`).

Fase 2: ingenting kjørt. 21 nye XCTest-er for mapperen og planleggeren ligger klare
(`ResonansTimelineMapperTests`); første verifisering er `swift test` og et bygg til telefonen,
og deretter at `GET /api/apps/akser/status` viser dagene.

Fase 1: `npm test` (5235 tester, 28 nye) og `npm run check` grønne. Endepunktene ble i tillegg
kjørt mot en lokal Postgres med hele skjemaet (ni scenarioer: steder og arkivering, erstatt
dagen uten duplikater når starttidene flytter seg, foreldet generering, én avvist dag ved siden
av en lagret, `lastError` satt og nullstilt, arkiverte steder godtatt og andres steder avvist,
status, sletting av én dag og av alt). Det oppsettet er ikke committet. Migrasjonen er kjørt to
ganger mot samme base. Ikke kjørt mot prod. Akser-endringene (flyttingen og `e_bike`) er skrevet
uten Swift-verktøykjede; flyttingen er bekreftet ved et lokalt bygg til telefon, `e_bike` er
ukompilert.
