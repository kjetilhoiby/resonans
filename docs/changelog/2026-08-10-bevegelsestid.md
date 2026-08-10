# Bevegelsestid: varighet er ikke det samme som opptak

Dato: 2026-08-10
Status: ferdig (backfill og reprojeksjon gjenstår å kjøre mot prod)

## Kontekst

10. august ble en el-sykkeltur registrert som **9,07 km på 2 t 20 min**. Sporingen ble
aldri avsluttet, så nesten to timer stillstand lå i opptaket. Ukas effort viste **114 av
277–332** — hele uka besto av den ene turen — og belastningsdommen sa «Siste 3 dager ligger
1,55× over snittet siste 30».

Regnestykket bak 114:

```
minutter × MET_FACTOR_BY_FAMILY.ebike (0,4) × MET_CALIBRATION (~2,03)
140 × 0,4 × 2,03 ≈ 114
```

MET-stien er **rent lineær i varighet**. Distanse og fart teller ikke, og økta hadde ingen
puls (el-sykkel uten pulsbelte), så det fantes ingen annen dom. Riktig svar var ~20.

Samme `durationSeconds` priser aktivitetsforbruket i `energy-expenditure.ts`: 140 minutter
el-sykkel med `(MET − 1)` = (4,5 − 1) gir ~800 kcal fantomaktivitet, som går videre inn i
`loadEnergyContext`, «Igjen i dag» og `sendFuelNudge`. Ett felt forurenset altså ukas
effort, akutt/kronisk-dommen, dagsforbruket og et eventuelt sultvarsel samtidig.

**Strava viste samme spor som 9,08 km / 27 min 3 s.** Distansen var identisk — den
stillestående halen la ikke på meter, bare tid. Hele feilen var ett tall, og Strava
korrigerer det automatisk ved å regne bevegelsestid. De har i tillegg manuell crop under
«Avansert redigering», men den er lag to.

Vi hadde ingen av delene. `parseWorkoutFile` regner `duration` som `siste punkt − første
punkt` (`dropbox-sync.ts:144`), altså elapsed, og ingenting nedstrøms visste at det fantes
et annet tall.

## Faser

### Fase 1: Domenemodulen

`src/lib/domain/health/moving-time.ts` (ren, ingen DB) med `computeMovingTime(points, {sportType})`.

Utformingen har tre valg som er verdt å kjenne:

**Forflytning, ikke sporlengde.** Farten måles som haversine-avstand mellom vinduets
endepunkter delt på tiden. Sporlengden gjennom vinduet ville summert GPS-støyen — hvert
lite hopp legger til meter — mens forflytning mellom to punkter ti sekunder fra hverandre
er ~0 når man står stille, uansett hvor mye punktene imellom spriker.

**To porter, og begge må åpne.** Den fine (`SPEED_WINDOW_SECONDS`, 10 s) spør «var jeg i
bevegelse nå». Den grove (`PROGRESS_WINDOW_SECONDS`, 120 s) spør «kom jeg noen vei».

Den grove porten kom til etter en korreksjon fra brukeren, og den var nødvendig: halen på
denne turen er ikke en telefon som ligger i ro. Sykkelen parkeres i en **garasje**, og
telefonen bæres opp på kontoret. Innendørs GPS er ikke jitter på 2–5 meter — det er
multipath som kaster posisjonen titalls meter av gårde, og over ti sekunder ser det ut som
fart. Over to minutter avslører det seg: en telefon i en garasje kommer ingen vei, uansett
hvor mye posisjonen hopper. Ekte sykling gjør det.

Arbeidsdelingen faller ut riktig av seg selv: et rødlys består den grove porten (vinduet
rundt inneholder syklingen på begge sider) og felles av den fine. Garasjedrift er motsatt.
Gulvet er `PROGRESS_FLOOR_FRACTION` (0,25) av familiens terskel — en andel, ikke et fast
tall, så det skalerer med sporten.

**Terskler per sportsfamilie** (`MOVING_THRESHOLD_MS_BY_FAMILY`): sykkel/el-sykkel 2,5 m/s,
løp 0,7, gange/tur 0,4.

Sykkelterskelen er bevisst høyere enn Stravas ~1,4. Gåturen fra garasjen til kontoret
*kommer* noen vei, så den grove porten slipper den gjennom — det som skiller den fra
sykling er farten. Gange ligger på 1,2–1,7 m/s og ville bestått 1,4; ekte sykling ligger på
4–8. Gapet er så stort at porten kan settes midt i det uten å tape noe reelt.

**Løping har ikke det gapet, og terskelen later ikke som.** En rask gange (1,7) og en
sliten jogg (1,8) er ikke til å skille på fart alene. `running` står derfor på 0,7: en
løpetur med gangpauser krediteres, og en gåtur hjem etterpå gjør det også. Kjent rest,
ikke et løst problem.

Modulen returnerer **null** framfor et tall når sporet ikke kan svare: under `MIN_POINTS`
(10), under `MIN_COVERAGE` (0,5), eller for familier der begrepet ikke gir mening (styrke,
yoga, svømming). Null betyr «vet ikke» og gir elapsed videre — ikke at økta sto stille.

`MAX_CREDITED_INTERVAL_SECONDS` (60) hindrer at et hull i sporet — tunnel, drept app,
pauset opptak — krediteres som verken bevegelse eller stillstand i sin helhet.

### Fase 2: Skriving ved opplasting

`movingDurationFor(parsed)` eksporteres fra `dropbox-sync.ts` og kalles fra begge
skrivesteder: `/api/apps/upload` (Ekko) og Dropbox-synken. Feltet lagres som
`data.movingDuration` **ved siden av** `data.duration`, aldri i stedet for — elapsed er et
faktum om opptaket, moving er en tolkning av det.

Kallet skjer **etter** at `sportType` er endelig avgjort. Opplastingsstien overstyrer
sportstypen etter parsingen (Ekko sender «eBiking»), og terskelen er per familie — en
el-sykkeltur parset som «running» ville fått løpeterskelen.

Sporet leses i **full oppløsning**, før `downsampleTrack`. Nedsamplingen er en avveiing
mot kart-payload og har ingen grunn til å påvirke et tall vi skårer på.

### Fase 3: Lesing og skåring

- `activity-layer.ts` henter `movingDuration`, eksponerer `movingSeconds` på både
  `UnifiedWorkoutActivity` og `WorkoutEvidence`, og **klamper den til `durationSeconds`** —
  to kilder kan ha registrert ulike deler av samme økt.
- `computeWorkoutEffort` tar `movingSeconds` og skårer på den når den finnes.
  `WorkoutEffortResult.durationBasis` (`'moving' | 'elapsed'`) sier hvilken.
- `canonical_workouts.moving_seconds` (migrasjon `0052`) lagrer tallet, og
  `workout-projection-service` regner **pace på samme varighet som effort skåres på** —
  ellers ville en økt med lang stillstand fått lav «fart» og dermed lav intensitet, i
  tillegg til at halen alt er trukket fra minuttene.
- `estimateWorkoutKcal` bruker bevegelsestid til både minutter og løpefart.
  `energy-context.ts`, `intraday.ts` og `fuel-nudge.ts` leser den nye kolonnen.

### Fase 4: Backfill

`POST /api/helse/trening/bevegelsestid?limit=500[&dryRun=true]`
(`$lib/server/health/moving-time-backfill.ts`).

Additiv og idempotent: fyller `data.movingDuration` på rader som mangler feltet, sletter
ingenting, overskriver ingenting. Rapporterer per økt med `stoppedShare` sortert synkende,
så de verste avvikene står øverst.

Backfillen er **ikke valgfri**. Ankeret i effort-budsjettet er snittet av de siste fire
hele ukene lest fra de *lagrede* skårene, så uten den ville nye uker og ankeret ligget på
hver sin skala uten at noe sa fra — nøyaktig fella CLAUDE.md advarer mot under «Endrer du
skåringen, må historikken reberegnes».

### Fase 5: Flaten

`HealthActivityList` viser bevegelsestid som hovedtall når stillstanden overstiger
`NOTABLE_STOPPED_SHARE` (20 %), med «i bevegelse · 2 t 20 min opptak» under. Under
terskelen vises elapsed alene — et rødlys er ikke en historie, og to tall er da bare støy.
Terskelen importeres fra domenemodulen så flaten og skåringen ikke får hver sin mening om
når et stopp er verdt å nevne.

## Beslutninger

**Automatikk før nødutgang.** Første forslag var en manuell trim under «Kilder og avvik»,
ved siden av `dismiss` og `source-role`. Det er feil rekkefølge: en knapp krever at
brukeren oppdager feilen. Strava gjør begge deler, men automatikken er standarden og
croppen er unntaket. Manuell crop (`metadata.trimEndAt`) står igjen som lag to — den
trengs for halene som *ikke* står stille, som en glemt sporing i bilen hjem.

**Begge tall lagres.** `duration` beholdes som elapsed. Å overskrive det ville kastet
informasjon som ikke kan gjenskapes, og gjort det umulig å se at en retting hadde skjedd.

**0 bevegelsessekunder tolkes som «vet ikke», ikke som 0.** `normalizeDurationSeconds`
gjør 0 til null, og det er med vilje: et spor helt uten forflytning er like gjerne en
tredemølle eller en rulle som en glemt sporing. Skåringen faller da tilbake på elapsed.

**Minstelengden (`MIN_WORKOUT_DURATION_SECONDS`) måles på bevegelsestiden.** En time
stillstand med to minutter sykling er ikke en økt; målte porten på elapsed, ville den
sluppet gjennom og blitt skåret som to minutter.

**Støyresten er akseptert og dokumentert.** Vinduet fjerner ikke GPS-jitter helt — treffer
to motsatt rettede utslag hverandre i endepunktene, slipper et intervall gjennom. Målt på
worst-case-syntetikk (±5 m alternerende) er resten under 5 % av stillstanden. Retningen på
feilen er den trygge: vi krediterer litt for mye tid, aldri for lite.

**«Stillstand» var feil modell for halen, og korreksjonen kostet et helt lag.** Første
utgave hadde bare den fine porten, med den begrunnelsen at en telefon i ro spriker 2–5
meter. Det stemmer utendørs. Halen her er en garasje og en gåtur, og begge produserer fart
som består en tiendesekunders test. Lærdommen er generell: en glemt sporing slutter sjelden
med at telefonen legges fra seg — den fortsetter å følge et menneske som gjør noe annet.

**Bevegelsestid gjelder også TRIMP-stien.** Puls demper feilen (død tid drar
`avgHeartRate` ned), men `avgHeartRate × varighet` blåses fortsatt opp.

## Verifisering

- `npm test`: 3048 tester, alle grønne (11 nye i `moving-time.test.ts`, 5 i
  `effort-service.test.ts`, 3 i `energy-expenditure.test.ts`).
- `npm run check`: 0 feil, 0 advarsler.
- Effort-testene uttrykker **forhold**, ikke nivå — `med.score / uten.score` skal være
  `1620 / 8400` — så de ikke låser seg til `MET_CALIBRATION`, slik hardkodet 87,5 gjorde i august.
- Domenetesten reproduserer saken direkte: 25 min sykling + 115 min stillstand med
  GPS-jitter gir 1400–1600 bevegelsessekunder mot 8400 elapsed.

**Ikke kjørt ennå** (krever prod-DB):

```bash
# 1. Se hva backfillen ville skrevet — sorteres med verste avvik først
POST /api/helse/trening/bevegelsestid?dryRun=true&limit=500

# 2. Skriv
POST /api/helse/trening/bevegelsestid?limit=500

# 3. Se hva reprojeksjonen ville gjort med ukene
POST /api/helse/trening/reprojiser?weeks=26&dryRun=true

# 4. Reberegn (26 uker per kjøring; lengre historikk i biter)
POST /api/helse/trening/reprojiser?weeks=26
```

Steg 4 er nødvendig: `effortScore` er lagret, ikke regnet ved lesing. Et skrevet
`movingDuration` uten reprojeksjon ser ut som en jobb som ikke gjorde noe.
