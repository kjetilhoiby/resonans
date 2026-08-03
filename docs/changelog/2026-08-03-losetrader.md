# Løse tråder: HRV, stigningsjustert VDOT, uuid-vakt og en låst header

Dato: 2026-08-03
Status: ferdig

## Kontekst

Etter HRR-arbeidet ble det gjort opp status over hva som faktisk sto igjen i
helsedomenet. Fire ting lot seg verifisere framfor å gjettes, og alle fire var
reelle. De henger ikke sammen tematisk, men de var alle billige og hver av dem
hadde en konkret kostnad.

## Faser

### 1. HRV ble hentet og kastet

`backfillSleepHrForDate` har bedt Withings om `data_fields: 'hr,sdnn_1'` siden
feltet ble lagt inn — men løkka under leser bare `seg.hr`. Dataen har vært betalt
for i hvert kall og sluppet på gulvet.

`sdnn_1` er fjernet fra det kallet, og HRV har fått en eier som lagrer den:
`syncSleepHrv` i `server/integrations/withings-sleep-hrv.ts`.

**HRV ligger ikke i `getsummary`.** Den finnes bare i `action=get`, som gir
minutt-for-minutt-serier og må kalles per dato. Derfor et eget steg, med samme
selvhelende takstyring som `syncHrRecovery`: netter som alt har HRV hoppes over før
noe nettverk røres, fem kall per kjøring, nyeste natt først, og det som utsettes
logges.

**Retningen er motsatt av VO2max og pulsfall, og det er hele poenget med modulen.**
Der er *beste* observasjon riktig, fordi begge forutsetter at du presset — en rolig
tur gir et lavt tall som ikke betyr noe. HRV måles i søvn hver natt uten at du gjør
noe, og svarer på hvordan det står til *nå*. «Beste HRV siste åtte uker» ville vært
et ubrukelig tall.

**Absoluttverdien vises aldri alene.** SDNN varierer så mye mellom folk at 20 ms kan
være normalt for én og et varsel for en annen, og det finnes ingen normtabell å
plassere folk i slik det gjør for oksygenopptak. Bare avviket fra egen baseline
betyr noe, så `pickHrvMetric` krever sju netter før den regner et avvik, og kortet
sier «bygger baseline — 3 av 7 netter» framfor å konkludere.

To detaljer som ville gitt feil tall:

- **Median, ikke snitt, innenfor natta.** Ett minutt med dårlig sensorfeste ga
  ellers utslag: 40, 41, 42, 43, 250 har snitt 83 og median 42.
- **Nattnøkkelen er datoen du våkner** (`nightKeyForTime`), samme konvensjon som
  `buildSleepNightSeries`. Uten det ville HRV-nettene ligget en dag forskjøvet fra
  nattlengdene de skal sammenlignes med.

`metrics.hrv` i aggregatene er periodemedianen. Avviket mot baseline hører ikke dit
— det er et rullende tall, og en aggregatrad beskriver én periode.

### 2. Pust og snorking sto én linje unna

`apnea_hypopnea_index`, `breathing_disturbances_intensity`, `snoring` og
`snoringepisodecount` er `getsummary`-felter vi aldri ba om. Nå med i
`WITHINGS_SLEEP_DATA_FIELDS`, som fortsatt har fallback til det historiske
feltsettet. Vises under HRV-kortet, flagget over fem pustestopp i timen (klinisk
grense for mild apné). Vi tolker ingenting medisinsk av det.

### 3. VDOT tok ikke hensyn til terrenget

`gapSecPerKm` — stigningsjustert pace — har ligget på `canonical_workouts` uten at
VO2max-stien brukte den, mens den leste rå `bestEfforts`-sekunder. Det er en målbar
feilkilde: løpeturen 1. august stiger på siste kilometer, og en «beste 3k» derfra er
tregere enn formen tilsier.

`estimateVdotFromBestEfforts` tar nå en valgfri `GradeAdjustment` og skalerer
øktetiden med forholdet mellom justert og rå snittpace. Vi kjenner ikke stigningen
for nettopp det 3k-strekket, bare for økta som helhet, så det er grovt — men riktig
retning, og bedre enn å late som terrenget var flatt.

Justeringen begrenses til ±20 %. Utenfor det er det mer sannsynlig at høydedataen
eller distansen er feil enn at terrenget var så ekstremt, og en ukritisk skalering
ville gjort et dårlig tall verre.

Dette lukker **én** av de to feilkildene bak avviket i
`2026-08-03-vo2max.md`. Den andre — at VDOT antar maksimal innsats og brukeren ikke
racer — står igjen, og kan ikke fikses med matematikk.

### 4. 37 endepunkter svarte 500 der svaret var 404

`eq(themes.id, params.id)` mot en uuid-kolonne kaster i Postgres når segmentet ikke
er en uuid. En vakt i hver av de 37 var mye kode og lett å glemme i den 38.

En **ruteparameter-matcher** løser det i ett punkt: `src/params/uuid.ts`, og
katalogen `api/tema/[id]` er omdøpt til `api/tema/[id=uuid]`. SvelteKit svarer 404
før noen handler kjører, og alle nåværende og framtidige ruter under prefikset er
dekket.

**Bare API-rutene.** Sideruta `/tema/[id]` tar bevisst imot et navn også
(`/tema/helse`) og har sin egen uuid-sjekk i `+page.server.ts`. Alle reelle
kallsteder sender `theme.id`, så ingenting mister tilgang.

### 5. `x-resonans-user-id` var en åpen dør

`authorizationHandle` slapp gjennom enhver forespørsel som bar headeren, uten noen
hemmelighet — også mot `/api/admin/*`. Bruker-ID-en ligger dessuten i klartekst i
`playwright.config.ts`. Én header sto mellom internett og admin-endepunktene.

`$lib/server/user-header-auth.ts`:

- **Lokalt (`dev`)**: headeren godtas fritt. Det er der Playwright kjører, og en
  dev-server på localhost er ikke en angrepsflate.
- **Deployet, med `RESONANS_HEADER_SECRET` satt**: må følges av `x-resonans-secret`
  som matcher.
- **Deployet, uten variabelen**: headeren godtas som før, og at låsen ikke står på
  logges én gang per instans.

Miljøvariabelen er altså **bryteren**. Første utgave var fail *closed* — uten
variabelen ble headeren avvist — men det slo ut curl-tilgangen i samme øyeblikk
koden ble deployet, før noen hadde satt den. Valget ble derfor snudd til fail open:
prisen er at en glemt variabel gir åpen dør framfor tapt tilgang, og advarselen i
loggen er det eneste sporet av det. Å sette variabelen er hele migreringen.

Modulen leser ikke `$app/environment` selv, men får miljøet inn: de modulene finnes
ikke under vitest, og en sikkerhetsvakt som ikke kan enhetstestes er ikke verdt å
ha. `headerAuthDiagnosis` logger én linje om *hvorfor* headeren ble avvist, slik at
en glemt variabel ikke ser ut som «alt er 401» uten spor.

`user_api_secrets` er fortsatt riktig vei for langvarig maskintilgang.

### 6. Ingen visuell test åpnet et ark

Det var derfor `ThemeMetricSettingsSheet` kunne kaste på første render uten at noe
ble rødt: `fields` ble bare fylt i en `$effect`, så `bind:value={f.goal}` traff
`undefined` i det `{#if open}` rendret. Suiten så frisk ut.

Ny test i `tests/visual/pages.spec.ts` klikker tannhjulet på `/tema/helse` og
sjekker at arket blir synlig, at feltene finnes ved første render, og at ingen
`pageerror` kom. `toBeVisible()` er den viktigste linja — viktigere enn
skjermbildet, og den ville fanget nettopp den buggen.

Tannhjulet fikk samtidig `aria-label` og `data-track`. Det hadde bare `title`, så
klikket ble logget som «⚙» — nøyaktig den anonyme labelen CLAUDE.md advarer mot.

## Verifisering

- `npm run check`: 0 feil, 0 advarsler.
- `npm test`: 2263 grønne i 174 filer (fra 2226), 37 nye.
- **Ark-testen er kjørt mot en ekte database og ekte Chromium**, og passerer alle
  påstandene: arket åpner, alle sju metrikkfeltene rendrer med verdier (inkludert
  `maxHr`), ingen konsollfeil. Baselinen ble skrevet og deretter slettet — se under.

**Ikke verifisert:** de visuelle baselinene, av samme grunn som forrige runde.
Nettleseren i dette miljøet (chromium 1194) er en annen enn `@playwright/test`
forventer (1223), og *hver* design-seksjon avviker med noen piksler i høyde — også de
ingen av disse endringene rører. Baselinene for `dashboardkort` og det nye
`sheet-metrikk-innstillinger.png` må genereres på en maskin med riktig nettleser.

**Gjenstår:** `RESONANS_HEADER_SECRET` er ikke satt, så diagnoseheaderen er ulåst i
prod. Alt virker som før; loggen sier én gang per instans at låsen mangler. Sett
variabelen når det passer — ingen andre endringer trengs.
