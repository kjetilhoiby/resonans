# Bilferie: Ekko-tracking + reise-tema + feriedagbok

Dato: 2026-06-19
Status: planlagt

## Kontekst

Bruker skal på en liten bilferie (et par etapper, noen få dager) og vil bruke
Resonans til å tracke turen. Alle byggeklossene finnes allerede — de er bare
ikke koblet sammen:

1. **Reise-tema** (`themes.tripProfile`: destinasjon, datoer, `overnightStays`)
   med `TripDashboard.svelte`, auto-detektert fra temanavn i
   `theme-dashboard-registry.ts` (`travel`-kind).
2. **Feriedagbok** (`/api/tema/[id]/ferie/diary` → `reflections` med
   `kind='feriedagbok'`, én notat per dag, lagrer `content` + `place` +
   `weather` i `scores`-jsonb). Vises i dag kun i `FerieDashboard`.
3. **Ekko-tracking** (`POST /api/apps/live-session` med `sportType='driving'`
   → `live_sessions`, matet med Tesla-telemetri: posisjon, batteri, rekkevidde
   via `syncTeslaForUser`/`updateDrivingLiveSession`).

**De tre hullene som dette prosjektet tetter:**

1. `live_sessions` har ingen `themeId` — en kjøretur er løsrevet fra reise-temaet.
2. `tripProfile` modellerer overnattinger, men ikke *etapper* (kjørte strekninger).
3. Feriedagboka er teknisk generisk (diary-endepunktet validerer *ikke*
   dashboard-typen — det skriver bare på `themeId`), men vises kun i ferie-UI.

**Idé:** Én bilferie = ett reise-tema. Hver Ekko-kjøretur blir en *etappe* på
temaet. Hver dag får et dagboknotat som auto-fylles med etappens endepunkt + vær,
slik at man kommer hjem til en dagbok som allerede vet *hvor* man var — og bare
skriver inn *hva som skjedde*.

Avgrenset med bruker: foreløpig **kun design** (dette dokumentet), ikke kode.

## Faser

### Fase 1: Datamodell — koble kjøretur til tema + etappe-modell

- **`live_sessions.theme_id`** (nullbar FK → `themes.id`). Lar en kjøre-økt
  knyttes til et reise-tema. Migrasjon `scripts/db-migrations/NNNN_live_session_theme.sql`
  (`ADD COLUMN IF NOT EXISTS`) + matchende felt i `schema.ts`.
- **`tripProfile.legs`** (additivt jsonb-felt på eksisterende `tripProfile`):
  ```ts
  legs?: Array<{
    id: string;
    label?: string;            // "Oslo → Lillehammer"
    fromPlace?: string;
    toPlace?: string;
    date: string;              // ISO 'YYYY-MM-DD'
    distanceKm?: number;
    durationMin?: number;
    liveSessionId?: string;    // kobling tilbake til kjøre-økten
    routeCoordinates?: unknown; // GeoJSON/polyline, gjenbruk live_sessions-formatet
  }>;
  ```
  Ren `tripProfile`-utvidelse — ingen ny tabell, ingen drizzle-strukturendring
  utover typen (jsonb er allerede der).

### Fase 2: Ekko-flyt — knytt og persister etapper

- **`POST /api/apps/live-session`**: ta imot valgfri `themeId` i body, lagre på
  økten. Ekko sender med det aktive reise-temaet når man starter en etappe
  («Start etappe i Bilferie juni»).
- **`DELETE /api/apps/live-session`** (`reason: 'arrived'`): når økten avsluttes
  og har `themeId`, persister den som en etappe på temaets `tripProfile.legs`.
  Distanse/varighet/rute kommer gratis fra Tesla-telemetrien som allerede ligger
  på `live_sessions` (`routeDistanceM`, tidsstempler, `lastLat/lon`,
  `routeCoordinates`).
- Ren etappe-bygging (`live_session` → `leg`) ekstraheres til en testbar funksjon
  i `src/lib/server/` (uten DB-kobling), med enhetstester (jf. prinsipp 3).

### Fase 3: Dagbok + dashboard på reise-tema

- **Gjenbruk diary-endepunktet** som det er (det er allerede `themeId`-basert,
  ingen ferie-validering). Render dagbok-seksjonen i `TripDashboard.svelte`, ikke
  bare i `FerieDashboard`. Vurder å trekke ut en delt `DiarySection`-komponent i
  `components/domain/` slik at ferie og reise deler kode (prinsipp 2).
- **Auto-seed**: når en etappe lagres (Fase 2), opprett et dagbok-utkast for
  etappens dato via samme `reflections`-skriving, med `place` = `toPlace` og
  `weather`-snapshot for stedet (gjenbruk vær-mønsteret fra ferie-`stops`).
- **«Reiserute»-seksjon** i `TripDashboard`: etappene som tidslinje + kart
  (gjenbruk Maplibre fra `SharedTripPositionView.svelte`), med dagbok-tidslinjen
  under.

### Avgrensninger (bevisst utelatt i v1)

- **Strava-push** (`/api/apps/upload`): gjelder løping/sykling med GPX, ikke
  kjøring. Ikke relevant for bilferie.
- **Familie-grid** (`ferieProfile`): reise-temaet bruker `tripProfile`, ikke
  ferie-oppholdsplanen. Hvis bilferien skal inn i en større ferieplan kan den
  forfremmes via eksisterende `ferieProfile.trips[].linkedThemeId`-mekanikk —
  utenfor dette prosjektet.

## Beslutninger

- **Reise-tema (`tripProfile`), ikke ferie-tema (`ferieProfile`)** som container.
  Ferie-temaet er bygd for familie-oppholdsplan (grid per person × dag); en liten
  bilferie passer bedre i det enklere reise-temaet. Diary og «trips med stops»
  finnes på ferie-siden, men gjenbrukes her uten familie-grid-overhead.
- **Etappe som `tripProfile.legs`, ikke egen tabell.** Holder seg til det
  etablerte profil-jsonb-mønsteret (`tripProfile`/`ferieProfile`/`projectProfile`),
  unngår ny tabell + migrasjon utover én kolonne på `live_sessions`.
- **`live_sessions` som kilde for etappedata.** Tesla-telemetrien fanges allerede
  per kjøre-økt; vi gjenbruker den i stedet for å re-tracke. Etappen blir et
  «frosset» øyeblikksbilde av den avsluttede økten.
- **Gjenbruk av diary-endepunktet uten endring i kontrakt.** Endepunktet er
  allerede tema-agnostisk; eneste arbeidet er å eksponere det i `TripDashboard`
  og auto-seede notater fra etapper.

## Åpne punkter (avklares før bygging)

- **Identifisering av aktivt reise-tema i Ekko**: sender Ekko `themeId` eksplisitt
  (bruker velger tema før etappe), eller skal serveren gjette basert på dato innen
  et temas `tripProfile.startDate`/`endDate`? Eksplisitt er enklest og minst
  overraskende.
- **Vær-snapshot ved auto-seed**: hvilken vær-kilde/-funksjon ferie-`stops` bruker
  i dag, og om den kan kalles serverside ved etappe-lagring.
- **Etappe vs. dag**: én etappe per dag (enkelt) eller flere etapper per dag
  (krever gruppering i dagbok-tidslinjen)? Turen er liten, så én-per-dag holder
  trolig for v1.

## Verifisering (planlagt)

- `npm run check` + `npm test` (nye tester for `live_session` → `leg`-bygging).
- Etter UI-endring i `TripDashboard`: `npm run test:visual:review` med
  `VISUAL_REVIEW_CONTEXT`.
- Manuelt ende-til-ende: opprett reise-tema → Ekko starter `driving`-økt med
  `themeId` → kjør/avslutt → verifiser etappe på `tripProfile.legs` + auto-seedet
  dagboknotat → se reiserute + dagbok i `TripDashboard`.
