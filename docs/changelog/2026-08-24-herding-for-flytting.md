# Herding før plattformflyttingen (Fase 0)

Dato: 2026-08-24
Status: ferdig

## Kontekst

Resonans skal flyttes fra Vercel til vår egen plattform
(`resonans.apps.hoi.by`, Coolify på Hetzner — se `resonans-lab/platform/`).
Kartleggingen foran flyttingen viste en kodebase som er lite bundet til Vercel:
all env-lesing er runtime, fillagring går til Cloudinary, jobbkøen er DB-basert.
Det reelle arbeidet er ~10 filer.

Men den avdekket også fire **stille** feil av samme rotårsak: kode som er riktig
på Vercel og gal overalt ellers, uten at noe sier fra. De måtte lukkes før noe
eksponeres på en annen vert, og de er verdt å lukke uansett om flyttingen skulle
bli utsatt.

Dette dokumentet dekker Fase 0. Fase 1–5 (driverbytte, datakopiering, in-app
scheduler, bytte, space + RLS) står igjen.

## Faser

### Fase 0.1: Én cron-vakt i stedet for 24 kopier

Autentiseringen lå inline i 24 cron-endepunkter, kopiert fra hverandre, og **seks
av kopiene hadde drevet fra de øvrige**:

```ts
if (env.VERCEL_ENV && authHeader !== `Bearer ${env.CRON_SECRET}`) { … }
```

På Vercel er `VERCEL_ENV` alltid satt, så forskjellen var usynlig. Utenfor Vercel
er betingelsen alltid falsk, og de seks — `adaptive-training`, `daily-checkin`,
`day-planning-nudges`, `program-readiness`, `project-followup-nudges`,
`theme-research` — hadde stått **helt åpne**: hvem som helst kunne sende nudger
til alle brukere og brenne OpenAI-kreditt, så mange ganger de ville.

Nye filer:

| Fil | Rolle |
|---|---|
| `src/lib/server/cron-auth.ts` | `cronAuthProblem(headers, context)` — ren, testbar |
| `src/lib/server/cron-guard.ts` | `denyUnauthorizedCron(request)` — leser miljøet, returnerer 401 |

Alle 24 endepunkter åpner nå med to linjer:

```ts
const denied = denyUnauthorizedCron(request);
if (denied) return denied;
```

Stien logges fra `request.url`, ikke fra et argument, så logglinja ikke kan si
noe annet enn ruta faktisk er.

### Fase 0.2: `/api/scheduler/trigger` hadde ingen auth i det hele tatt

Ruta ligger i `PUBLIC_API_PREFIXES` og sender dagens innsjekk-nudge til alle
brukere. Den hadde **ingen** sjekk — heller ikke på Vercel. Den bruker nå samme
vakt som cron-endepunktene, siden det er samme slags kaller. Ingen kallsteder i
repoet; den er et curl-verktøy.

### Fase 0.3: Oppstartsvakt (`src/lib/server/boot-checks.ts`)

`authorizationHandle` innledes med:

```ts
if (!isGoogleAuthConfigured() || isPublicPath(…)) return resolve(event);
```

Mangler `AUTH_SECRET` eller Google-nøklene, er altså **hele appen åpen** — hver
rute, hvert API, alle data. Grenen finnes for at en fersk klone skal kunne kjøres
uten OAuth-oppsett, og det er riktig lokalt. Deployet er det en dør uten lås, og
den eneste måten å oppdage den på er å prøve.

`assertBootReady` kjøres nå fra `hooks.server.ts` og kaster hvis noe mangler:

- Google-auth ikke konfigurert → hele appen ville stått åpen.
- `CRON_SECRET` ikke satt → cron-vakta er fail-closed, så 24 endepunkter ville
  svart 401 til dispatcheren. Synkjobber og nudger stopper, og monitoreringen ser
  det ikke — `withCronTracking` kjører aldri, så det finnes ikke engang et
  registrert forsøk.

Begge er miljøfeil, ikke kodefeil, og begge oppdages ellers først i drift. En
container som **nekter å starte** er det motsatte: deployet feiler, forrige
versjon står, og feilmeldingen sier hva som mangler.

I tillegg er grenen i `authorizationHandle` gjort eksplisitt lokal
(`dev && !isGoogleAuthConfigured()`). Ikke fordi oppstartsvakta ikke dekker den,
men fordi grenen da ikke kan leses som noe annet enn lokal.

### Fase 0.4: `preview-auth.ts` slettet

```ts
// TODO: replace with env.PREVIEW_BYPASS_PASSWORD
export const PREVIEW_BYPASS_PASSWORD = '1234';
```

Et HMAC-signert bypass-token som ga full tilgang som admin-brukeren, låst med
`1234`, gatet på `VERCEL_ENV === 'preview'`. Utenfor Vercel er hele stien død
kode. Fjernet: modulen, grenen i `hooks.server.ts`, grenen i `request-user.ts`,
`previewLogin`-actionen i `/auth/+page.server.ts` og passordfeltet i
`/auth/+page.svelte` med tilhørende CSS.

## Beslutninger

**Fail-closed, ikke fail-open.** De 18 «riktige» kopiene gatet på
`env.CRON_SECRET &&` — altså: er hemmeligheten ikke satt, slipper alt gjennom.
Praktisk lokalt, farlig deployet, og en glemt miljøvariabel er ikke usannsynlig
midt i en plattformflytting. Vakta krever nå en hemmelighet så snart vi ikke er i
`dev`.

Prisen er at en glemt variabel gir 24 stille 401-er i stedet for en åpen dør, og
det er nettopp derfor `CRON_SECRET` også ligger i oppstartsvakta: feilen blir et
deploy som feiler, ikke cronjobber som forsvinner umerket.

**Verifisert mot prod før endringen ble skrevet:** `GET /api/cron/jobs` (uten
`due=1` — helt uten bivirkninger) svarer 401 fra `resonans.vercel.app`, altså er
`CRON_SECRET` satt der. Oppstartsvakta kan ikke velte dagens deploy.

**En delt vakt framfor 24 rettede kopier.** Seks av 24 kopier hadde drevet fra de
øvrige uten at noen oppdaget det — det er argumentet for å ha én. Samme
arbeidsdeling som `user-header-auth.ts`: ren logikk i én modul med tester,
miljølesing i kallstedet.

**Grunnen til avvisningen logges, men sendes ikke til klienten.** «Feil
hemmelighet» og «ingen hemmelighet konfigurert» ser identiske ut i et 401, og
skillet er verdt en time å finne — men det er ikke noe en uautentisert kaller
skal få vite.

## Det som IKKE ble endret

- **`RESONANS_HEADER_SECRET` er fortsatt fail-open.** `x-resonans-user-id` godtas
  uten hemmelighet når variabelen ikke er satt, og bruker-ID-en ligger i klartekst
  i `playwright.config.ts:16`. Valget er bevisst dokumentert i
  `user-header-auth.ts`; alternativet slo ut curl-tilgangen i samme øyeblikk koden
  ble deployet. **Variabelen skal settes i Coolify** — det er en driftsoppgave,
  ikke en kodeendring.
- **`?userId=`-parameteren og `resonans_user_id`-cookien i `request-user.ts`** er
  ikke gatet slik headeren er. De er i praksis utilgjengelige, siden
  `authorizationHandle` avviser før `requestUserHandle` kjører — men det hviler på
  at auth er konfigurert, som nå er en oppstartsgaranti framfor et håp. Verdt en
  egen runde.

## Verifisering

- `npm test` — 3 745 tester, 268 filer. Grønt.
- `npm run check` — 0 feil, 0 advarsler.
- 18 nye enhetstester: `cron-auth.test.ts` (10) og `boot-checks.test.ts` (8).
  Testene dekker eksplisitt det gamle hullet — «avviser ALT når hemmeligheten
  mangler deployet» — og at lokal utvikling fortsatt slipper gjennom.
- `GET /api/cron/jobs` mot prod uten Authorization: 401. Bekrefter at
  `CRON_SECRET` er satt der, og at oppstartsvakta ikke velter dagens deploy.
- Ingen referanser til `preview-auth`, `PREVIEW_BYPASS_PASSWORD`, `isPreviewEnv`
  eller `verifyPreviewToken` igjen i `src/`, `tests/` eller `scripts/`.
