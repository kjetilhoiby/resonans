# Helse som mortema

Dato: 2026-08-02
Status: ferdig

## Kontekst

Tidlig i prosjektet ble helse og trening behandlet som samme sak.
`theme-dashboard-registry.ts` mappet `helse`, `trening`, `søvn`, `vekt`, `løp` og
`aktivitet` til én og samme `health`-dashboardtype, og Withings-onboardingen sa det rett
ut: *«Helse, trening, søvn og restitusjon samlet i ett tema.»*

Resultatet ble en samlepost der detaljer og oversikt konkurrerte om samme skjerm.
Kartleggingen foran dette arbeidet avdekket i tillegg at flaten hadde råtnet innenfra:
tre av seksjonene rendret aldri, og omtrent halve `$derived`-kjeden matet kode som ikke
fantes i markup.

Siden den gang har repoet fått et mortema-mønster: «Hjem» eier hus-prosjekter som egne
tema via `themes.parentTheme`, og «Familie» eier ferier (se
`2026-06-09-hus-prosjekter.md`). Flyt-registeret forutsatte allerede hierarkiet — tre
helse-flyter var merket `parentTheme: 'Helse'`.

**Dette reverserer en tidligere beslutning.** `docs/archive/HEALTH_THEME_EXECUTION_PLAN.md`
(2026-03-29) etablerte at helse-dashboardet bor i Helse-temaets data-fane. Det gjør det
fortsatt, men flaten er nå oversikt, ikke detalj.

## Faser

### Fase 0: Rydding før splitten

Verifisert dødt i praksis, ikke bare flyttekandidater:

- `metricCards` ble bygget hver render, men forekom ingen steder i markup.
- «Aktive mål» og «Datatilgang og tool-sjekk» rendret aldri, fordi `ThemeDataTab`
  verken sendte `goals` eller `tooling` inn.
- `embedded`-propen var alltid `true` (én kallsted), så header-grenen var død.
- `loadGoalTracks()` gjorde to fetch-kall per lasting kun for `metricCards`.
- Vektmål-forhåndsutfyllingen i `HealthGoalCreation` returnerte alltid tom streng, fordi
  `ThemeGoalsTab` aldri fikk `healthDashboard`.

`health-data.ts` gikk fra 879 til 437 linjer og fikk sin første testfil. To ulike
komponenter het `BalanceCard` med disjunkte prop-sett — ikke duplikater, så de ble
omdøpt (`LoadBalanceCard` = TSB, `TrainingMixCard` = disiplin-miks) i stedet for slått
sammen. `ThemeDataTab` hadde tre parallelle if/else-kjeder over dashboardtype; erstattet
med ett `Record<DashboardKind, unknown>`-kart.

Netto: −973 linjer.

### Fase 1: Navnematching og hierarki-fundament

Fire nye `DashboardKind`: `training`, `sleep`, `screentime`, `nutrition`.

**Kritisk funn:** `normalize('NFD')` dekomponerer «å» til «a», men **«ø» og «æ» har ingen
kanonisk dekomponering**. Termene `'sovn'` og `'loping'` i `theme-hues.ts` kunne derfor
aldri matche «Søvn» og «Løping» — død kode siden filen ble skrevet. Alle termer skrives
nå med norske tegn, gjerne i begge varianter.

Nye hjelpere i `server/themes.ts`: `getChildThemes`, `findThemeByName`,
`findHealthThemeId`, `getHealthThemeIds`. Hjem-dashboardet bruker nå den delte
`getChildThemes`.

### Fase 2: Delte lastere og endepunkter

`training-dashboard.ts`, `screentime-dashboard.ts`, `sleep-dashboard.ts`,
`nutrition-dashboard.ts` + fire endepunkter med kind-vakt.

`/trening`s tre form-actions flyttet til `/api/tracks/*`, fordi ruten skulle bli en
redirect og en redirect ikke kan ta imot POST.

### Fase 3+4: Oversiktsflate, undertema-dashboards og provisjonering

Slått sammen fordi undertema-stripen ellers ville vist fem «Aktiver»-fliser mot et
endepunkt som ikke fantes.

Mor-flaten: undertema-stripe → «Sammenhenger» → readiness (form/balanse) → program →
widgets → kollapset periodetabell → kildelinje.

Detaljene flyttet ned: aktivitetslista (838 l), effort→vekt, hendelsesdumpen og
skjermtid-teaseren.

### Fase 5: Redirects og opprydding

`/trening` og `/skjermtid` er 302-redirects til det navnebaserte URL-et.

## Beslutninger

**`parentTheme` forblir fritekst, ikke en FK.** Kolonnen leses som streng i minst seks
stier som ikke har temaraden tilgjengelig (`getFlowsByTheme`, `isEgenfrekvensThemeName`,
settings-gruppering, LLM-prompt-serialisering, to triage-endepunkter). Et uuid-felt måtte
joines opp til navn i hver. Problemet uuid løser — rename av forelderen — finnes ikke:
det er ingen rename-sti i koden. `health-subthemes.ts` er eneste kilde for navnene, så et
framtidig bytte blir én-fils-arbeid.

**Matcher-rekkefølgen er betydningsbærende** og dokumentert i registeret:

- `egenfrekvens` står FØRST. «psykisk helse» og «mental helse» inneholder ordet «helse»,
  som matcher som delstreng, så de rutet tidligere til helsedashboardet — egenfrekvens-
  termene var i praksis uoppnåelige. Rettet her.
- `health` står før training/sleep/screentime, slik at «Helse og trening» beholder
  mordashboardet.
- `nutrition` står ETTER food, ellers ville «Mat og ernæring» mistet ukemeny og lager.
- `aktivitet` blir bevisst liggende på health. Flyttet til training ville den fanget
  «Barnas aktiviteter» og «Fritidsaktiviteter» som delstreng.

**Tersklene bor på mortemaet.** `themes.metricSettings` er én jsonb på Helse-raden.
Undertema-lasterne leser den derfra i stedet for å ha sin egen tomme kopi — ellers ville
Søvn stille falt til default 7,5 t.

**Effort→vekt hører til Trening, ikke Ernæring.** Bruker avgjorde: effort → effekt er
trening. Konsekvensen er at Ernæring er en lett skalflate til en datakilde finnes —
ingenting logger inntak eller makroer i dag.

**Redirects går til navnebasert URL, ikke uuid.** `usage-summary.ts` normaliserer
UUID-segmenter til `[id]`, så en redirect til uuid ville slått alle seks helse-temaene
sammen til én bøtte i bruksstatistikken. 302, aldri 301/308: målet er per bruker, og en
permanent redirect ville blitt cachet og sendt neste bruker til feil tema.

**Fem nye tema legger seg flatt i hjemskjermens tema-pager.** Bevisst valg av bruker —
rekkefølgen justeres i langpress-lista.

## Sideeffekter og rettelser underveis

- **`/api/health/weight-onboarding` svarte alltid 401.** `/api/health` er prefiksmatch i
  `PUBLIC_API_PREFIXES`, og `requestUserHandle` hopper over public stier, så
  `locals.userId` ble aldri satt. Vekt-onboarding-flyten feilet stille. Flyttet til
  `/api/helse/vekt-onboarding`. `/api/health/weight-series` hadde samme rotårsak og ble
  ryddet i `2026-08-02-api-health-eksakt-match.md`, som også lukket selve fella.
- **`manage_theme` hadde en hard enum** for `parentTheme` som utelot «Hjem» og «Familie»
  — de to mortemaene som faktisk fantes — og blokkerte AI-en fra å opprette
  hus-prosjekter og ferier.
- **`domain_signals` ble lest med N+1** (én `findFirst` per kontrakt). Erstattet med én
  `DISTINCT ON`-spørring.
- **`EGENFREKVENS_THEME_NAME_TRIGGERS` manglet ordet «egenfrekvens»**, så temaet ble bare
  gjenkjent via `parentTheme === 'Egenfrekvens'`. Ville brutt sjekkin-aktiveringen ved
  re-foreldring.
- **`theme-hues` hadde en delstreng-felle:** termen `'ro'` matchet «Kropp». Lagt inn
  ordgrense for termer under fire tegn.
- **Cache-prefikset bumpet til v4** med opprydding av v3-nøkler.

## Etterspill: mor-dashboardet var brukket i prod

Rett etter merge feilet Oversikt-fanen på `/tema/helse` med «Kunne ikke laste
dashboarddata.» for alle brukere. Årsak: `signal-reader.ts` itererte resultatet fra
`db.execute(sql\`…\`)` direkte. Neon HTTP-driveren returnerer et resultat-*objekt*, ikke
en array, så `for…of` kastet «is not iterable» og endepunktet svarte 500.

Repoet hadde allerede `rowsOf()` i `$lib/db` for nøyaktig dette, med en docstring som
advarer ordrett mot feilen. Alle andre rå-SQL-lesere bruker den. Konvensjonen sto bare i
docstringen — ikke i CLAUDE.md — og det var nok til at den ble oversett. Nå står den i
CLAUDE.md under «Database-konvensjoner», og `rowsOf` har egne tester.

Tre ting ble rettet i samme runde:

1. `signal-reader.ts` bruker `rowsOf()`. Rad-mappingen er trukket ut til `mapSignalRow`
   og testet, siden numeric kommer som streng og timestamp som Date eller streng
   avhengig av driver.
2. `loadHealthOverview` er pakket i `catch` som degraderer til
   `{ subthemes: [], signals: [] }`. Undertema-stripen og signalene er en berikelse av
   flaten — en feil der skal koste en seksjon, ikke hele fanen.
3. `ensureHealthSubthemes` fikk tidlig retur. Den kjørte fem `ensureThemeForUser` ved
   hver lasting av mor-dashboardet, og `ensureThemeForUser` gjør en ubetinget `UPDATE`
   når temaet finnes — altså ti sekvensielle rundturer og fem row-writes per
   sidevisning. Nå: to spørringer, ingen skriving, når alt er på plass.

**Lærdommen:** enhetssuiten kan strukturelt ikke se driver-formfeil, fordi vi bevisst
ikke mocker databasen. For endringer som rører rå SQL er et faktisk kall mot en database
den eneste verifiseringen som teller.

## Andre runde: perioder fram, treningsbelastning ned

Etter at flaten var i bruk kom to justeringer fra bruker: **Helse skal ha større
fokus på perioder-modulen**, og **trening → vekt-effekt hører til Trening**.

- **Perioder er ikke lenger kollapset.** Periodetabellen lå i en `<details>` bak
  «Perioder — alle metrikker». Den er nå flatens hovedinnhold, rett under
  periode-pillene som styrer den. Det er der vekt, løp, effort, søvn og puls står
  side om side i samme periode — altså der sammenhengene faktisk er lesbare, som
  var hele poenget med mortemaet.
- **Form (CTL/ATL/TSB) og belastningsbalanse flyttet til Trening.**
  `HealthEffortSection` het så og bodde på mor; den er nå
  `training/TrainingLoadSection` og står sammen med `EffortWeightCard` og
  `EffortBudgetCard`s vektterskel-linje. All trening → effekt-lesning på ett sted.
  Mortemaet beholder signalet «Trening mot vektterskel» — signalet *er*
  sammenhengen, og sammenhenger er mors jobb.
- **`dailyEffort` flyttet med kortene.** Den daglige effort-serien (400 rader) var
  bare der for form/balanse, så spørringen ligger nå i `training-dashboard`.
  Mappingen er trukket ut til `$lib/domain/health/daily-effort` og testet, fordi
  rekkefølgen er lett å ta feil av: spørringen sorterer nyeste først, men
  `computeTrainingLoad` krever kronologisk.

Ryddet i samme runde: `variant`-propen på belastningsseksjonen tok med
`WeeklyEffortCard` i 'full'-grenen, men hadde ikke hatt et kallsted siden fase 3 —
Helse sendte alltid `readiness`. Grenen er borte, og med den også
`computeEffortPeriodRange` og `aggregateEffortForPeriod`, som etterpå bare ble
holdt i live av sine egne tester. Kortet er fortsatt demonstrert i `/design`.
`activities`-propen på `HealthDashboard` var død på samme måte.

### Regresjon funnet og rettet: målberegningene

Splitten fjernet `recentEvents` (500 rå hendelser) fra helse-payloaden og la dumpen
på Trening. Men Mål-fanen leser enkelthendelser: `ThemeDataTab.goalDelta` regner
delta for `weight_change` og `running_distance`, og `HealthGoalCreation`
forhåndsutfyller siste veiing. Begge brukte `healthDashboard?.recentEvents`, feltet
var valgfritt i typen — så de falt **stille til null** i stedet for å feile. Vektmål
har vist tomt startfelt og målkort har manglet delta siden merget.

Rettet ved å hente hendelsene tilbake, men smalt: bare `weight` og `workout`, 400
rader, og med en docstring som sier hva de er til for. Hendelsesdumpen til visning
blir liggende på Trening.

Samme feilklasse som `/api/health/weight-onboarding`: et valgfritt felt som aldri
kommer, og optional chaining som gjør stillheten total.

## Verifisering

- `npm run check`: 0 feil, 0 advarsler.
- `npm test`: 1914 tester grønne (fra 1802 ved start), 112 nye.
- `vite build`: grønn — bekrefter at `import type` fra `$lib/server` i `dashboard-cache`
  ikke drar serverkode inn i klientbundelen.

**Gjenstår (krever DB + nettleser, ikke tilgjengelig i agentmiljøet):**

1. `npm run db:sync` mot dev-DB, slik at undertemaene finnes for Playwright-brukeren.
   Uten dette gir `/tema/søvn` 404 og baselinene blir feilsider.
2. `npm run test:visual:update` for de fem nye sidene, deretter
   `VISUAL_REVIEW_CONTEXT="Helse blir mortema: undertema-stripe, signaler og readiness erstatter aktivitetsliste, effort→vekt og hendelsesdump" npm run test:visual:review`.
   Baselines som endrer seg: `tema-helse` (begge specs), `hjem` (fem nye tema i
   tema-sonen), `design-dashboardkort` (to nye demoer).
3. Manuell røyktest: `/trening` og `/skjermtid` redirecter, undertema-stripen viser fem
   kort, «Aktiver» oppretter manglende undertema, og vekt-onboarding-flyten fullfører
   uten 401.
