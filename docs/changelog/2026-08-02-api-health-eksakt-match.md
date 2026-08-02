# /api/health som eksakt match — og siste offer for prefiksfella

Dato: 2026-08-02
Status: ferdig

## Kontekst

`/api/health` lå i `PUBLIC_API_PREFIXES` i `hooks.server.ts`, og matchingen var
`pathname.startsWith(prefix)`. Siden `requestUserHandle` returnerer tidlig for
offentlige stier, ble `locals.userId` **aldri satt for noe under `/api/health/`**.

Det er en felle som ser uskyldig ut: du legger et helse-endepunkt der navnet hører
hjemme, og det slutter stille å virke. Den har slått til tre ganger:

| Endepunkt | Utfall | Oppdaget |
|---|---|---|
| `/api/health/effort-weight` | Feilet i prod, flyttet til `/api/effort-weight` | jul. 2026 (`2026-07-05-effort-vektterskel.md`) |
| `/api/health/weight-onboarding` | Stille 401, vekt-onboarding-flyten fullførte aldri | aug. 2026 (`2026-08-02-helse-mortema.md`) |
| `/api/health/weight-series` | Uautentisert `200 OK` med tomme data | denne runden |

To ganger ble symptomet fikset ved å flytte endepunktet. Fella ble stående.

## Faser

### Fase 1: Slett weight-series

`src/routes/api/health/weight-series/+server.ts` (397 linjer) er fjernet.

Verifisert dødt før sletting:

- **Null kallsteder.** Uttømmende søk på `weight-series`/`weightSeries` i alle filtyper,
  inkludert `docs/`, `scripts/`, `tests/`, `.github/`. Ingen fetch, ingen import, ingen
  test, ingen dynamisk URL-bygging. `git log -S "weight-series" --all` viser at strengen
  aldri har forekommet i noe filinnhold — det har altså aldri eksistert en kaller.
- **Født død.** Kom inn med PR #227 (langtidsmål) 2026-07-14 og er aldri endret siden.
  Funksjonaliteten den var tenkt for lever på `/plan/mal` via `readWeightProgress`
  (`src/lib/server/goal-progress.ts:94`) — en helt annen datavei.
- **Utenfor Ekkos flate**, per regelen i CLAUDE.md. Ingen OpenAPI-spec, og
  `WeightPoint`/`WindowPreset` var lokale og ueksporterte typer.
- **Ingenting verdt å bevare.** `buildDesiredLine`/`buildForecast` finnes bedre i
  `computePaceEstimate` (`components/domain/plan/helpers.ts:188`) — som har tester, og
  som bruker faktisk forløpt tid som denominator i stedet for avstanden mellom første og
  siste *måling*. Multi-periode-overlay gjøres i `charts/WeightProgressLayerCake.svelte`,
  og y-akse-padding regner chartkomponentene selv.

**Verdt å merke seg om feilmodusen:** i motsetning til `weight-onboarding` hadde
weight-series ingen null-sjekk på `locals.userId`. `app.d.ts` typer feltet som `string`
(ikke `string | undefined`), så TypeScript fanget det ikke, og `eq(sensorEvents.userId,
undefined)` ble `user_id = null` — som aldri matcher. Endepunktet svarte derfor
`200 OK` med `success: true` og tomme serier til hvem som helst, uten autentisering.
Ingen datalekkasje, siden spørringen aldri traff en rad, men den stilleste mulige
feilmodusen.

### Fase 2: Eksakt match, ikke prefiks

`/api/health` er flyttet til en ny `PUBLIC_API_EXACT`-liste. Et nytt endepunkt under
`/api/health/` får nå normal auth, så en fjerde forekomst er ikke mulig.

Helsesjekken selv er uendret: `src/routes/api/health/+server.ts` leser aldri
`locals.userId` — den autentiserer med `Bearer $CRON_SECRET` eller `?debug` — og skal
være offentlig.

Trailing slash håndteres eksplisitt: hooks kjører før SvelteKit normaliserer stien, så
`/api/health/` ville falt utenfor en naiv eksakt match og begynt å kreve innlogging.

### Fase 3: Gjør auth-grensen testbar

Logikken bodde kun inline i `hooks.server.ts`, uten en eneste test — og hadde forårsaket
tre bugs. Flyttet til `src/lib/server/public-paths.ts` med 11 tester i
`public-paths.test.ts`, inkludert eksplisitt regresjonsvern for alle tre forekomstene og
for at eksakt match ikke skal gli tilbake til prefiks (`/api/healthcheck` → ikke public).

## Beslutninger

**Bare `/api/health` ble endret.** De øvrige prefiksene har reelle undersider:
`/api/cron` (21 endepunkter), `/api/share-link` (6), `/api/live` (2). Enkelt-endepunktene
i lista — e-post-webhookene, `/api/scheduler/trigger`, `/api/apps/*`-callbackene — har
samme latente risiko, men ingen historikk med feilen og ingen planlagte underveier. Å
endre åtte webhook-stier i en oppryddingsoppgave er unødvendig deploy-risiko. Mulig
oppfølging, ikke gjort nå.

**`app.d.ts` er ikke rettet.** Den typer `locals.userId` som `string`, men på offentlige
stier er verdien i praksis `undefined`. Det er den underliggende løgnen som lot
weight-series kompilere. Å rette den til `string | undefined` ville gi typefeil i hvert
eneste endepunkt som leser feltet — et eget prosjekt, ikke en opprydding. Verdt å ta
etter hvert; det er den eneste gjenstående delen av rotårsaken.

## Verifisering

- `npm run check`: 0 feil, 0 advarsler.
- `npm test`: 1925 tester grønne (fra 1914), 11 nye.
- `vite build`: grønn — ruten er borte fra manifestet uten dangling referanser.
- `rg -n "weight-series"` treffer kun changelogene og regresjonstesten (som asserter at
  stien *ikke* er offentlig).

Manuelt (krever kjørende dev-server, ikke tilgjengelig i agentmiljøet):

- `curl -s localhost:5174/api/health` → `{"status":…}` uten innlogging.
- `curl -s "localhost:5174/api/health?debug=true"` → full systemstatus.
- `curl -o /dev/null -w '%{http_code}' localhost:5174/api/health/finnes-ikke` → 401 eller
  redirect til `/auth`, **ikke** 200. Det er beviset på at fella er lukket.
