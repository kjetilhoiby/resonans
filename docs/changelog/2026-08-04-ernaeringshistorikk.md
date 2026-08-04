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

Første utgave la vekta i et **eget felt under** søylene framfor som overlay, for å
unngå to y-akser. Brukeren ba deretter eksplisitt om to akser: «Jeg vil ha to y-akser
for å sammenlikne trender.» Det er bygget, og fase 5 under beskriver hva som holder
skalaen ærlig.

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

- `EnergyHistoryChart.svelte` *(ny)* — søyler for inn/ut med vekta som overlay.
- `NutritionHistory.svelte` *(ny)* — dag for dag, nyeste først, i går åpen. Radene er
  samme `NutritionEntryRow` som dagskortet, så retting og sletting virker likt uansett
  hvilken dag måltidet ligger på.
- Begge koblet inn i `NutritionDashboard.svelte`.

### Fase 4: Chatten

`query-nutrition.ts`: `recent` returnerer nå `entries` per dag med klokkeslett, navn,
kcal, protein og slot. Verktøybeskrivelsen sier eksplisitt at den skal brukes på «hva
spiste jeg i går».

### Fase 5: To y-akser

`weightAxisForOverlay` og `MIN_WEIGHT_AXIS_SPAN_KG` i `history-series.ts`; `plot`-gridet
i `EnergyHistoryChart.svelte` med kcal til venstre, kg til høyre, felles rutenett og
datoakse. `weightPointsForChart` og `weightSegments` tar nå en valgfri akse, slik at
serien ikke bestemmer sin egen skala.

## Beslutninger

### Overlay med to y-akser, med et gulv på vektaksen

Faren ved to y-akser er reell: vekt (~82 kg) og energi (~2 500 kcal) har ingen felles
skala, så skalavalget avgjør hvilken kurve som ser ut å lede. Første utgave løste det
ved å nekte — to felt over samme datoakse. Brukeren ba om aksene likevel, for å kunne
sammenligne trender, og det er den riktige avveiningen å overlate til den som leser
grafen hver dag.

Det som gjør skalaen etterprøvbar er `MIN_WEIGHT_AXIS_SPAN_KG = 1`: vektaksen er alltid
minst ett kilo høy. **Det er den mekanismen som ellers gjør dobbeltakser upålitelige** —
en akse som strekkes til de målte ytterpunktene forvandler 100 gram til et stup. Ett
kilo fordi det er omtrent døgnvariasjonen fra vann og fordøyelse; under det er det ikke
en utvikling å lese. Ellers er spennet målingene pluss 25 % luft, rundet ut til halve
kilo. Ingen del av regelen settes per graf.

Bunnteksten sier at aksene er uavhengige, at man skal sammenligne *formen* på kurvene,
og hvor mye vekta faktisk beveget seg.

### Forkastet: å binde aksene fysisk med 7 700 kcal per kilo

Første forsøk på å svare på skalainnvendingen var å låse aksene til hverandre — 1 kg på
vektaksen = 7 700 kcal på energiaksen — slik at stigningstallene skulle bli
sammenlignbare. Det ble bygget, testet og så forkastet, av to grunner som er verdt å
skrive ned så ingen prøver igjen:

1. **Dimensjonene stemmer ikke.** Vektendring er kumulativ; søylene viser daglige
   nivåer. Å legge dem på samme vertikale skala sammenligner ikke to stigningstall, det
   sammenligner to ulike størrelser.
2. **Spennet blir for trangt.** Med et 3 500 kcal-tak blir det låste spennet 0,45 kg.
   Normal døgnvariasjon fra vann sprenger det nesten hver uke, så koblingen ville vært
   brutt nesten alltid — og en akse som stille skifter regel er verre enn en åpen regel.

Det tallfestede oppgjøret mellom energibalanse og vekt finnes allerede i
`checkAgainstWeight`, som energibalansekortet rett over grafen viser. Grafen trenger
ikke gjøre det om igjen med geometri.

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
- `npm test`: 186 filer, 2404 tester grønne (22 nye i `history-series.test.ts`).
- Mot lokal Postgres med seedet logg, i Chromium på 390 px:
  - `GET /api/tema/<id>/dashboard/nutrition` ga `expenditureSource: 'own'`, fjorten
    dagsrader med `intakeKcal: null` der loggen manglet, og `partial: true` bare på
    2026-08-04.
  - Grafen tegnet søylepar, vektlinje over søylene, begge y-aksene (0–3 500 kcal og
    81,0–82,5 kg) på felles rutenett, og datoakse justert mot søylene — uten
    konsollfeil. Dagene uten logg viste stubbe framfor null-søyle.
  - Med et vektspenn på 0,5 kg slo gulvet inn: aksen ble 1,5 kg høy og kurven brukte en
    tredel av feltet framfor hele.
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
