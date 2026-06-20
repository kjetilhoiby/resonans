# Bilferie: Ekko-tracking + reise-tema + feriedagbok

Dato: 2026-06-19
Status: pågår (fase 1–5 implementert serverside + UI; ingen Ekko-endring nødvendig)

## Kontekst

Bruker skal på en liten bilferie (et par etapper, noen få dager) og vil bruke
Resonans til å tracke turen. Alle byggeklossene finnes allerede — de er bare
ikke koblet sammen:

1. **Reise-tema** (`themes.tripProfile`: destinasjon, datoer, `accountIds`,
   `overnightStays`) med `TripDashboard.svelte`, auto-detektert fra temanavn i
   `theme-dashboard-registry.ts` (`travel`-kind).
2. **Feriedagbok** (`/api/tema/[id]/ferie/diary` → `reflections` med
   `kind='feriedagbok'`, én notat per dag, lagrer `content` + `place` +
   `weather` i `scores`-jsonb). Endepunktet er allerede tema-agnostisk (validerer
   *ikke* dashboard-typen), men vises i dag kun i `FerieDashboard`.
3. **Ekko-tracking** (`POST /api/apps/live-session` med `sportType='driving'`
   → `live_sessions`, matet med Tesla-telemetri: posisjon, batteri, rekkevidde
   via `syncTeslaForUser`/`updateDrivingLiveSession`).
4. **Deklarert geo** i dagsoppgaver: `checklistItems` har
   `kind: 'location' | 'travel'`, `travelMode`, og `lat`/`lon`/`geoLabel`
   geokodet ved oppretting.

## Konseptuell modell

En reise spiller **to roller**, og de har ulike konsekvenser for designet:

### Rolle 1: Reisen som temporalt filter (ryggraden)

Et reise-tema er i bunn og grunn et **spørringsfilter** over de eksisterende
strømmene — definert av tidsvindu (+ valgfritt kontodimensjon):

- `categorized_events` innenfor `[startDate, endDate]` (evt. begrenset til
  `tripProfile.accountIds` — dette finnes allerede).
- `sensor_events` innenfor vinduet — kjøreturer (`drive_state`), treningsøkter, osv.

Disse skal **ikke kopieres** inn i temaet. Dashboardet utleder dem on-the-fly.
Det betyr at «etapper» ikke er lagrede snapshots, men en **avledet gruppering**
av kjøre-events i vinduet (én etappe ≈ én kjøretur, gruppert per dag).

### Rolle 2: Reisen som geo-kontekst (berikelsen)

Når tidsfilteret er på plass, *følger* geoen nesten gratis: kjøreturene i vinduet
bærer allerede GPS. Dette er noe turen **produserer og gir tilbake** til temaet,
ikke et filter. Det gir tre ting:

1. **Sted per dag** → auto-fyller dagbokas `place`.
2. **Geo på transaksjoner** — banktransaksjoner har ingen GPS, men kan tids-matches
   mot dagens kjente posisjon («middag kl. 19, dere var i Volda» → kjøpet plasseres
   der). Kryss-domene-berikelse filteret alene ikke gir.
3. **Kart** — ruter + overnattinger + geo-plasserte transaksjoner.

### Geo har to lag med ulik presisjon

Stedssignal kommer fra to kilder som **utfyller**, ikke konkurrerer:

- **Deklarert (a priori)** — dagsoppgaven «Kjøre til Volda» / «Sted: Volda».
  Geokodet ved oppretting (tettstedssentroide), uten klokkeslett, men finnes
  *uansett* (også når du fløy eller allerede var der). Uttrykker *intensjon*.
- **Observert (a posteriori)** — den loggede kjøreturen som ender i Volda.
  Faktiske koordinater, ankomsttidspunkt og hele ruten. Sannheten, *når den finnes*.

Det observerte **raffinerer** det deklarerte. «Hvor var vi dag X» blir en
presedenskjede (samme mønster som transaksjonskategorisering: manuell → LLM → regel):

1. Logget kjøretur-endepunkt den dagen (presist: koordinater + klokkeslett)
2. Deklarert `location`/`travel`-oppgave for dagen (stedsnavn, evt. geokodet)
3. Aktiv overnatting den natten (`tripProfile.overnightStays`)
4. Ingenting → ukjent

En planlagt `travel`-oppgave med `travelMode: 'drive'` er en **deklarert etappe**;
den loggede kjøreturen er den **utførte etappen**. Samme sak, intensjon vs. fasit —
forsones på dato + destinasjon (jf. `ferieProfile.trips[].linkedThemeId`-mekanikken).
Resultatet er én etappe som bærer *både* «vi planla å kjøre til Volda» og «vi
ankom 59.x, 6.x kl. 16:42, 312 km, 41 % batteri».

### Avledet vs. frosset (hybrid)

Filteret er flyktig (utledes ved hver rendring), men **geo-konteksten skal være
varig**: Tesla har et nattgap, og `sensor_events` rulles etter hvert inn i
aggregater. Derfor — **utled live under turen, frys et lett per-dag geo-snapshot
inn i `tripProfile` ved reiseslutt**, slik at reise-*minnet* (dagbok, kart,
hvor-var-vi) overlever selv om rådataene tynnes ut.

## Faser

### Fase 1: Datamodell — minimal

- **`live_sessions.theme_id`** (nullbar FK → `themes.id`). Lar en kjøre-økt
  knyttes til et reise-tema. Migrasjon `scripts/db-migrations/NNNN_live_session_theme.sql`
  (`ADD COLUMN IF NOT EXISTS`) + matchende felt i `schema.ts`.
- **`tripProfile.geoByDay`** (additivt jsonb-felt) — det frosne geo-snapshotet,
  *ikke* kopierte etapper:
  ```ts
  geoByDay?: Record<string, {        // nøkkel = ISO 'YYYY-MM-DD'
    place?: string;                  // beste stedsnavn for dagen
    lat?: number;
    lon?: number;
    source: 'observed' | 'declared' | 'overnight';  // hvor signalet kom fra
    liveSessionId?: string;          // hvis observert
  }>;
  ```
  Ingen lagrede `legs` — etapper utledes fra `live_sessions` i vinduet.

### Fase 2: Ekko-flyt — knytt kjøreturer til turen

- **`POST /api/apps/live-session`**: ta imot valgfri `themeId`, lagre på økten.
  Ekko sender det aktive reise-temaet når en etappe startes.
- **`DELETE /api/apps/live-session`** (`reason: 'arrived'`): når en økt med
  `themeId` avsluttes, oppdater `tripProfile.geoByDay` for ankomstdatoen med
  endepunktets koordinater (`source: 'observed'`). Distanse/varighet/rute leses
  fra økten ved behov (`routeDistanceM`, tidsstempler, `routeCoordinates`).
- Ren geo-presedens (`live_session` + `checklistItems` + `overnightStays` → dagens
  beste sted) ekstraheres til en testbar funksjon i `src/lib/server/` uten
  DB-kobling, med enhetstester (prinsipp 3).

### Fase 3: Avledet dashboard + dagbok + geo-berikelse

- **Etapper og transaksjoner som spørring**, ikke lagrede kopier: `TripDashboard`
  henter kjøre-events og `categorized_events` innenfor `[startDate, endDate]`
  (+ `accountIds`).
- **Gjenbruk diary-endepunktet** uten kontraktsendring. Render dagbok-seksjonen i
  `TripDashboard` (vurder å trekke ut en delt `DiarySection` i `components/domain/`
  som ferie og reise deler — prinsipp 2).
- **Geo-berikelse**:
  - Auto-seed dagboknotat per dag med `place` fra presedenskjeden + `weather`
    (gjenbruk vær-mønsteret fra ferie-`stops`).
  - Tids-match transaksjoner mot `geoByDay` for å plassere kjøp (med sikkerhet
    avhengig av kilde: presist mot observert endepunkt, grovt mot deklarert).
- **«Reiserute»-seksjon** i `TripDashboard`: kart (gjenbruk Maplibre fra
  `SharedTripPositionView.svelte`) med ruter + overnattinger + geo-plasserte kjøp,
  og dagbok-tidslinjen under.

### Fase 4: Dagens plan til Ekko — `GET /api/apps/day` (implementert 2026-06-20)

Ekko skal kunne *hente* dagens bevegelses- og oppholdskontekst fra Resonans —
«det finnes en oppgave som heter Kjøre til Volda» — på samme måte som den henter
treningsprogram. Gathering-logikken finnes allerede; den produserer i dag kun
prosa for chat-prompten (`buildDayContextBlock` i `day-location-context.ts`, som
bruker `computeStaysFromDayPlans` i `stays.ts`, kalt fra `/api/chat` +
`/api/chat-stream`). Arbeidet er å eksponere den som struktur.

**Refaktor (prinsipp 2/3):** splitt gatheringen fra formateringen.
- `gatherDayContext(userId, date) → DayContext` — ren(-ere) strukturbygging
  (dagens `location`/`travel`-punkter + aktivt opphold + aktiv tur via
  `pickTripForDate`).
- `buildDayContextBlock` blir en tynn prosa-formatter over `DayContext`, slik at
  chat og Ekko deler én kilde og ikke kan drive fra hverandre.

**Nytt endepunkt** (Bearer `rsn_`, read-only, som resten av `/api/apps/*`):
```
GET /api/apps/day?date=YYYY-MM-DD        (default i dag)
→ {
    date,
    trip:     { themeId, name, dayNo, totalDays } | null,   // pickTripForDate
    movement: [ { mode: 'drive'|'boat'|'flight', destination, time } ],
    stay:     { place, checkIn, checkOut, dayNo, totalDays } | null,
    training: { programId, sessionId, summary } | null       // tynn peker
  }
```

**Avgrensning — erstatter IKKE program-API-et.** `/day` generaliserer *henting*
(en tynn lesekomposisjon / BFF-briefing); *rapportering* forblir spesialisert per
domene. Program-endepunktene beholdes som detalj-kilde + tilbakekoblingssløyfe
(`programs/[id]/today` → `complete-session` → progresjon → `status`/`mode`).
`/day` *refererer* dagens økt med en peker + sammendrag; Ekko driller ned i
`/programs/[id]/today` for sett/reps/fullføring.

**Symmetri (plan ↔ utført):**

| | Trening | Bevegelse/opphold |
|---|---|---|
| Hent plan (deklarert) | `programs/[id]/today` | `GET /api/apps/day` ← ny |
| Rapporter utført (observert) | `complete-session` | `live-session` `arrived` (bygd) |

Resonans er planleggeren/system-of-record; Ekko er feltklienten. Begge domener er
intensjoner Resonans holder — Ekko henter dagens skive og melder tilbake.

### Avgrensninger (bevisst utelatt i v1)

- **Strava-push** (`/api/apps/upload`): gjelder løping/sykling med GPX, ikke
  kjøring.
- **Familie-grid** (`ferieProfile`): reise-temaet bruker `tripProfile`. Kan
  forfremmes til en større ferieplan via `ferieProfile.trips[].linkedThemeId` —
  utenfor dette prosjektet.
- **Ruten (tidsserie) for transaksjons-matching underveis**: v1 bruker
  endepunkt-per-dag. Modellen utelukker ikke senere matching mot hele GPS-ruten,
  men det er luksusversjonen.

## Beslutninger

- **Reisen er primært et temporalt filter, ikke en datasamling.** Etapper og
  transaksjoner utledes fra de eksisterende strømmene i tidsvinduet — ingen
  duplisering, alltid konsistent. Krymper Fase 1 til én kolonne + ett geo-felt.
- **Geo er berikelse turen akkumulerer, og fryses ved reiseslutt.** Forener det
  flyktige filteret med et varig reise-minne som tåler at rådata tynnes ut.
- **To geo-lag med presedens (observert > deklarert > overnatting).** Plansiden
  (`checklistItems`) gir et signal som alltid finnes; observasjonssiden
  (`live_sessions`) raffinerer det med presise koordinater + tid.
- **Reise-tema (`tripProfile`), ikke ferie-tema (`ferieProfile`)** som container —
  unngår familie-grid-overhead for en liten bilferie.
- **Gjenbruk av diary-endepunktet uten kontraktsendring** — det er allerede
  tema-agnostisk; arbeidet er å eksponere det i `TripDashboard` + auto-seede.
- **Serveren utleder tema fra datoen, ikke Ekko.** Reisen er et temporalt filter,
  så tilhørighet er en funksjon av datoen. Ekko skal ikke kjenne tema-taksonomien;
  `themeId` på API-et er en override for overlappende turer / kjøretur utenfor vinduet.
- **`/api/apps/day` aggregerer henting, men erstatter ikke program-API-et.** Et
  tynt lese-aggregat (BFF) gir Ekko dagens plan i ett kall og *refererer* trening;
  den stateful program-sløyfa (today → complete-session → progresjon) og
  domene-spesifikk rapportering beholdes. Gathering deles med chat via
  `gatherDayContext` slik at de ikke driver fra hverandre.

## Åpne punkter (avklares før bygging)

- ~~**Identifisering av aktivt reise-tema i Ekko**~~ Avgjort: serveren utleder
  temaet fra ankomstdatoen (`pickTripForDate`), `themeId` fra Ekko er kun override.
  Holder Ekko uvitende om tema-taksonomien og treffer «reise = temporalt filter».
- **Forsoning plan ↔ observasjon**: matche på dato + destinasjons-streng, eller
  nærhet i koordinater? Stedsnavn-match er sprøtt; koordinat-nærhet krever at
  begge sider er geokodet.
- **Vær-snapshot ved auto-seed**: hvilken vær-kilde ferie-`stops` bruker, og om
  den kan kalles serverside ved etappe-lagring.
- **Når fryses `geoByDay`**: ved hver `arrived`-etappe (inkrementelt) eller ett
  samlet snapshot ved reiseslutt? Inkrementelt er mer robust mot at turen aldri
  «avsluttes» eksplisitt.

## Implementert 2026-06-19

**Fase 1 — datamodell:**
- `scripts/db-migrations/0021_live_session_theme.sql`: `live_sessions.theme_id`
  (nullbar FK → `themes`, `ON DELETE SET NULL`) + indeks. Matchende felt i
  `schema.ts`.
- `tripProfile.geoByDay` lagt til i `schema.ts` og i `TripProfile`-typen
  (`components/domain/trip-api.ts`).

**Fase 2 — capture + ren logikk:**
- `src/lib/server/trip-geo.ts`: rene funksjoner `shouldReplaceDayGeo` (presedens
  observert > deklarert > overnatting), `buildObservedDayGeo` (kjøre-økt → dags-geo,
  faktisk sluttposisjon med fallback til destinasjon), `applyDayGeo` (immutabel
  merge) og `osloDayKey` (ISO-dato i Oslo-tid). 15 enhetstester i `trip-geo.test.ts`.
- `DELETE /api/apps/live-session` med `reason='arrived'`: henter økten, **utleder
  reise-temaet fra ankomstdatoen** (`inferTripThemeId` → `pickTripForDate`) og
  beriker temaets `tripProfile.geoByDay` med observert sted (helper `enrichThemeGeo`).
  Ekko trenger ikke vite noe om temaet.
- `pickTripForDate` (ren funksjon, 5 tester): velger turen hvis vinduet
  [startDate, endDate] dekker datoen; smaleste vindu vinner ved overlapp.
- `POST /api/apps/live-session` tar imot valgfri `themeId` som **override** for de
  flertydige tilfellene (overlappende turer, kjøretur utenfor turvinduet).
- `PUT /api/tema/[id]/trip` gjort felt-vis mergende (som ferie-endepunktet) slik at
  skjema-lagring ikke overskriver `geoByDay`.

**Fase 3 — UI:**
- `src/lib/components/domain/TripDiary.svelte`: per-dag reisedagbok over turvinduet.
  Stedet auto-seedes fra `geoByDay` med kilde-merke (📍 spored / 🗓 planlagt /
  🏨 overnatting). Gjenbruker det tema-agnostiske dagbok-endepunktet via `tripApi`
  (`getDiary`/`putDiaryEntry`). Lagrer per dag ved blur. `data-track` satt på felt.
- Montert i `TripDashboard.svelte` etter helse-seksjonen.

**Fase 4 — dagens plan til Ekko (2026-06-20):**
- `gatherDayContext(userId, date?, tz?)` + `formatDayContextBlock(ctx)` ekstrahert i
  `day-location-context.ts`. `buildDayContextBlock` er nå en tynn wrapper — chat og
  Ekko deler samme strukturkilde. Prosaen er uendret (5 tester på formatteren).
- `dayWindowInfo(start, end, dato)` i `trip-geo.ts` (delt «dag X av Y», 4 tester).
- `GET /api/apps/day?date=` (`src/routes/api/apps/day/+server.ts`): komponerer
  `{ date, trip, movement, stay, training }`. `trip` utledes via `pickTripForDate`,
  `training` er en tynn peker (`programId`/`sessionId`/`kind`/`name`/`done`) til
  aktivt program — Ekko driller ned i `/programs/[id]/today` for detalj.
- Program-API-et er uendret; `/day` aggregerer kun henting.

**Fase 5 — gjenstående geo-berikelse (2026-06-20):**
- **Deklarert geo-backfill**: `reconcileDeclaredGeo(geoByDay, vindu, ønskede)` (ren,
  5 tester) fyller `geoByDay`-laget «declared» fra dagsoppgaver. Trigget fra
  `reconcileTripStays` i `stays.ts` (samme `syncStaysForDate`-hook som overnattinger),
  så «Kjøre til Volda» gir et stedssignal samme dag — selv uten kjøretur. Selv-
  korrigerende (fjerner foreldede declared-dager) og rører aldri `observed`.
- **Vær-snapshot ved ankomst**: `seedArrivalDiary` i live-session `arrived`-stien
  henter met.no for ankomstkoordinatet (best-effort, `fetchRawTimeseries` +
  `buildPeriods`) og legger sted + vær på dagboknotatet uten å røre brukerens tekst.
- **Reiserute-kart**: `TripDashboard` plotter `geoByDay`-punktene kronologisk med
  rutelinje, fargede markører (grønn = spored / gul = planlagt) og auto-fit. Kart-
  containeren fikk omsider eksplisitt høyde + stiler.

## Gjenstår

- **Transaksjons-geo** (tids-match mot `geoByDay`) er ikke bygd — bevisst utsatt.
  Nå som Ekko mater observerte data kan det bygges når behovet melder seg.

## Verifisering

- `npm run check` (0 feil) og `npm test` (648 tester grønne, inkl. 34 nye
  `trip-geo`-/dagskontekst-tester).
- Reise-temaet er ikke en av de 5 visuelle baseline-sidene, så `test:visual`
  (piksel-diff) påvirkes ikke. Reiserute-kartet og dagbok-UI bør røyktestes i
  nettleser; LLM-review (`test:visual:review`) krever OpenAI-nøkkel + kjørende
  server og er ikke kjørt i denne sesjonen.
- Manuelt ende-til-ende: opprett reise-tema med datoer som dekker i dag → start en
  `driving`-økt (dagens Ekko-flyt, uten `themeId`) → avslutt med `arrived` →
  verifiser at `geoByDay` for dagen ble satt til observert på riktig tema (utledet
  fra datoen) → se auto-seedet dagbok i `TripDashboard`.
