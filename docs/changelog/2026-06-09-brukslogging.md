# Brukslogging

Dato: 2026-06-09
Status: ferdig (migrasjon kjøres ved deploy)

## Kontekst

Brukeraudit 8. juni baserte seg på selvrapportering («jeg bruker helse og sjekkliste daglig, økonomi sjelden»). For at fremtidige audits skal bygge på faktisk bruk i stedet for synsing, trengs logging av hvilke sider som besøkes og hvor ofte appen åpnes.

Chat og egenfrekvens-sjekkin logges allerede (`messages`- og `sensor_events`-tabellene) — gapet var navigasjon/sidevisninger, som ikke ble logget noe sted.

## Faser

### Fase 1: Datamodell
- `scripts/db-migrations/0015_usage_events.sql` + `usageEvents` i `src/lib/db/schema.ts`
- Tabell `usage_events`: `user_id`, `event_type` ('page_view' | 'app_resume'), `path`, `metadata`, `created_at`. Indeks på `(user_id, created_at)`.

### Fase 2: Innsamling
- `src/lib/client/usage-logger.ts` — fire-and-forget `fetch` med `keepalive`, feil svelges stille. Hopper over logging når `navigator.webdriver` er satt, så Playwright-kjøringer ikke forurenser dataene.
- `src/routes/+layout.svelte` — `afterNavigate` logger `page_view` (dekker også første sidelast), `visibilitychange` logger `app_resume` når PWA-en hentes frem igjen (throttlet til én per 30 min).
- `POST /api/usage` — validerer hendelsestype, lagrer med `locals.userId`.

### Fase 3: Oppsummering
- `src/lib/server/services/usage-summary.ts` — ren, testbar logikk: normaliserer dynamiske stier (`/tema/<uuid>` → `/tema/[id]`), teller aktive dager og time-fordeling i Oslo-tid, estimerer økter (gap > 30 min = ny økt).
- `GET /api/usage/summary?days=30` — returnerer totalEvents, activeDays, sessions, totalAttentionMs, byDay, byPath (sortert etter oppmerksomhetstid), byHour, topInteractions.

### Fase 4: Oppmerksomhetstid og interaksjoner
- **`attention`-hendelser**: klienten teller 5-sekunders bolker mens fanen er synlig og brukeren ikke har vært idle >60 sek (pointer/scroll/tast/touch nullstiller idle-klokka). Tiden krediteres siden ved navigasjon videre eller når appen går i bakgrunnen. Lagres som `metadata.durationMs`.
- **`interaction`-hendelser**: delegert click-listener i rot-layouten logger klikk på interaktive elementer (`button`, `a`, `input`, `label`, `[role=button]`, `summary`, `[data-track]`). Label utledes: `data-track` > `aria-label` > input-type/navn > knappetekst (60 tegn). Sett `data-track="..."` på viktige kontroller for stabile navn.
- **Batching**: hendelser køes i klienten og sendes hvert 10. sekund / ved 20 hendelser / ved `pagehide`/skjuling (da via `sendBeacon`). Klient-tidsstempel (`at`) brukes som `created_at` når det er ferskt (<24t), så batching ikke skjevfordeler økt- og timestatistikk.
- `src/lib/server/services/usage-events.ts` — ren validering av payload (typer, klamping av durationMs til 6t, label-lengde, batch-tak 100).

## Beslutninger

- **Egen tabell, ikke `sensor_events`**: sidevisninger er ikke domenedata og skal ikke blandes inn i aggregater/signaler. Egen tabell kan også tømmes/trunkeres fritt.
- **Klientside-logging via `afterNavigate`**, ikke server-hook: SvelteKit klient-navigasjon treffer ikke alltid serveren (data kan være cachet), så server-side logging ville undertelle. Én hendelse per faktisk navigasjon er riktigere.
- **Rå stier i DB, normalisering ved lesing**: gjør at normaliseringsreglene kan forbedres uten å miste data.
- **Økter avledes ved lesing** (30-min-gap) i stedet for sessionId fra klienten — enklere, og godt nok for audit-formålet.
- **Tick-basert oppmerksomhetstelling** (5s-bolker med idle-grense) fremfor start/stopp-tidsstempler: robust mot sove-/vekkesykluser på mobil, og maks 5s avvik per side.
- **Alle klikk på interaktive elementer logges** med utledet label fremfor kun eksplisitt instrumenterte: gir full dekning fra dag én, og `data-track` kan legges på etter hvert der auto-label er for ustabil.
- **Ingen schema-endring for fase 4**: `attention`/`interaction` gjenbruker `metadata`-jsonb-feltet fra 0015-migrasjonen.

## Verifisering

- 23 nye enhetstester i `usage-summary.test.ts` (normalisering, økt-telling, Oslo-tidssone, attention-aggregering, interaksjonstelling) og `usage-events.test.ts` (payload-validering, klamping, tidsstempel-grenser). `npm test`: 357 tester grønne.
- `npm run check`: 0 feil i brukslogging-filene.
- Migrasjonen er additiv og kjøres automatisk av deploy-pipelinen (`sync-db-schema.mjs`).

## Bruk ved neste audit

Hent faktisk bruk med `GET /api/usage/summary?days=30` (innlogget, eller med `x-resonans-user-id`-header). Kryss-sjekk mot `messages` (chat-aktivitet) og `sensor_events` med `dataType='egenfrekvens_checkin'` (sjekkin-aktivitet) for et komplett bilde.
