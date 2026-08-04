# Ernæringshistorikk: gårsdagens mat, og inn/ut over tid

Dato: 2026-08-04
Status: ferdig

## Kontekst

Brukeren spurte om to ting:

> «Kan jeg se gårsdagens mat? Hva med historikk over kalorier inn/ut som søyler og
> med vekt som overlay?»

Ernæringsflaten viste bare **i dag**. Alt som ble logget i går var utilgjengelig — også
for retting, som er det som gjør mangelen dyr: man oppdager sjelden at et måltid mangler
samme dag, man oppdager det dagen etter. Chatten hadde samme hull: `query_nutrition`
med `queryType: 'recent'` ga kcal og protein per dag, men aldri *hva* som ble spist, så
«hva spiste jeg i går» kunne bare besvares med «1 910 kcal over tre måltider».

## Faser

### Fase 1: Serien bak historikken

`src/lib/domain/nutrition/history-series.ts` *(ny)* med `buildHistorySeries`,
`weightPointsForChart`, `weightSegments` og `MAX_WEIGHT_GAP_DAYS`. 14 tester i
`history-series.test.ts`.

To valg bærer modulen:

**Hull er data.** Dager uten logg får `intakeKcal: null`, ikke 0. En dag man glemte å
logge er ikke en dag man ikke spiste, og en null-søyle ville sett ut som faste. Samme
for vekt.

**Linja brytes over lange hull.** Vekta måles ikke daglig, så å bryte linja ved hvert
hull ville gjort den til løse prikker. Men en rett strek over ti dager *påstår* en jevn
utvikling ingen har målt — særlig i den ene retningen man håper på. `weightSegments`
holder sammen målinger innen tre dager og bryter forbi det.

### Fase 2: Serverdata

`src/lib/server/nutrition-dashboard.ts`:

- `loadTodayWorkouts` → `loadWorkoutsByDay(userId, fromKey, toKey)`, gruppert på
  Oslo-dato. Én spørring for hele vinduet framfor fjorten.
- `averageWeightByDate` — snitt av dagens målinger, ikke siste. Går man på vekta både
  morgen og kveld skiller de to gjerne et kilo, og «siste» ville gjort en kveldsmåling
  til dagens vekt.
- `expenditureSource` og per-dag-forbruk. `HISTORY_DAYS = 14`.

### Fase 3: Flaten

- `EnergyHistoryChart.svelte` *(ny)* — søyler for inn/ut over en vektlinje, samme
  datoakse.
- `NutritionHistory.svelte` *(ny)* — dag for dag, nyeste først, i går åpen. Radene er
  samme `NutritionEntryRow` som dagskortet, så retting og sletting virker likt uansett
  hvilken dag måltidet ligger på.
- Begge koblet inn i `NutritionDashboard.svelte`.

### Fase 4: Chatten

`query-nutrition.ts`: `recent` returnerer nå `entries` per dag med klokkeslett, navn,
kcal, protein og slot. Verktøybeskrivelsen sier eksplisitt at den skal brukes på «hva
spiste jeg i går».

## Beslutninger

### Ikke overlay med to akser — to felt over samme datoakse

Dette er det ene stedet arbeidet avviker fra det som ble bedt om, og det er bevisst.

Vekt (~82 kg) og energi (~2 500 kcal) har ingen felles skala. En overlay krever to
y-akser, og da bestemmer **valget av skala** hvilken av kurvene som ser ut å lede: man
kan få vekta til å «forklare» underskuddet eller motsi det ved å endre et tall ingen
ser. På en flate som allerede har brukt to runder på å rette opp forbrukstall som ikke
tålte etterprøving, er det den gale sjansen å ta.

Løsningen er to felt over hverandre med samme datoakse. Man skanner nedover en dato og
ser begge, uten at en skala har valgt en fortelling. Prisen er noen piksler høyde.

### Én forbrukskilde for hele serien

Forbruket kan komme fra vårt eget anslag eller fra Withings, og de to er ikke enige.
Blandet i samme serie ville et kildebytte midt i vinduet sett ut som en endring i
forbruket. Serien velger **én** kilde — vårt eget når kroppsprofilen holder, siden det
er tallet energibalansekortet rett over leder med — og bunnteksten sier hvilken.

### Vekta er siste måling for hele vinduet

Mifflin-St Jeor flytter seg 10 kcal per kilo, så en kilos variasjon over fjorten dager
er under støygulvet. Alternativet — vekt per dag — ville krevd interpolering over
dagene uten måling, altså å oppfinne målinger for å gjøre et anslag marginalt
skarpere.

### Siste dag merkes, ikke skjules

`partial` på `HistoryDay`. I dag er inntaket «så langt» mens forbruket er for hele
døgnet, så de to søylene er ikke sammenlignbare med hverandre — samme feil `frameDay`
retter i dagskortet, nå i søyleform. Kolonnen dempes og bunnteksten sier det.

### Måltidene kronologisk innenfor en dag

Dagene er nyeste først, men loggen kommer også nyeste først, og en dag som begynner med
kveldsmaten leses baklengs. `NutritionHistory` sorterer stigende innenfor dagen.

## Verifisering

- `npm run check`: 0 feil.
- `npm test`: 186 filer, 2398 tester grønne (14 nye i `history-series.test.ts`).
- Mot lokal Postgres med seedet logg, i Chromium på 390 px:
  - `GET /api/tema/<id>/dashboard/nutrition` ga `expenditureSource: 'own'`, fjorten
    dagsrader med `intakeKcal: null` der loggen manglet, og `partial: true` bare på
    2026-08-04.
  - Grafen tegnet søylepar, brutt vektlinje og datoakse uten konsollfeil. Dagene uten
    logg viste stubbe framfor null-søyle.
  - Lista viste «I går» (åpen), «I forgårs», «Lørdag 1. august», «Torsdag 30. juli».
    Klikk lukket i går og åpnet 30. juli; `aria-expanded` fulgte med.
- Fargene `#3987e5` (spist) og `#d95926` (forbrent) validert mot `#141414`: ΔE 31,8 for
  normalt syn og 26,8 for deuteranopi.

## Gjenstår

De visuelle baselinene er fortsatt utdaterte fra mortema-arbeidet — Chromium i dette
miljøet er build 1194 mot `@playwright/test`s forventede 1223, så *hver* seksjon
avviker og en oppdatering herfra ville skrevet feil baselines. `dashboardkort`,
`sheet-metrikk-innstillinger` og mortema-bildene må regenereres på brukerens maskin, nå
også med ernæringsflaten.
