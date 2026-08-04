# Kumulativ energi og sultskala

Dato: 2026-08-04
Status: ferdig

## Kontekst

Brukeren ba om to ting, med skrittkortet i Withings som referanse:

> «Jeg ser fortsatt for meg denne måten å si spist vs. forbrent hittil i dag, for å vise
> når gapet er stort. Hvis vi i tillegg har en knapp for sult 1-5, kan vi kanskje
> predikere sult og nudge-pushe 'ta en snack' før blodsukkeret krasjer.»

Skjermdumpen fra prod viste hvorfor det første ikke bare er en ny graf. Kl. 17:03 sto
flaten med «Spist 1 214 · Forbrent 2 742». De to tallene måler ulike ting: inntaket er
*så langt*, forbruket er et anslag for **hele døgnet**. Differansen kunne derfor aldri
handles på — den starter på sitt maksimum ved midnatt og krymper utover dagen.
`frameDay` dempet symptomet ved å bytte etikett til «Igjen i dag». En kumulativ
forbrukskurve fjerner årsaken: begge sidene blir «så langt», og gapet kl. 15 er da et
ekte gap.

## Faser

### Fase 1: Kurvene

`src/lib/domain/nutrition/intraday-energy.ts` *(ny)* med `expenditureAtMinute`,
`intakeAtMinute`, `buildIntradayEnergy`, `osloMinuteOfDay` og `minuteLabel`. 15 tester.

`src/lib/server/nutrition/intraday.ts` *(ny)* — `loadIntradayEnergy`, delt av flaten,
sultendepunktet og nudgen. Tre kallsteder må være enige om gapet; ellers kunne en nudge
fyrt på et tall flaten aldri viste.

`IntradayEnergyChart.svelte` *(ny)*.

### Fase 2: Sultskalaen

`src/lib/domain/nutrition/hunger.ts` *(ny)* med `predictHunger`, `typicalHungerHour`,
tersklene og etikettene. 12 tester.

`src/lib/server/nutrition/hunger-log.ts` *(ny)*, `POST/GET /api/helse/ernaering/sult`,
og `HungerScale.svelte` *(ny)*.

### Fase 3: Nudgen som kommer først

`decideFuelNudge` fikk varianten `predicted-hunger` som **høyeste** prioritet, over
trent-men-underspist. 6 nye tester.

### Fase 4: To feil funnet underveis

Se «Feil funnet» under.

## Beslutninger

### Forbrukskurven er modellert, og flaten sier det

Vi kjenner døgnanslaget, ikke fordelingen utover dagen. Modellen er tre ledd:

1. **Hvilestoffskiftet** jevnt over døgnet — det brenner mens du sover.
2. **Kontorpåslaget** (`baselineKcal − basalKcal`) bare over våken tid (07–23). Dette er
   leddet som betyr noe: legger man det jevnt utover, har man «forbrent» en femtedel av
   dagens bevegelse kl. 05 mens man sov.
3. **Øktene** der de faktisk skjedde.

Withings' intraday kunne gitt en målt kurve. Døgnanslaget vårt kan ikke, og et modellert
tall som presenteres som målt er verre enn et ærlig anslag.

### Inntaket projiseres ikke

Forbrukskurven fortsetter stiplet til midnatt, fordi den er forutsigbar. Inntaket stopper
på «nå»: en flat linje ut dagen ville påstått at man ikke spiser mer.

### Ingen påstander om blodsukker — og den ærlige varianten er sterkere

Brukeren skrev «før blodsukkeret krasjer». Appen måler ikke blodsukker, så nudgen sier
det ikke. Men her er ærlighet ikke en innrømmelse: *«du ligger på 1 290 kcal gap, og der
har du meldt sterk sult tre ganger før, oftest rundt 15-tida»* er etterprøvbart for
brukeren og handler om **denne** kroppen. «Blodsukkeret krasjer snart» er en påstand vi
ikke kan innfri, og som mister troverdighet første gang den bommer.

Det er også derfor sultvarselet er høyest prioritert: det er den eneste varianten som
bygger på et signal ingen sensor kan hente.

### Modellen holder kjeft til det finnes data

`MIN_OBSERVATIONS` (5) og `MIN_HIGH_OBSERVATIONS` (2) må begge være oppfylt.
En «prediksjon» fra én måling er en gjetning med selvtillit, og første gang den bommer
slutter brukeren å svare på skalaen — da mister vi det ene signalet vi ikke kan måle oss
til. Terskelen er **medianen** av gapet ved høye meldinger, ikke snittet: én dag med
5 000 kcal gap ville ellers flyttet terskelen dit ingen dager ligger.

Varselet går på 85 % av terskelen, altså som et forvarsel framfor en konstatering.

### Sult er `dataType: 'hunger'`, ikke `'nutrition'`

Alt som leser `'nutrition'` summerer makroer. En sultmelding uten kalorier ville blitt et
måltid på 0 kcal i dagssummen — samme grunn som `sleep_disturbance` er skilt fra
`sleep`. Gapet lagres **med** meldingen: å regne det i ettertid ville krevd å
rekonstruere hvilken kroppsprofil og hvilke økter som gjaldt, og profilen kan endres.

### Gapfeltet farges etter fortegn

Én flate i forbruksfargen ville vist et *overskudd* i samme farge som et underskudd —
altså løyet om det ene grafen finnes for. Feltet bygges som én firkant per intervall,
farget etter hvilken kurve som ligger øverst. Overskriften bytter til «Over nå».

## Feil funnet

### `listIntake` filtrerte ikke på `dataType` — og sultloggen avdekket det

Sultmeldingene ligger på den eksisterende `manual`/`nutrition_log`-sensoren.
`listIntake` filtrerte på **sensor**, ikke på `dataType`, så alt annet på den sensoren
ble lest som måltider. Konsekvensen ville vært fantomdager i `groupByDay`, et kunstig
lavt `averagePerLoggedDay`, feil `loggedDays` i historikken og tomme 0 kcal-rader i
dagskortet.

Fanget fordi gapet ikke steg som forventet i en manuell test — enhetstestene kan ikke se
det, siden vi ikke mocker DB. Filteret er lagt til med en kommentar som peker på
`sleep_disturbance`-fella.

### Withings-desimaler vist ubearbeidet

Prod sto med «Withings sier 1 851,46 — 890,54 kcal under vårt». Withings leverer
desimaler, og `toLocaleString` viser dem. Alle kcal-verdier i `EnergyBalanceCard` går nå
gjennom en `kcal()`-hjelper som runder — to desimaler påstår en presisjon ingen av
anslagene har.

## Verifisering

- `npm run check`: 0 feil. `npm test`: 190 filer, 2461 tester (33 nye).
- Mot lokal Postgres, kroppsprofil 187 cm / mann / 1984 / 82 kg (hvile 1 784,
  kontorhverdag 2 230):
  - Kl. 19:04 ga kurven `forbrent=1754` mot døgnanslaget 2 230. Regnet for hånd:
    1 784/1440 × 1144 = 1 417 hvile, pluss 446/960 × 724 = 336 påslag → 1 753. Stemmer.
  - Med tre måltider lagt inn leste gapet 446 før frokost, 117 etter lunsj, 424 kl. 15
    og 125 etter middag — altså toppen midt på ettermiddagen, som er vinduet brukeren
    beskrev.
  - `POST /api/helse/ernaering/sult` med `level: 4` lagret
    `{hungerLevel:4, gapKcal:235, intakeKcal:1520, osloHour:19.08}`. `level: 9` og
    `level: 3.5` avvist.
  - Fem seedede meldinger (3 høye på 1 180/1 320/1 400) ga `thresholdKcal: 1320`,
    `typicalHour: 15`, `ready: true`.
  - Med gapet hevet over 85 % av terskelen ble `approaching: true`, og
    `/api/cron/fuel-nudge?force=1` skrev en `nudge_events`-rad med
    `kind: 'predicted-hunger'`.
- I Chromium på 390 px: grafen tegnet begge kurvene, det fargede gapfeltet, «nå»-markør
  med klokkeslett og stiplet projeksjon. En seedet overspisingsdag (4 120 spist mot
  1 766 forbrent) snudde feltet til inntaksfargen og overskriften til «Over nå 2 354».
  Sultskalaen viste fem knapper og modell-linja. Ingen konsollfeil.

## Gjenstår

- Chatten kan ikke ennå *lese* sultloggen. `query_nutrition` bør få med
  `hungerPrediction`, slik at «jeg er dritsulten» kan besvares med brukerens egen
  terskel framfor bare pacing.
- Visuelle baselines må fortsatt regenereres på brukerens maskin (Chromium 1194 mot
  forventet 1223), nå også med to nye kort på Ernæring.
