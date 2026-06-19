# Bilferie: Ekko-tracking + reise-tema + feriedagbok

Dato: 2026-06-19
Status: planlagt

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

## Åpne punkter (avklares før bygging)

- **Identifisering av aktivt reise-tema i Ekko**: eksplisitt `themeId` (bruker
  velger tema før etappe) er enklest og minst overraskende. Alternativt kan
  serveren gjette fra dato innen et temas `[startDate, endDate]`.
- **Forsoning plan ↔ observasjon**: matche på dato + destinasjons-streng, eller
  nærhet i koordinater? Stedsnavn-match er sprøtt; koordinat-nærhet krever at
  begge sider er geokodet.
- **Vær-snapshot ved auto-seed**: hvilken vær-kilde ferie-`stops` bruker, og om
  den kan kalles serverside ved etappe-lagring.
- **Når fryses `geoByDay`**: ved hver `arrived`-etappe (inkrementelt) eller ett
  samlet snapshot ved reiseslutt? Inkrementelt er mer robust mot at turen aldri
  «avsluttes» eksplisitt.

## Verifisering (planlagt)

- `npm run check` + `npm test` (nye tester for geo-presedens og
  `live_session` → `geoByDay`-bygging).
- Etter UI-endring i `TripDashboard`: `npm run test:visual:review` med
  `VISUAL_REVIEW_CONTEXT`.
- Manuelt ende-til-ende: opprett reise-tema → legg «Kjøre til Volda» som
  dagsoppgave → Ekko starter `driving`-økt med `themeId` → kjør/avslutt →
  verifiser at `geoByDay` for dagen ble raffinert fra deklarert til observert →
  se reiserute, geo-plasserte transaksjoner og auto-seedet dagbok i `TripDashboard`.
