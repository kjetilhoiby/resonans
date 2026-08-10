# Effort-kalibrering: glattet anker, aldersbasert makspuls, og to dommer i stedet for én

Dato: 2026-08-09
Status: ferdig

## Kontekst

Brukeren la tre skjermbilder ved siden av hverandre — Resonans, Ekko og Strava — for
samme uke (3.–9. august 2026, seks løpeturer og seks sykkelturer):

| Flate | Dom |
|---|---|
| Resonans | `513 av 235–282` · «Hvil» · «Høy belastning siste 3 dager» |
| Ekko | `513 av 100–120` · «Ukas mål er nådd» |
| Strava | `195` · «Over ukentlig rekkevidde — vær oppmerksom på kroppens signaler» |

Brukerens egen formulering: *«Det føles som at Strava anerkjenner at jeg har tatt litt i
denne uka, mens Resonans/Ekko mener jeg er far out of bounds.»*

Ekkos dagsummer dekomponerer eksakt mot Resonans-flisene (3. aug: 118 = løp + el-sykkel
25+27; 4. aug: 115 = løp + sykkel 53 + el-sykkel 23), så hver løpetur lot seg isolere og
sammenlignes med Stravas relative prestasjon:

| Dato | Økt | Vår effort | Strava | Forhold |
|---|---|---|---|---|
| 3. aug | 4,5 km · 26:05 | 66 | 39 | 1,69 |
| 4. aug | 2,8 km · 15:15 | 39 | 23 | 1,70 |
| 5. aug | 3,0 km · 17:38 | 40 | 22 | 1,82 |
| 7. aug | 6,9 km · 45:05 | 114 | 66 | 1,73 |
| 8. aug | 2,9 km · 16:03 | 37 | 20 | 1,85 |
| 9. aug | 3,4 km · 20:00 | 46 | 25 | 1,84 |
| **Sum** | | **342** | **195** | **1,75** |

Faktoren er flat, altså en skalaforskjell og ikke støy. Resten av differansen er
syklene: Strava gir **0** til alle seks (relativ prestasjon krever puls, og el-sykkelen
har ingen), mens vår MET-sti ga 172. Av differansen på 319 kom 147 fra dyrere løp og 172
fra økter Strava ikke ser.

Tre separate feil lå under, og de ble adressert hver for seg.

## Faser

### Fase 1: Ankeret glattes over fire uker

`computeEffortBudget` ankret på **forrige ukes total**, uglattet. Det er en leash på
20 %: enhver uke mer enn `effortVekstFaktor` over den forrige leses som utenfor
budsjettet. Strava sammenligner mot et rullende flerukers-bånd, og det er hele grunnen
til at den samme uka høres rimeligere ut der.

Feilen har en tvilling i motsatt retning som er lettere å overse: uka **etter** ville
ankeret vært 513, så flaten ville krevd 513 for å være «på plan». Én stor uke ble den
nye normalen på sju dager. Verre, de 513 inkluderte 172 fra el-sykkelpendling — ankeret
skiller ikke stabil bakgrunnsbelastning fra treningsbelastning, så en uke med dårlig vær
ville bommet på gulvet uten at noe ved treningen var endret.

Nå: snitt av siste `effortAnkerUker` (default **4**) hele uker. Samme vindu som den
kroniske siden av akutt/kronisk-ratioen, med vilje — to mål på «hva er normalt for deg»
som svarer ulikt er verre enn ett.

- Uker **før første registrerte økt** teller ikke. Uten den vakta drar uker som aldri
  fantes snittet mot null, og en fersk bruker får et kunstig lavt bånd som ser ut som en
  beregning.
- En **hvileuke midt i vinduet teller som 0**, ikke som manglende data. En reell
  hvileuke er informasjon om normalen din; hoppet vi over den, ville et opphold sett ut
  som at nivået aldri falt.
- `anchor`-unionen er nå `'snitt_uker' | 'gulv'` (var `'forrige_uke' | 'p4w_snitt' |
  'gulv'`), og `anchorWeeks` sier hvor mange uker snittet faktisk bygger på.

Målt effekt på den konkrete uka: neste ukes bånd blir **338–406** i stedet for 513–616.

Filer: `server/tracks/effort-budget.ts`, `server/tracks/types.ts`.

### Fase 2: Budsjett og belastning er to dommer, ikke én

Flaten viste dem med samme uttrykk: ett gult «Hvil»-merke, og én statuslinje der
belastningsvarselet **overskrev** budsjettstatusen. Da leser man «513 av 235–282» som en
påstand om kroppen. Det er den ikke — en budsjettoverskridelse sier at du gjorde mer enn
progresjonsplanen ba om.

Det ene signalet som *er* formet som risiko er akutt/kronisk: 1,62 mot terskel 1,5.
Regner man baklengs er de tre siste dagene 197 mot et 30-dagerssnitt rundt 40/dag —
altså løpene, ikke pendlingen. 1,62 er mildt forhøyet, og det er samme dom Strava
feller.

Kortet viser nå to merkede linjer:

```
PLAN         Over ukas plan (235–282) — planen er et budsjett, ikke en grense.
BELASTNING   Siste 3 dager ligger 1,62× over snittet siste 30 — ta en rolig dag.
```

Bare belastningslinja får varselfarge, og «Hvil»-merket ble til **«Høy belastning»** —
det gjelder belastningen, ikke budsjettet.

Ordene bor i `$lib/domain/health/effort-standing.ts` og deles med `training-summary.ts`,
så chatten sier det samme som skjermen. Med bare `standing: 'over'` fant modellen sine
egne ord, og «over» ble like gjerne «du har overtrent» som «du gjorde mer enn planen ba
om» — de to er ikke det samme, og bare den andre er sann.

`describeAcuteChronic` tar `restRecommended` framfor terskelen: terskelen er
brukerkonfigurerbar (`hvileRatioTerskel`) og bor på treningsløpet, så en kopi på flaten
ville gitt en andre terskel å ta feil av. Modulen leser også en **rolig** periode
(ratio < 0,8) — en motor som bare sier fra når du har gjort for mye, er stum i alle
ukene du er uthvilt, og da er tausheten ikke til å skille fra «vet ikke».

Filer: `domain/health/effort-standing.ts` (ny), `components/domain/training/EffortBudgetCard.svelte`,
`domain/ai/training-summary.ts`.

### Fase 3: Makspuls fra alder, ikke fra observerte topper

TRIMP-skårene løser baklengs til **HRR ≈ 0,79–0,81** på alle seks løpene. Med snittpuls
146–148 betyr det en reserve på ~120 slag, altså makspuls rundt **170** med hvilepuls ~50.

Der lå feilen. `resolveMaxHr` tok ~90-persentilen av observerte topper siste 30 dager.
Men observerte topper er bare en makspuls hvis man faktisk har vært på maks — og denne
brukeren racer ikke. Det er nøyaktig samme årsak som gjør VDOT-estimatet ~9 poeng for
lavt (`docs/changelog/2026-08-03-vo2max.md`), men **retningen er motsatt og derfor lett
å overse**: for lav makspuls gir for *lav* VDOT og for *høy* effort.

Ny prioritet: **manuell → alder → observerte topper → snitt-proxy → default.**

- Formelen er **Tanaka** (`208 − 0,7 × alder`), ikke «220 − alder» — sistnevnte er en
  tommelfingerregel uten opphav i data som bommer systematisk for voksne.
- Alderen leses gjennom `readBodyProfile`, så fødselsårets to kilder (self-personens
  `birthDate`, eller overstyringen i `metricSettings.profile`) prioriteres ett sted.
- **En observert topp OVER aldersanslaget vinner likevel.** Formelen er et
  populasjonssnitt med reell spredning (SD ~7–10 slag). Har man faktisk registrert 192
  mens formelen sier 177, er formelen for lav — og en for lav makspuls er nettopp feilen
  vi retter. Toppen er persentil-trimmet, så én spike løfter den ikke.
- Manuell overstyring fantes allerede i metrikk-arket (`themes.metricSettings.maxHr.goal`);
  bare hjelpeteksten er oppdatert, siden fallbacken ikke lenger er «treningsdata».

Filer: `domain/health/heart-rate-baseline.ts`, `server/services/effort-service.ts`.

### Fase 4: MET_CALIBRATION måtte følge med — og modellen flyttet til domenelaget

Dette er den ikke-åpenbare konsekvensen. `MET_CALIBRATION = 2,5` var dokumentert som
«bringer MET-skår inn i samme størrelsesorden som TRIMP», og den traff: løping på
MET-stien ga 1,0 × 2,5 = **2,5 per minutt**, mens TRIMP-stien ga 2,3–2,5 per minutt på
ukas løp. Konstanten var altså tunet mot dagens TRIMP-nivå — som igjen var bygget på den
for lave makspulsen. Feilen var arvet inn i alle øktene **uten** puls.

Retter man bare makspulsen, faller løpene ~20 % mens syklene står stille, og
el-sykkelens andel av uka hopper. De to konstantene måtte ned sammen.

`MET_CALIBRATION` er derfor ikke lenger et hardkodet tall, men **utledet** av
TRIMP-kurven ved en oppgitt referanse-intensitet:

```
MET_CALIBRATION = trimpPerMinute(CALIBRATION_REFERENCE_HRR) / MET_FACTOR_BY_FAMILY.running
                = trimpPerMinute(0,75) / 1,0
                ≈ 2,03
```

Referansen er oppgitt i **HRR** framfor som et ferdig tall nettopp fordi det gjør
kalibreringen etterprøvbar — og fordi et hardkodet tall stille arver feilen i den
makspulsen det en gang ble tunet mot. 2,5 svarte til HRR ≈ 0,82, altså langt hardere enn
en rolig økt.

Samtidig ble modellens tall flyttet til `$lib/domain/health/effort-model.ts`. De lå
**duplisert**: `server/services/effort-service.ts` skårer øktene, mens
`server/tracks/effort-budget.ts` viser hva en planlagt økt *ville* gitt («Sykkeltur
40 min ~85»), og hadde sin egen kopi av `MET_CALIBRATION`, `CYCLING_FAKTOR` og
`EBIKE_FAKTOR`. To kopier av et kalibreringstall driver fra hverandre, og da lover
planleggeren noe annet enn skåringen leverer. `effort-budget.ts` er ren og kan ikke
importere `effort-service.ts` (den drar inn DB-en), så tallene hører over begge.

**El-sykkelens 0,4 ble kryssjekket og beholdt.** `energy-expenditure.ts` er bygget
uavhengig og bruker (MET − 1) for å trekke fra hvilen man hadde brukt uansett: el-sykkel
4,5 mot løpingens ~10 gir netto 3,5/9 ≈ **0,39**. At to modeller lander på det samme er
grunnen til å tro på tallet. Det som gjør at det *føles* mye er antall minutter — seks
pendlerturer ble 172 av 514 — ikke faktoren.

## Beslutninger

- **Fire uker, ikke tre.** Matcher det kroniske vinduet i akutt/kronisk. Overstyres med
  `effortAnkerUker` på treningsløpet.
- **Ingen medisinske påstander.** «Ta en rolig dag» er et råd; vi sier ikke hva som skjer
  i kroppen, fordi vi ikke måler det.
- **Tanaka, ikke 220 − alder.** Utledet av en metaanalyse framfor en tommelfingerregel.
- **`MET_CALIBRATION` endret sammen med makspulsen, ikke etterpå.** Å la den stå ville
  byttet én skjevhet mot en annen — bikes 25 % dyrere relativt til løp, uten at noe ved
  syklingen var endret.
- **Testene uttrykker forhold, ikke nivå.** `effort-service.test.ts` hardkodet 87,5
  (= 35 min × 2,5) og låste dermed testene til kalibreringsnivået; de handler om
  forholdet mellom intensiteter og bruker nå konstanten.

## Verifisering

`npm test`: 2996 tester i 226 filer passerer. `npm run check`: 0 feil, 0 advarsler.

Modellert mot ukas faktiske tall (gjennom den ekte koden, ikke for hånd). Den gamle
modellen reproduserer **513** for uka — samme tall som skjermbildet — noe som bekrefter
at utgangspunktet er riktig forstått:

| | Løp sum | Forhold til Strava (195) | Sykkel | Sykkelandel |
|---|---|---|---|---|
| Før | 334 | 1,71 | 179 | 35 % |
| Etter (alder 45 → maks 177) | 290 | 1,49 | 145 | 33 % |
| Etter (alder 40 → maks 180) | 274 | 1,41 | 145 | 35 % |

Løpene nærmer seg Strava uten å bli identiske — det skal de heller ikke, siden Strava har
sin egen kalibrering. Sykkelandelen flyttet seg 1–2 prosentpoeng, som var poenget med å
justere kalibreringen samtidig.

Ankeret på den samme historikken: neste ukes bånd blir **338–406** mot 513–616 uglattet.

**Ikke kjørt her:** visuelle tester (`npm run test:visual`) krever `DATABASE_URL` og en
dev-server, som ikke finnes i dette miljøet. `EffortBudgetCard` er endret visuelt —
statuslinja er nå en to-raders `<dl>` — så baselinene må oppdateres ved første kjøring
med database.

### Fase 5: En vei til å reberegne historikken

`effortScore` er **lagret** i `canonical_workouts`, ikke regnet ved lesing. En endring i
modellen gjelder derfor bare økter som skrives etterpå — og siden båndet ankres på
snittet av de siste fire ukene fra nettopp de lagrede radene, ender ankeret og denne ukas
økter på hver sin skala. Uka ser kunstig lav ut mot et for høyt bånd, og **ingenting sier
fra**: begge tallene ser plausible ut.

Jobbtypen `workout_projection_refresh` gjorde alt som skulle til fra før, men **ingenting
kunne starte den med et vilkårlig datospenn**. `refreshForRange` var bare nåbar fra to
enkeltøkt-ruter (`source-role`, `dismiss`) og fra staleness-sweeperen, som utleder spennet
av mål-datoer. `/api/admin/jobs` er lesing alene, og
`POST /api/sensors/workouts/reanalyze` rører bare analytics — ikke `effortScore`.

Nytt: **`POST /api/admin/workouts/reproject?weeks=8[&dryRun=true]`**.

- Rapporterer **effort per uke før og etter**, med prosentvis endring. En reberegning man
  ikke kan se effekten av, er en man må stole på.
- Rapporterer **baselinen som ble brukt**. `maxHrSource: 'observed'` der man forventet
  `'age'` er den stille grunnen til at ingenting skjedde — fødselsåret mangler i
  kroppsprofilen. Uten det feltet ser en no-op ut som en fullført jobb.
- **Gulvet er 5 uker**, ikke et rundt tall: ankervinduet (4) pluss inneværende uke. Et
  kortere vindu ser ut som en reberegning, men lar minst én av ankerets uker stå på gammel
  skala. Taket er 26 uker per kjøring, siden `refreshForRange` sletter og skriver i ett
  spenn — lengre historikk kjøres i biter, samme regel som `withings_backfill`.
- **Idempotent.** Samme modell inn gir samme tall ut, så den kan kjøres om igjen.

Vindusvalideringen og før/etter-sammenligningen bor rent og testet i
`$lib/domain/health/reproject-window.ts`.

## Etterarbeid
- **Ekko regner budsjettet mot en tom økthistorikk.** `513 av 100–120` er
  `FLOOR_EFFORT × growthFactor`, altså `anchor: 'gulv'` — grenen som bare treffes når
  historikken er tom. Resonans traff riktig gren på samme data. Ikke undersøkt her.
- Makspulsen bør settes manuelt i metrikk-arket når brukeren kjenner sin egen; både
  alder og observerte topper er anslag.
