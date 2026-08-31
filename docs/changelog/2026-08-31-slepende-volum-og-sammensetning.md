# Slepende volum, «i rute», og sonesammensetning

Dato: 2026-08-31
Status: ferdig

## Kontekst

Brukeren har en widget på hjemskjermen som viser «løpt siste 30 dager», og ba om
tre ting:

1. En graf bak widgeten: akkumulert løping siste 30 dager **over tid**, altså et
   slepende vindu per dag.
2. En meningsfylt foran/bak-indikator, så det er lett å se om han er i rute.
3. Kvalitet over tid: sammensetningen av pulssoner, slik at treningen ikke blir
   «dritten i midten» — mye rolig, noe hardt, lite i mellomrommet.

## Faser

### Fase 0: En tredje sonemodell som ble stående

Sonekonsolideringen 30. august tok to modeller (serverens HRR og Ekkos
%makspuls). Den misset en tredje: `DEFAULT_HR_BANDS` i `src/lib/utils/track-stats.ts`.

```
Rolig 0–120 · Lett 120–140 · Moderat 140–160 · Hard 160–180 · Maks 180+
```

Hardkodede absolutte slag, like for alle uansett maks- og hvilepuls — og med **de
samme norske ordene** som sonemodellen. Med maks 180 og hvile 50 var puls 135
«Lett» på øktdetaljen og «Rolig» (sone 2) i sonekortet ved siden av. Den ble
stående fordi den ikke het noe med «zone» og ikke lå i helse-domenet; et søk på
`HeartRateZone` fant den ikke.

Erstattet av `hrBandsFromBaseline`, som regner båndene av brukerens egen
baseline. `computeHrDistribution` har ingen default lenger — en default her var en
sonemodell ingen visste at de brukte.

To feil ble funnet i samme runde:

- **Z1 må starte på 0, ikke på hvilepulsen.** `computeHrDistribution` bryter på
  første treff og har ingen oppsamling, så en puls under hvilepuls falt ut av
  ALLE bånd og stille ut av totalen. Det skjer hver gang man står i ro.
- **`maxBpm` er eksklusiv**, så etiketten må vise `maxBpm - 1`. Ellers sto sone 2
  som «128–141» der coachen leser «128 til 140» høyt.

Filer: `src/lib/utils/track-stats.ts`, `HrDistributionBar.svelte`,
`routes/aktivitet/[id]/+page.server.ts` og `+page.svelte`,
`HealthActivityList.svelte`, `TrainingDashboard.svelte`, `training-dashboard.ts`.

### Fase 1: Slepende volum (`trailing-volume.ts`)

`buildTrailingSeries` regner summen av de siste N dagene for hver dag, fra de
per-dag-verdiene `loadRunningHistory` alt returnerte.

Kurven er **bedre enn den kumulative** `CycleChart` tegner: den nullstilles ikke
1. januar, så «er jeg i form nå» kan leses av hver dag i året.

Med i modulen: kvartilbånd for samme tid på året (`trailingBandForDate`), rampen
mot forrige ikke-overlappende vindu (`trailingRamp`), nivået mot mål eller bånd
(`levelAgainstReference`), og setningen flatene deler (`describeTrailingVolume`).

### Fase 2: Øktkarakter (`session-character.ts`)

Klassifiserer hver økt som rolig, grå eller hard fra `hrZoneDistribution`, og
fordeler **økter** — ikke minutter.

### Fase 3: Server, flate og chat

`loadVolumeAndQuality` er én laster for tre flater: trenings-dashboardet,
widgetdetaljen (`GET /api/helse/trening/volum`) og `query_training` med
queryType `trailing` og `quality`.

Widgetklikket åpner nå `TrailingVolumeSheet` framfor å navigere til
Helse-temaet — det er hva `navigateForWidget` gjorde, og det svarte på et annet
spørsmål enn det man har foran widgeten. Samme begrunnelse som streak-kortet
allerede hadde.

## Beslutninger

**Tid-i-sone finner ikke «dritten i midten».** Dette er den bærende innsikten.
`hrZoneDistribution` er andel av tid *innad i* én økt, og hver hard økt bærer
oppvarming, pauser og nedjogg i de lave sonene:

| Økt | Z1–2 | Z3 | Z4–5 |
|---|---|---|---|
| Skikkelig intervalløkt | 75 % | 10 % | 15 % |
| Grå 50-minutter i moderat | 30 % | 65 % | 5 % |

Summerer man minuttene over en måned, kommer begge ut som «mest rolig». 80/20
telles konvensjonelt på ØKTER nettopp derfor: det er øktens karakter som er
stimulusen. Så: klassifiser først, fordel etterpå.

**Hard-terskelen kunne IKKE deles med EF-trenden.** Første utgave satte
`HARD_ZONE45_SHARE = MAX_HARD_SHARE` (0,25) med begrunnelsen «to terskler ville
drevet fra hverandre». En test avslørte at de svarer på ulike spørsmål:
`MAX_HARD_SHARE` holder økter UTE av EF-trenden, og der er en høy, konservativ
terskel riktig. Som klassifiserer er 0,25 alt for høyt — en ekte intervalløkt
ligger på 10–20 % av tida i sone 4–5, så en økt med 4×4 minutter hardt ble
stemplet **rolig**. Nå 0,08 pluss et absolutt krav på fire minutter.

**Ufullstendige vinduer er `null`, aldri 0.** De første N−1 dagene har ikke et
helt vindu. Med 0 der ville kurven startet på bunnen og klatret i en måned — en
oppbygging som aldri skjedde, og den ser helt ekte ut.

**Båndet er kvartiler av TIDLIGERE år.** Min/maks er definert av skader og
formtopper. Og inneværende år er det vi måler MOT: lå det i båndet, ville en tung
sesong hevet båndet og skjult seg selv.

**Rampen er ikke et helsevarsel, og bygger ingen andre «for mye»-dom.** Volum og
belastning er to ting; akutt/kronisk i formkurven er den eneste dommen som får
varselfarge (`effort-standing.ts`). Rampen sier «rask oppbygging» og viser til
formkurven. En test vakter at ordet «overtren» ikke finnes i setningen.

**Målet vinner over båndet, og gjelder bare sitt eget vindu.** Et mål på «120 km
per 30 dager» sier ingenting om syv dager, og å skalere det til 28 km ville vært
en påstand brukeren ikke har gjort.

**Et slepende mål trenger ingen pacing.** Et kalendermål må sammenlignes med hvor
langt ut i måneden man er — hele `goal-projection.ts`. Et slepende mål er direkte
sammenlignbart hver dag.

**Dekningen rapporteres, den skjules ikke.** Sonefordeling krever pulskurve per
økt. Under 50 % dekning eller fem klassifiserte økter nekter
`describeComposition` å oppgi andeler. Samme regel som `socialFilterable` i
skjermtid: skill «0 vi målte» fra «0 vi ikke målte».

**Andelene regnes av de klassifiserte øktene**, ikke av alle. En nevner som
inkluderte de ukjente ville fått alle tre bøttene til å krympe når dekningen
falt — og det leses som en endring i treningen.

**Klassifiseringen er en proxy, og skal si det.** Polarisert trening er definert
av laktatterskler vi ikke måler. Det ærlige utfallet er «grå er din største
bøtte», ikke «du er 68/22/10».

## Verifisering

- `npm test`: 4054 tester i 284 filer — grønt (49 nye).
- `npm run check`: 0 feil, 0 advarsler.
- Testen som fant hard-terskel-feilen står igjen som regresjonsvakt: en
  intervalløkt med 15 % i sone 4–5 SKAL bli «hard».
- Vakt på at rampesetningen aldri sier «overtren».
- Vakt på at `describeComposition` ikke oppgir prosenter på tynn dekning.
- Nye ord i `detectPromptFocusModules` med test, og to bevisste utelatelser
  («midten», «grå») med begrunnelse.

## Kjent rest

- **Dekningen er ikke målt mot prod.** Det var steg 1 i planen, men denne
  sesjonen har ingen databasetilgang. `zoneCoverage` i payloaden svarer på det i
  drift; er andelen lav, er `POST /api/sensors/workouts/reanalyze` neste steg
  framfor mer flate.
- Båndet tegnes som et vannrett felt, siden det gjelder dagens dato. Et bånd per
  punkt ville krevd at det ble regnet for hver dag i kurven.
- Bare løping. `loadVolumeAndQuality` tar en `sportFamily`, så sykkel og ski er
  en parameter unna, men ingen flate ber om dem ennå.
- Widgetdetaljen finnes bare for distanse i km. Andre metrikker beholder
  navigeringen framfor å få et halvtomt panel.
