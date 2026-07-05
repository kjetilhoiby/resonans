# Timevindu-filter for skjermtid-widgets

Dato: 2026-07-05
Status: ferdig

## Kontekst

En widget med tittel «Skjermtid 16–19» ble opprettet via chat, men widget-motoren
hadde ingen mekanisme for å avgrense til et tidsrom på døgnet — den viste total
daglig skjermtid. Dataene som trengs fantes allerede: skjermtid-events
(`data_type = 'screen_time'`) lagrer valgfritt `hourly`-buckets med minutter per
klokketime (fra daglige skjermbilder), men ingen kode leste dem.
I tillegg var `filterCategory: 'ukategorisert'` satt på widgeten — en stille no-op
siden kategorifilteret kun gjelder banktransaksjoner — og mål-prosenten regnet
«høyere er bedre» for skjermtid.

## Faser

### Fase 1: Schema og migrasjon
- `scripts/db-migrations/0032_widget_hour_window.sql`: `filter_hour_from` og
  `filter_hour_to` (nullable integer) på `user_widgets`.
- `src/lib/db/schema.ts` oppdatert til samme måltilstand.
- Semantikk: `[from, to)` — from inklusiv 0–23, to eksklusiv 1–24.
  NULL/ugyldig par = hele døgnet (dagens oppførsel).

### Fase 2: Beregning
- Ny ren modul `src/lib/server/services/screen-time-window.ts`:
  `normalizeHourWindow()` (validering) og `minutesInWindow()` (summering av
  hourly-buckets i vinduet, med støtte for vindu som krysser midnatt).
  Dager uten hourly-data returnerer `null` og holdes utenfor snittberegninger
  i stedet for å telle som 0.
- `/api/widget-data/[id]`: ny hente-funksjon for vindus-filtrerte skjermtid-rader,
  koblet inn i både tidsserie (sparkline) og periodeaggregat, parallelt med den
  eksisterende kategorifiltrerte bank-stien. Bucket-logikken ble trukket ut i en
  delt `bucketRows()`-hjelper. `hourWindow` eksponeres i debug-payloaden.
- Mål-prosent (`pct`) inverteres nå for `screenTime` som for `weight`:
  lavere er bedre, 100 % = på/under mål.

### Fase 3: Lagring og UI
- `widget-creation/service.ts`: `filterHourFrom`/`filterHourTo` i create- og
  update-input med validering (heltall innenfor gyldig område, ellers null).
- `POST /api/user-widgets` og `PATCH /api/user-widgets/[id]` tar imot feltene.
- `WidgetConfigSheet`: «Fra kl.» / «Til kl.»-velgere i Filtre-seksjonen for
  screenTime-widgets, med hint-tekster (halvferdig par, tomt vindu, krav om
  timesoppløsning). `data-track="widget-konfig:timevindu-fra/-til"` for brukslogging.
  Ved lagring nullstilles `filterCategory` for ikke-økonomi-widgets slik at
  strøverdier (som 'ukategorisert' på skjermtid) ryddes bort; `filterSubcategory`
  beholdes fordi workout-widgets bruker den som sportType-filter.
- AI-flyt: `propose_widget`/`create_widget`-tool-skjemaene i `/api/chat`,
  `WidgetDraft`-typen og `WidgetProposalCard` sender feltene gjennom, så chatten
  kan opprette f.eks. «skjermtid kl. 16–19» direkte.

## Beslutninger

- **Halvåpent intervall `[from, to)`** matcher hourly-bucketenes heltimer og gjør
  «16–19» entydig: timene 16, 17 og 18.
- **Egne kolonner fremfor gjenbruk av `filterCategory`**: kategorifilteret har
  bank-semantikk i hele kodebasen; å overloade det ville spre spesialtilfeller.
- **Dager uten hourly-data ekskluderes** (null, ikke 0) — ukentlige skjermbilder
  gir dagstotaler uten timesoppløsning, og 0-verdier ville dratt snittet
  kunstig ned.
- **Ugyldige vinduer degraderer stille til hele døgnet** i lese-stien
  (`normalizeHourWindow` → null) i stedet for å feile — en widget skal aldri
  knekke av en rar konfig.
- **Cache-stien er urørt**: timevindu-widgets har `metricKey = null` og går
  alltid live-query.

## Verifisering

- 15 nye Vitest-tester i `screen-time-window.test.ts` (validering, halvåpent
  intervall, midnattskryssing, manglende/ugyldige buckets). Full suite:
  1027 tester grønne.
- `npm run check`: 0 feil, 0 advarsler.
- Visuelle testsider er uendret (WidgetConfigSheet-demoen på /design bruker en
  økonomi-widget-mock som rendrer samme markup som før).
