# Resonans — Plan for raskere navigasjon, cache og PWA-retning

Status: Proposal
Last updated: 2026-03-31
Owner: Copilot

## Mål

Gjøre Resonans merkbart mer responsiv ved å:

- la navigasjon skje umiddelbart uten å blokkere på tunge dashboard-kall
- vise sist kjente data først der det er trygt
- oppdatere dashboard-data inkrementelt i bakgrunnen
- starte prefetch når brukeren treffer hjemskjermen
- legge et PWA-lag oppå denne arkitekturen når grunnflyten er riktig

## Kort konklusjon

Dette er en naturlig del av en PWA-retning, men ikke noe som bør angripes som "først PWA, så ytelse".

Riktig rekkefølge er:

1. Frikoble navigasjon fra tung datalasting.
2. Innføre klientcache og bakgrunnsoppdatering.
3. Legge til prefetch fra hjemskjermen.
4. Bygge inkrementelle dashboard-endepunkter.
5. Legge på service worker og PWA-cache-strategier.

PWA gir ekstra verdi når appen allerede er bygget rundt raske skjermskifter og stale-while-revalidate, ikke som erstatning for det.

## Hva som er tregt i dagens løsning

Det viktigste flaskehalsmønsteret er at temaruten venter på dashboard-data før siden får lov til å vises.

Konkrete steder:

- `src/routes/tema/[id]/+page.server.ts`
- `src/lib/server/health-dashboard.ts`
- `src/lib/components/domain/ThemePage.svelte`
- `src/lib/components/domain/HomeScreen.svelte`

I dag gjør `src/routes/tema/[id]/+page.server.ts` dette:

1. finner tema
2. finner eller oppretter conversation
3. laster meldinger og mål
4. laster helse- eller økonomidashboard synkront
5. returnerer alt som én blokk til siden

Det gir korrekt dataflyt, men feil UX-flyt:

1. bruker trykker på tema
2. navigasjon venter på tung server-load
3. UI reagerer sent
4. brukeren opplever trykket som seigt

For helse forverres dette fordi dashboard-loaderen i `src/lib/server/health-dashboard.ts` fortsatt henter mye rå- og aggregert data i ett kall.

## Produktmål for ny flyt

Når brukeren trykker på et tema skal opplevelsen være:

1. skjermskifte skjer umiddelbart
2. chat, header og struktur vises med en gang
3. siste kjente dashboard-data kan vises hvis de finnes
4. dashboard oppdateres i bakgrunnen
5. brukeren kan samhandle med skjermen uten å vente på full rehydrering

Det betyr at navigasjon, visning og oppdatering må være tre separate steg.

## Målarkitektur

### 1. Minimal ruteload

Temaruten skal bare laste det som er nødvendig for å rendre strukturen:

- theme
- conversationId
- initialMessages
- goals
- themeConversations
- themeInstruction

Ikke del av blokkerende ruteload:

- `healthDashboard`
- `economicsDashboard`
- store serier med rå sensordata

Prinsipp:

"Ruten er for første paint. Dashboards er for progressiv hydration."

### 2. Dashboards får egen dataflyt

Helse og økonomi bør hente data via egne klientkall etter at temaskjermen er synlig.

To mulige former:

1. ett generisk endepunkt per tema
2. ett endepunkt per dashboardtype

Anbefaling:

- `GET /api/themes/:id/dashboard/health`
- `GET /api/themes/:id/dashboard/economics`

Dette gir enklere cache-policy, enklere måling og mindre betinget logikk i route-load.

### 3. Egen dashboard-cache i klient

Det trengs et mellomlag mellom skjerm og nettverk.

Foreslått cachemodell per tema:

```ts
type DashboardCacheEntry<T> = {
  status: 'idle' | 'loading' | 'ready' | 'refreshing' | 'error';
  data: T | null;
  cachedAt: string | null;
  serverVersion?: string | null;
  lastCursor?: string | null;
  error?: string | null;
};
```

Lagringsnivåer:

1. in-memory store for aktiv sesjon
2. persistert cache for sist kjente payload
3. senere service worker-cache for nettverksnivå

Anbefaling for første versjon:

- start med Svelte-store + `localStorage` eller IndexedDB
- gå til IndexedDB hvis payloadene er store eller flere dashboards skal lagres robust

### 4. Stale-while-revalidate i UI

Når temaet åpnes:

1. les cache hvis den finnes
2. vis cached data direkte
3. marker at data oppdateres
4. hent ny versjon i bakgrunnen
5. patch UI når nytt svar kommer

Dette gir riktig opplevelse også når data ikke er helt ferske. For dashboard-visning er det ofte riktig kompromiss.

### 5. Prefetch fra hjemskjerm

Hjemskjermen er riktig sted å varme opp sannsynlige neste visninger.

Det passer godt med dagens struktur i `src/lib/components/domain/HomeScreen.svelte`, som allerede gjør klientkall på mount.

Foreslått strategi:

1. når hjemskjermen er synlig, hent lettvektsdata som i dag
2. etter første interaktive render, start prefetch med lav prioritet
3. prefetch bare for relevante temaer, ikke alt blindt

Relevansheuristikk i første versjon:

1. Helse hvis sensorer finnes
2. Økonomi hvis økonomi-widget eller konto-data finnes
3. temaer som ligger først i railen
4. eventuelt sist åpnet tema

Mekanikk:

- `requestIdleCallback` når tilgjengelig
- fallback til `setTimeout`
- avbryt prefetch ved ny navigasjon eller dårlig nettverk hvis ønskelig senere

### 6. Inkrementelle oppdateringer

Det viktigste ytelsesløftet kommer når dere slutter å tenke "last hele dashboardet på nytt".

I stedet:

1. klienten sender siste kjente cursor eller timestamp
2. serveren returnerer bare endringer siden sist
3. klienten patcher lokalt snapshot

Eksempel for helse:

```ts
GET /api/themes/:id/dashboard/health?since=2026-03-31T08:12:00.000Z
```

Respons kan være:

```ts
{
  mode: 'delta',
  cursor: '2026-03-31T09:01:22.000Z',
  appendedEvents: [...],
  updatedAggregates: {
    weekly: [...],
    monthly: [...]
  }
}
```

Hvis cache mangler eller serveren ikke kan garantere korrekt diff:

```ts
{
  mode: 'full',
  cursor: '2026-03-31T09:01:22.000Z',
  snapshot: {...}
}
```

Dette er enklere å innføre hvis endepunktene eksplisitt eier snapshot-formatet.

## Foreslått gjennomføring

## Fase 0 — Instrumentering og baseline

Mål: vite nøyaktig hvor tiden går før arkitektur endres.

Oppgaver:

1. Mål tid fra trykk til første visuelle respons på tema-navigasjon.
2. Mål tid brukt i `src/routes/tema/[id]/+page.server.ts`.
3. Mål størrelse på helse- og økonomipayloads.
4. Mål tid brukt i `loadHealthDashboardData`.
5. Logg antall datapunkter som faktisk hentes per skjerm.

Enkle KPI-er:

- TTI for tema-visning
- tid til første paint av ThemePage
- tid til dashboard ready
- payload-størrelse i KB
- cache hit ratio senere

## Fase 1 — Gjør navigasjon ikke-blokkerende

Mål: tema skal åpnes raskt selv om dashboard-data er tunge.

Oppgaver:

1. Fjern `healthDashboard` og `economicsDashboard` fra blokkerende route-load i `src/routes/tema/[id]/+page.server.ts`.
2. Behold bare lettvektsdata i route-load.
3. Flytt dashboardhenting inn i `ThemePage.svelte` eller dedikerte dashboard-containere.
4. Vis skeleton eller sist kjente snapshot i data-tab umiddelbart.

Konsekvens:

Trykkrespons forbedres uten at PWA er innført.

## Fase 2 — Introduser klientcache og refresh-status

Mål: gjentatte åpninger av et tema skal føles umiddelbare.

Oppgaver:

1. Lag en dashboard-store under for eksempel `src/lib/state/` eller `src/lib/stores/`.
2. Cache dashboardpayload per tema og type.
3. Legg ved metadata: `cachedAt`, `status`, `cursor`, `source`.
4. Når temaet åpner, les fra cache før nettverkskall.
5. Skille visuelt mellom:
   - ingen data ennå
   - cached data vises
   - oppdaterer i bakgrunnen
   - feil ved refresh, men sist kjente data beholdes

Anbefalt UX-tekst:

- "Viser sist synkede data"
- "Oppdaterer..."
- "Kunne ikke hente ferske data akkurat nå"

## Fase 3 — Prefetch fra hjemskjerm

Mål: hjemskjermen skal varme opp sannsynlige neste dashboard-visninger.

Oppgaver:

1. Legg prefetch-initiering i `src/lib/components/domain/HomeScreen.svelte`.
2. Start prefetch etter første mount og etter lettvektsdata er på plass.
3. Prefetch kun topp prioriterte temaer.
4. Sørg for at prefetch ikke påvirker synlig interaksjon negativt.
5. Avbryt eller nedprioriter hvis bruker navigerer umiddelbart.

Praktisk førsteversjon:

1. Prefetch Helse og Økonomi hvis de finnes blant aktive temaer.
2. Ikke prefetch chatmeldinger eller tunge historikk-lister.
3. Prefetch bare data-tab-snapshot.

## Fase 4 — Gjør endepunktene inkrementelle

Mål: redusere både datamengde og serverarbeid ved refresh.

Oppgaver:

1. Definer cursor-format per dashboard.
2. La klient sende `since` eller `cursor`.
3. Returner delta når mulig, full snapshot ellers.
4. Samle oppdateringslogikk i serverlag per dashboardtype.
5. Vurder å skille mellom:
   - rå events
   - ferdige aggregater
   - UI-formatert snapshot

For helse bør dere ideelt gå mot at dashboard-endepunktet i hovedsak returnerer et ferdig snapshot, ikke rå eventstrøm som klienten må tolke mye av.

## Fase 5 — PWA-laget

Mål: gjøre den nye dataflyten mer robust, raskere og tilgjengelig offline.

Oppgaver:

1. Legg til web app manifest og ikoner.
2. Innfør service worker.
3. Cache shell og statiske assets.
4. Bruk stale-while-revalidate for dashboard-endepunkter.
5. Legg til offline fallback for sist kjente dashboards.
6. Senere: background sync der det er nyttig.

PWA-strategi per datatype:

- app shell: cache-first
- dashboard snapshots: stale-while-revalidate
- mutations: network-first med lokal kø som senere opsjon
- svært ferske eller sensitive kall: network-first

## Foreslått kodestruktur

Dette er én pragmatisk retning som passer dagens kodebase:

```text
src/lib/
  stores/
    dashboard-cache.ts
  client/
    dashboard-loader.ts
  server/
    dashboard/
      health.ts
      economics.ts
      snapshot-types.ts
src/routes/api/themes/[id]/dashboard/
  health/+server.ts
  economics/+server.ts
```

Ansvar:

- route `+page.server.ts`: bare første paint-data
- API-endepunkter: snapshot eller delta
- store: cache, status, refresh-state
- ThemePage og dashboard-komponenter: rendering og trigging av loader

## Konkrete endringer i eksisterende filer

### `src/routes/tema/[id]/+page.server.ts`

Endres fra:

- route loader for både side og dashboard

Til:

- route loader kun for temaets grunnstruktur

### `src/lib/components/domain/ThemePage.svelte`

Endres fra:

- motta ferdig dashboard som prop

Til:

- trigge klientlast av dashboard når data-tab er aktiv, eller tidligere hvis prefetch allerede har fylt cache
- lese dashboarddata fra store
- vise stale-data og refresh-state

### `src/lib/components/domain/HomeScreen.svelte`

Endres fra:

- hente bare lettvekts home-data

Til:

- også starte bakgrunnsprefetch av prioriterte tema-dashboards etter første render

### `src/lib/server/health-dashboard.ts`

Endres fra:

- monolittisk full-load brukt direkte fra route

Til:

- serverhjelper som kan levere snapshot og senere delta til health-endepunktet

## Data- og cachepolicy

Ikke alle data bør behandles likt.

### Kan trygt caches som sist kjente visning

- helse-aggregater per uke/måned/år
- økonomi-aggregater og saldooversikt
- kildeliste og sist sync-tid
- ferdige dashboardkort og tidsserier

### Bør hentes mer konservativt

- rå eventlister som kan bli store
- svært detaljert transaksjonshistorikk
- data som brukes til skriving eller konfliktfølsomme interaksjoner

Anbefaling:

Vis et komprimert snapshot i dashboardet. Hent detaljdata først når brukeren ber om dem.

## UX-prinsipper for denne omleggingen

1. Et trykk skal alltid gi visuell respons med en gang.
2. Skjermen skal aldri føles låst fordi data ikke er klare.
3. Sist kjente data er bedre enn tom skjerm når innholdet er lesebasert.
4. Oppdatering bør være synlig, men diskret.
5. Brukeren skal ikke straffes for dårlig nett eller store datasett.

## Risikoer og avklaringer

### Risiko 1 — Gamle data vises som om de er ferske

Tiltak:

- vis alltid `sist oppdatert`
- marker refresh-status tydelig, men rolig

### Risiko 2 — Prefetch øker last på server eller klient

Tiltak:

- begrens antall prefetchede dashboards
- bruk idle-tid og enkel prioritering
- mål faktisk gevinst før dere utvider

### Risiko 3 — Inkrementelle oppdateringer blir kompliserte

Tiltak:

- start med full snapshot + klientcache
- innfør delta bare der dere har tydelig gevinst, sannsynligvis helse først

### Risiko 4 — For mye logikk havner i komponenter

Tiltak:

- hold fetch/cache-logikk i loader/store-lag
- la UI-komponentene bare abonnere og rendre

## Anbefalt implementasjonsrekkefølge

Hvis målet er rask gevinst med lav risiko:

1. Fjern blokkerende dashboard-load fra `src/routes/tema/[id]/+page.server.ts`.
2. Introduser dashboard-endepunkter og klientkall.
3. Vis skeleton eller cached snapshot i data-tab.
4. Legg til enkel in-memory cache.
5. Legg til persistert cache.
6. Prefetch fra hjemskjerm.
7. Mål gevinst.
8. Innfør inkrementelle oppdateringer for helse.
9. Legg på service worker og PWA-shell.

## Minimum viable cut

Hvis dere vil gjøre minst mulig først, men få tydelig effekt:

### Cut A

1. Fjern helse- og økonomidashboard fra route-load.
2. Hent dashboard i klient etter at ThemePage er vist.
3. Vis loading state i data-tab.

Forventet gevinst:

- langt bedre opplevd navigasjon
- liten risiko
- ingen PWA påkrevd ennå

### Cut B

1. Legg til enkel dashboard-cache i klient.
2. Prefetch Helse fra hjemskjerm.

Forventet gevinst:

- Helse føles vesentlig raskere ved gjentatt bruk

### Cut C

1. Legg til service worker og stale-while-revalidate for dashboard-endepunkt.

Forventet gevinst:

- mer robust mobilopplevelse
- raskere varme åpninger
- grunnlag for installerbar PWA

## Beslutning

Anbefaling:

Ja, dette bør behandles som en del av PWA-retningen, men selve arbeidsrekkefølgen bør starte med å gjøre lastestrategien app-aktig først.

Den riktige tekniske historien er:

1. rask navigasjon
2. cached snapshot
3. bakgrunnsoppdatering
4. inkrementell sync
5. PWA/service worker

Hvis dere følger den rekkefølgen, får dere både mindre seighet nå og et mye sterkere grunnlag for en ekte PWA senere.