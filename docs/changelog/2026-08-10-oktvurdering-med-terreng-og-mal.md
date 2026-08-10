# Øktvurdering med terreng, historikk og reelle mål

Dato: 2026-08-10
Status: ferdig (serverside) · venter på app-utgivelse (Ekko)

## Kontekst

Vurderingen på `/aktivitet/[id]` var ikke nyttig. Om en sykkeltur på 8,03 km skrev
den:

> Denne sykkeløkten på 8,03 km med et tempo på **3:08/km** og 234 høydemeter er en
> solid innsats … For å redusere vekten til **85 kg og 95 kg** … for å nå dine mål
> om å løpe **200 km og 600 km**. Tenk også på å inkludere **løpetrening**.

Fire feil i én tekst, og ingen av dem var hallusinasjon — det var alt modellen
hadde:

- **`gpt-4o-mini`** med `max_tokens: 200`, ingen systemmelding, én user-melding.
- **Seks tall om økta**: tittel, distanse, varighet, tempo, høydemeter, puls.
- **Tempo hardkodet som `/km`**, også for sykling. Kortet rett over viste «19,1
  km/t» fordi `+page.svelte` brukte `isWheeledSport()`/`formatSpeed()`. Flata
  visste det; prompten gjorde ikke.
- **Måltitler rått konkatenert.** `metadata` ble hentet fra basen, sendt inn i
  funksjonssignaturen — og aldri brukt. Verdiene lå i `sensor_goals` med
  `currentValue`, `targetValue`, `baselineValue` og `unit` hele tiden.
- **«Avslutt med ett enkelt råd for neste økt»** i prompten. Den *måtte* levere et
  råd hver gang, og med bare distanse og tempo var «løp mer og fortere» det eneste
  rådet som fantes.
- **Regenerert ved hvert sidebesøk**, temperatur 0.6, blokkerende i `load`. Samme
  økt fikk ulik tekst hver gang, og sida ventet på OpenAI.

Brukeren ba om tider og puls på strekk, bakker og runder, gode kilometre, og korte
og lange mål.

## Faser

### Fase 1: Bakker og runder fra sporet — bygget, så fjernet

`$lib/domain/health/workout-terrain.ts` med `detectClimbs`/`detectLaps` ble bygget
først, som en fallback for spor uten Ekko-analyse. Den er **slettet igjen** etter
en beslutning om at all geografi skal komme fra Ekko. Se «Beslutninger».

### Fase 2: Ekko-kontrakten

`$lib/domain/health/workout-analysis.ts` + `docs/ekko-oktanalyse.md`. Nytt
valgfritt `analysis`-felt på `POST /api/apps/upload` med navngitte features,
runder og bakkedrag. 18 tester.

### Fase 3: Mål med progresjon og horisont

`$lib/domain/health/goal-horizon.ts` — `goalHorizon`, `describeProgress`,
`frameGoals`. 22 tester.

### Fase 4: Kontekst, modell og cache

`$lib/domain/health/workout-assessment-context.ts` (ren, 21 tester) og
`$lib/server/workouts/workout-assessment.ts` (henting + cache). Ny tabell
`workout_assessments` (migrasjon `0053`).

### Fase 5: Ekko sender analysen

`ResonansAnalysisPayload.swift` + nytt `analysis`-felt i `ResonansAPI.uploadGPX`,
bygget på fullføringsstedet i `TrackingViewModel`.

## Beslutninger

**All geografi kommer fra Ekko. Resonans detekterer ingenting selv.**

Første utgave gjorde det motsatt: serveren fant geometrien i høydeprofilen, Ekko
la navnene oppå. Det ga umiddelbart en dobbelttelling — hadde Ekko navngitt
«Dreperen», listet konteksten både den og det oppdagede draget fra samme
motbakke, og modellen leser to bakker der det er én. Jeg la inn en
`suppressNamedClimbs` som filtrerte på tidsoverlapp, og *det* var symptomet på at
designet var feil: et filter mellom to motorer som beskriver den samme grunnen.

Beslutningen ble derfor å fjerne deteksjonen i sin helhet. Begrunnelsen har tre
deler:

1. Ekkos versjon er bedre på alle måter der begge finnes — den har navn og
   brukerens egen historikk å sammenligne mot.
2. To motorer som leter etter «en bakke» i samme spor blir aldri enige, og
   avviket er usynlig til noen leser vurderingen og lurer.
3. Tersklene (10 hm, 100 m, 3 %, 35 m runderadius) var valgt, ikke målt. Ett sett
   terskler kan kalibreres mot ekte turer; to sett i to språk kan det ikke.

For strekk var det uansett umulig i prinsippet — `RunFeature` sier det selv: et
strekk «finnes i historikken og i hodet».

**Konsekvensen er akseptert, ikke oversett.** En økt uten Ekko-analyse — fra
klokka, fra Dropbox, fra Strava, eller en Ekko-økt utenfor rundbanemodus / uten
lagret rute — har ingen bakker og ingen runder i vurderingen. Den har fortsatt
distanse, tid, puls, kilometersplitter, effort og mål. Skal det hullet tettes,
er veien å utvide Ekkos deteksjon, ikke å bygge en ny motor i Resonans.

**Historikken sendes med, ikke bare dagens tall.** Resonans har ikke
feature-historikken og kan ikke regne medianen selv. «131 sekunder» uten referanse
blir en gjetning i en prompt; «12 sekunder raskere enn medianen din» er en beskjed.
Differansen skrives dessuten ut ferdig regnet i konteksten — en modell som må regne
selv regner av og til feil.

**Medianen holder dagens økt utenfor**, både for features og runder. En median som
inneholder dagens tur demper turens eget avvik. Samme grunn som at HRV-baselinen
holder siste natt utenfor.

**Enheten følger idretten, ett sted.** `formatPaceOrSpeed` fra
`$lib/utils/activity-metrics` brukes nå av både flata, vurderingen og
chat-vedlegget.

**Rådet er betinget.** «Solid økt, ingenting å endre» er et fullgodt svar, og
bedre enn et påfunn. Det var den obligatoriske rådsetningen som gjorde vurderingen
masete, ikke modellen.

**GPT-4o, og cache på `context_hash`.** Jobben er nå å velge hva som er verdt å si
av mye materiale — der svikter mini. Kallet skjer én gang per økt i stedet for per
sidevisning, så kostnaden går ned selv med den større modellen. Hashen dekker
konteksten *og* systemprompten: lander Ekko-analysen etterpå, flytter et mål seg,
eller endrer vi instruksene, skrives vurderingen om. Uten den ville cachen låst
inne en vurdering fra før halvparten av dataene fantes.

**Chatten får nøyaktig samme kontekst som vurderingen.** Siden bygde tidligere sitt
eget vedlegg med et halvt dusin tall — og med «/km» også for sykling. To veier inn
til de samme tallene driver fra hverandre; det er feilen dette repoet har betalt
for flest ganger.

**Feiler modellen, beholdes den gamle teksten.** Konteksten har endret seg, men
teksten som står er fortsatt om den samme økta.

## Verifisering

- 81 nye enhetstester fordelt på fire moduler.
- `npm test`: 3128 tester i 233 filer passerer.
- `npm run check`: 0 feil, 0 advarsler.
- `npm run build`: går gjennom.

**Ikke verifisert:**

- **Swift-koden er ikke kompilert.** Sandkassa har ingen Swift-toolchain. Den nye
  fila plukkes opp automatisk (`PBXFileSystemSynchronizedRootGroup`), men
  `ResonansAnalysisPayload.swift` og endringene i `ResonansAPI`/`TrackingViewModel`
  må bygges i Xcode før de kan stoles på.
- **Ingen ende-til-ende-test mot prod.** Etter neste økt: sjekk at
  `analysis`-feltet i opplastingssvaret ikke er `null`, og at `analysisWarnings`
  er tom.
- Bakke- og rundedeteksjonen er testet på syntetiske spor, ikke på ekte GPX.
  Tersklene bør etterprøves mot en reell tur før de anses som riktige.

## Gjenstår

- `weekStanding` sendes som `null` inn i konteksten. `planText`/`loadText` fra
  `training-summary.ts` krever `loadTrainingDashboardData`, som er tung for en
  sideinnlasting — men vurderingen er cachet nå, så det kan gjøres.
- Bakker og runder vises ikke på flata, bare i vurderingen. `KmSplitsTable` har
  allerede plassen.
- `RouteSpeedHistory` (median fart og puls per rutesegment) er ikke koblet på —
  bare `FeatureHistory`.
