# Projeksjon som slettet mer enn den bygde opp igjen

Dato: 2026-09-06
Status: ferdig

> **RETTELSE (samme dag):** fiksen beskrevet her VIRKET IKKE.
> `decideProjectionChunk` sammenlignet antall aktiviteter mot en grense som
> gjelder rå hendelser, så hver side konkluderte «kilden gikk tom» og slettet
> fortsatt hele vinduet. Analysen under står; løsningen ble en no-op. Se
> `2026-09-06-sidetallet-var-i-feil-enhet.md`.

## Kontekst

Etter Strava-arkivimporten viste både «Akkumulert løping» (sesongkurven) og
«Perioder»-tabellen på Trening-flaten hull i de siste månedene (juni–september
2026) — mens tidligere måneder samme år så helt riktige ut. Brukeren hadde
åpenbart trent gjennom sommeren (aktivt program, langtur samme dag), så dataene
fantes et sted; de var bare borte fra `canonical_workouts`.

## Årsaken

`WorkoutProjectionService.refreshForRange(userId, startDate, endDate)` gjorde
to ting som ikke stemte overens:

1. Hentet aktiviteter med `buildUnifiedWorkoutActivities(userId, { since: startDate,
   limit: 2000 })` — en spørring **stigende sortert på tid**, med et hardt tak på
   2000 rader (satt for å holde et enkelt insert under Postgres' parametergrense,
   se `describeErrorForStorage`-notatet i domain/error-text.ts).
2. Slettet deretter `canonical_workouts` og `workout_daily_aggregates` for **hele**
   det forespurte vinduet, `startDate`–`endDate` — uansett hvor mange rader
   spørringen faktisk klarte å hente.

Er det færre enn 2000 aktiviteter i vinduet, er dette harmløst: alt som ble
slettet, ble også bygget opp igjen. Men et vindu åpnet av arkivimporten kunne
være `2015 → nå` — tolv år — og en aktiv bruker med ni års treningshistorikk har
mer enn 2000 aktiviteter i et sånt spenn. Spørringen ga da bare de **2000
ELDSTE** (stigende sortering + `limit`), mens slettingen uansett dekket hele
vinduet. De nyeste ukene i vinduet — de som ikke fikk plass i de 2000 —
ble slettet og **aldri skrevet tilbake**.

Feilen er helt stum: ingen exception, ingen `[500]`-linje, ingen rad i
`background_jobs.error` (jobben rapporterte `completed`, for den gjorde akkurat
det den ble bedt om — den visste bare ikke at den hadde blitt bedt om for mye).
Symptomet dukker opp måneder senere, i en graf, langt unna stedet feilen skjedde.

Dette er ikke noe nytt introdusert av forrige endring (queued vs. inline
projeksjon) — feilen har eksistert så lenge `refreshForRange` har hatt denne
formen. Den ble bare **usynlig sjelden** før: normal drift ber aldri om et
vindu i nærheten av 2000 aktiviteter (en levende Withings/Ekko-skriving ber om
`timestamp − 2t → nå`, alltid noen timer). Arkivimporten er den første kilden
som noensinne har bedt om et vindu stort nok til å avsløre den.

## Fasen

### Fase 1: sidevis dekning, ikke ett jafs

Ny ren modul `$lib/domain/health/workout-projection-chunking.ts`:

- `decideProjectionChunk({ pageLength, limit, lastActivityStartTime, requestedEndDate })`
  avgjør hvor langt ÉN side faktisk dekker: fylte den ikke grensa, dekker den
  hele resten av vinduet; fylte den grensa, dekker den bare til den SISTE
  aktivitetens eget tidspunkt — aldri lenger, siden det kan finnes flere vi ikke
  har sett ennå.
- `nextProjectionCursor(chunkEnd)` — startpunktet for neste side, ett millisekund
  etter forrige dekning.

`refreshForRange` løper nå i en løkke: hent en side, avgjør dekningen, slett og
skriv **bare det sidens eget spenn** (`cursor`–`chunkEnd`), gå videre til neste
side hvis det er mer. Insert-batchstørrelsen (2000, av hensyn til
Postgres-parametergrensa) er uendret — det som endret seg er at slettingen nå
er avgrenset til akkurat det som bygges opp igjen i SAMME steg, aldri til hele
det opprinnelig forespurte vinduet.

Konsekvensen: feiler én side midtveis, står de foregående sidene ved lag —
skaden er begrenset til akkurat den ene sidens spenn, ikke «alt fra
arkivøkta og ut».

## Beslutninger

- **Innsettingstaket (2000) rørt ikke.** Det finnes av en annen, dokumentert
  grunn (parametergrense på ett insert) og skal fortsatt bruke samme tall som
  sidestørrelsen — de to må stemme overens, så en fremtidig endring av det ene
  må endre det andre.
- **Et sikkerhetstak på sider (`MAX_PROJECTION_CHUNKS = 50`)** hindrer en evig
  løkke om beslutningslogikken noensinne skulle få en feil — 50 sider × 2000
  aktiviteter er en absurd øvre grense ingen ekte bruker når, men koster
  ingenting å ha der.
- **Ingen migrasjon av gamle rader.** Feilen er en LESE/SKRIVE-feil ved
  projeksjon, ikke i selve kildedataene (`sensor_events` er urørt) — en ny
  `refreshForRange` over det samme vinduet reparerer seg selv, siden funksjonen
  er idempotent.
- **Reparasjon av SYNLIGE hull:** `POST /api/helse/trening/reprojiser?weeks=26`
  (kortet «Reberegn treningsbelastning» i `/settings/sources`) var TRYGT å bruke
  allerede før denne fiksen — vinduet er tak 26 uker, milevis under 2000
  aktiviteter for enhver bruker, så det traff aldri feilen. Det er derfor
  hurtigreparasjonen for et hull man ser NÅ.
- **Ingen automatisk full-historikk-reparasjon bygget.** Denne fiksen hindrer
  NYE hull; den leter ikke opp gamle. Andre huller kan finnes lenger tilbake i
  historikken, på tidspunkt der en tidligere kjøring tilfeldigvis rammet
  2000-grensa — ingen verktøy her sier hvor. En full gjennomgang (refresh over
  HELE historikken, i biter, med den fikserte koden) ville funnet og rettet dem,
  men er ikke bygget nå — se Kjent rest.

## Verifisering

- `npm test`: alle tester grønne (inkl. åtte nye på `decideProjectionChunk`/
  `nextProjectionCursor`, som dekker: tom side, kort side som dekker helt til
  slutt, full side som bare dekker til siste aktivitet, full side som strekker
  seg forbi sluttdatoen, og full side nøyaktig PÅ sluttdatoen).
- `npm run check`: 0 feil, 0 advarsler.

## Kjent rest

- **Ingen automatisk full-historikk-reparasjon.** Er det MER enn ett hull —
  altså et sted lenger tilbake enn juni 2026 der en tidligere refresh også
  rammet 2000-grensa — er det ikke funnet, bare det ene brukeren meldte fra om.
  En reparasjon ville måtte kalle `refreshForRange` over hele historikken (i
  praksis: fra kontoens eldste økt til nå), noe ingen eksisterende
  bruker-endepunkt tillater i dag (`/reprojiser` er tak 26 uker med vilje, for
  en annen jobb — effort-omkalibrering, ikke historisk reparasjon).
- **Feilen var stum, og er det fortsatt for NYE tilfeller av samme klasse.**
  `refreshForRange` logger nå per side, men logger ingen advarsel dersom en
  fremtidig kaller ber om et vindu som treffer `MAX_PROJECTION_CHUNKS`-taket —
  den kaster i stedet. Det er en bevisst forskjell fra den gamle, stille
  trunkeringen: en feil man ser er bedre enn en feil man ikke ser, selv om den
  nye feilen er en 500 en kaller må håndtere.
