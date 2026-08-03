# Flere felter fra Withings

Dato: 2026-08-03
Status: ferdig

## Kontekst

En gjennomgang av Withings-flaten mot det vi faktisk ber om avdekket at vi lot
mye ligge — og at ett av feltene vi hentet, ble tolket feil.

## Fettmasse-buggen

Withings' måletype **6 er fettPROSENT**, type **8 er fettmasse i KG**. Parseren
leste type 6 og lagret den som `data.fatMass`, og `readBodyComposition` returnerte
den som `fatMassKg` — som `/plan/mal` bruker som nåverdi for et fettmasse-mål.

En person på 82 kg med 22 % fett fikk «22 kg fettmasse» der svaret var 18. Tallet
ser plausibelt ut, og det er grunnen til at feilen kunne stå i ro.

Rettet uten datamigrering: `normalizeBodyComposition` regner kilo fra prosenten og
vekta på samme rad, så gamle målinger blir riktige ved lesing. Verifiseringen
viste utslaget — en 55 dager gammel rad med `fatMass: 23` og vekt 83,4 gir 19,2 kg,
mot 18,0 nå, altså −1,2 kg fett. Lest som kg ville endringen blitt −5 kg fett på et
vekttap av 1,4 kg.

Nye rader skriver `fatRatio` (%) og `fatMassKg` (kg) atskilt. `fatMass` skrives
ikke lenger, og er merket `@deprecated` i schemaet.

## Hva som ble hentet

**Kroppssammensetning** — type 5 (fettfri masse), 8 (fettmasse kg), 77 (hydrering),
88 (beinmasse) i tillegg til vekt, fettprosent og muskelmasse. En smartvekt poster
alt i én måling, så de kom sannsynligvis inn allerede og ble kastet — men kallet ber
nå eksplisitt om dem via `meastypes`, slik at det ikke avhenger av om Withings
filtrerer innenfor gruppene.

Dette er grunnen til at det er verdt å hente mer enn vekt: «ned 1,4 kg» og «ned 1,4
kg hvorav 0,9 er muskel» er to helt ulike beskjeder, og vekta alene kan ikke skille
dem. `describeCompositionChange` formulerer forskjellen.

**Punktpuls** — type 11, den vekta tar hver morgen. Lagres som
`data.restingHeartRate`. Den er en langt bedre hvilepuls enn `hr_average` fra søvn,
som `getEffortBaseline` bruker i dag med et 30–80-filter som proxy. Ikke koblet inn
i baselinen ennå — det er neste steg, og det forbedrer både VO2max, effort-skåringen
og hvilepuls-signalet.

**Søvnfelter** — `sleep_latency`, `wakeup_latency`, `waso`, `out_of_bed_count`,
`sleep_efficiency`, `hr_min`, `hr_max`.

`sleep_latency` (tid brukt på å sovne) og `waso` (*wake after sleep onset*) måler
nøyaktig det den manuelle søvnloggeren fra dagen før spør om. De har vært
tilgjengelige hele tiden uten at vi har bedt om dem.

**`totalcalories`** — hvileforbrenning + aktivitet. `calories` alene er bare
aktiviteten, så uten dette hadde Ernæring bare den ene siden av energibalansen.
`getactivity` får nå en eksplisitt `data_fields`-liste.

## Beslutninger

**Manuell logging vinner over målt søvn.** `mergeDisturbances` lar de manuelle
registreringene stå for nettene de finnes, og fyller bare hullene med
Withings-utledede. Enheten måler bevegelse og puls, ikke opplevelsen — og
opplevelsen er det man handler på. Har du sagt at du ikke fikk sove, er det svaret,
også om Sleep Analyzer mener du sov fint.

**Terskel 30 minutter** for både innsovningstid og våkentid. Det er den vanlige
grensa, og under den er det normal søvn: alle bruker noen minutter på å sovne.

**Utledede innslag viser varighet, ikke klokkeslett.** Vi har bare søvnens
starttid, og for en oppvåkning vet vi ikke når den skjedde. Da vises «45 min», som
er det vi faktisk har, og et `MÅLT`-merke skiller dem fra det du registrerte selv.

**Energibalansen returnerer null når én side mangler.** Et underskudd på 2 500 kcal
fordi man glemte å logge er ikke et underskudd, og et overskudd fordi Withings ikke
har rapportert dagen er ikke et overskudd. Halve tall er verre enn ingen her. Kortet
sier dessuten at dagen ikke er omme — «underskudd» kl. 14 er meningsløst.

**Nye feltsett har fallback.** Skulle Withings avvise et av de nye søvnfeltene,
faller synken tilbake til det historiske settet framfor å miste søvndata helt. Samme
prinsipp som VO2max-kallet: vi ber om noe vi ikke er sikre på, og feiler trygt.
Loggen sier hvilke nye felter som faktisk kom inn — søk etter `[søvnfelt]`.

## Sideeffekt: en ekte bug funnet i nettleseren

`buildSleepNightSeries` nøklet punkter på dato alene. Withings deler natta i flere
`sleep`-events når man er ute av senga (`out_of_bed_count > 0`), og to segmenter
samme dato ga duplikate `{#each}`-nøkler — `each_key_duplicate` i konsollen, og et
søylediagram som viste to lave netter der det var én normal.

Segmenter med samme dato slås nå sammen og timene summeres: 3 t + 4 t er én natt på
7 t. Naps slås ikke sammen med netter — en flis om dagen og natta er to ulike ting.

Feilen var latent før dette arbeidet, men ble først synlig da seeding la inn et
andre søvnsegment på samme dato. Den ville truffet enhver bruker med en oppdelt natt.

## Filer

- `src/lib/domain/health/body-composition.ts` *(ny)* — prosent/kilo-fiksen,
  `describeCompositionChange`. 18 tester.
- `src/lib/domain/nutrition/energy-balance.ts` *(ny)* — spist mot forbrent,
  `weeklyWeightTrend`. 11 tester.
- `src/lib/domain/sleep/disturbance.ts` — `deriveDisturbancesFromNight`,
  `mergeDisturbances`. 15 nye tester.
- `src/lib/domain/health/sleep-overview.ts` — segment-sammenslåing. 4 nye tester.
- `src/lib/server/integrations/withings-sync.ts` — `meastypes`, nye søvnfelter med
  fallback, `data_fields` på getactivity, `MEASTYPE`-kartet.
- `src/lib/server/goal-progress.ts` — `readBodyComposition` bruker normaliseringen.
- `src/lib/server/nutrition-dashboard.ts`, `sleep-dashboard.ts` — nye data.
- `src/lib/components/domain/nutrition/EnergyBalanceCard.svelte` *(ny)*.
- `SleepDisturbanceList.svelte`, `SleepDashboard.svelte`, `schema.ts`, `/design`.

## Verifisering

- `npm run check`: 0 feil, 0 advarsler.
- `npm test`: 2156 grønne (fra 2111), 45 nye.

**Mot en ekte database**, med både nytt og gammelt radformat seedet:

```
energyBalance: 743 kcal spist, 2 640 kcal forbrent — 1 897 kcal underskudd
composition:   18,0 kg fett (22,0 %), 60,5 muskel, 64,0 fettfri, 46,2 vann
change:        −1,4 kg — −1,2 kg fett, −0,9 kg muskel (86 % av endringen er fett)
```

Endringen bruker en 55 dager gammel rad i legacy-format, altså med prosenten
korrekt tolket.

Søvn-flaten slo sammen kildene riktig:

```
natt til 2026-08-03: kilder=['manual']     ← manuell logging vant
natt til 2026-08-02: kilder=['withings']   ← fylte natta du ikke logget
```

Begge flatene rendret i Chromium uten konsollfeil etter segment-fiksen.

**Ikke verifisert:** at Withings faktisk leverer de nye feltene for din konto. Alle
tre stier logger hva de fikk (`[søvnfelt]`, `[vo2max]`) og feiler trygt. Første
synk etter deploy svarer på det.

## Neste

1. **Punktpuls inn i `getEffortBaseline`** — den er lagret nå, men ikke brukt.
   Treffer VO2max, effort-skåringen og hvilepuls-signalet samtidig.
2. **HRV (`sdnn_1`)** — vi ber alt om den i `backfillSleepHrForDate` og forkaster
   den. Beste restitusjonsmarkør vi kan få.
3. **`apnea_hypopnea_index` og `snoring`** — én linje til i søvn-feltlista, hvis
   enheten er en Sleep Analyzer.
