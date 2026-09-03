# Pulskurven vi ikke tror på

Dato: 2026-09-03
Status: ferdig

## Kontekst

Brukerens gamle brystbelte var ødelagt. Det hoppet fra 130 til 230 på ett
sekund og sto deretter fast der oppe resten av økta.

Fram til nå så ingenting nedstrøms det. `computeHrZoneDistribution` og
`computeIntensitySplit` godtok enhver `hr > 0` — ingen himling, ingen sjekk på
endringsrate — så en økt låst på 230 kom ut som

- **100 % Z5** i `hrZoneDistribution`
- **hele økta i kvalitetsminutter** i `intensitySplit`: én sammenhengende blokk
  over Z4s gulv, altså null rolig og null grått

Effort er verre, fordi klampen skjuler feilen. `hrr` klemmes til `[0, 1]`, så et
snitt på 230 blir full reserve: `trimpPerMinute(1)` ≈ 4,36 per minutt gjør en økt
på 45 minutter til ~196 der en ekte rolig økt av samme lengde skårer ~45. Et tall
fire ganger for høyt ser ut som en hard økt, ikke som et avvik noen leter etter.

Ingen av disse er en levende feil i prod i dag: de øktene ligger i Strava, ikke
hos oss. Det er en **landmine under arkivimporten** — å hente inn
iSmoothRun-filene med puls ville lagt en hel periode av rene kvalitetsminutter
inn i nøyaktig den grafen som er bygget for å svare på om de rolige øktene er
rolige. Symptomet blir identisk med «72 % hard» fra 2. september, men denne
gangen er terskelen uskyldig og det er dataene som lyver.

## Faser

### Fase 1: Vakta i domenelaget

Ny ren modul `$lib/domain/health/hr-artefacts.ts` med tre detektorer og én dom
over kurven som helhet:

| Detektor | Regel | Fanger |
|---|---|---|
| `implausible_values` | andel utenfor 30–220 over `MAX_ARTEFACT_SHARE` (2 %) | en kurve låst over taket |
| `noisy_jumps` | andel intervaller med ≥25 slags endring raskere enn 3 slag/s over 2 % | en sensor som mister feste hele veien |
| `pinned` | ≥300 s innenfor ett slag, **og** minst ett hopp i kurven | et belte som hoppet og låste seg |

`diagnoseHrSeries` returnerer alltid alle tellingene, ikke bare dommen, så en
jobb kan si hvor mange kurver den forkastet og hvorfor.

`isCredibleAverageHr` er den andre halvdelen, for effort: den leser ikke sporet,
men `avgHeartRate` fra hendelsen, så en vakt over trackPoints treffer den ikke.

### Fase 2: Wiring

- `computeHrZoneDistribution` og `computeIntensitySplit` gater begge på
  `hasCredibleHrCurve` — **inni funksjonene**, ikke bare i `analyzeWorkout`.
- `analyzeWorkout` bærer `hrDiagnosis` i svaret uansett utfall.
- `effort-service.ts` legger `isCredibleAverageHr` i `hasUsableHr`, altså FØR
  klampen.

### Fase 3: Synlighet

`POST /api/sensors/workouts/reanalyze` returnerer `hrRejected` og
`hrRejectionReasons`, og logger én `[puls]`-linje per forkastet kurve med dato,
grunn og målt spenn — søkbar over `GET /api/admin/logs?grep=[puls]`.
`WorkoutReanalyzeCard` viser tallet som en egen setning under oppdelingen.

## Beslutninger

**Mengde, ikke ett punkt.** Samme lærdom som `IntensitySplit`: en binær dom over
ett grensetilfelle er katastrofal, en mengde er det ikke. Én stray 220 i et spor
på 2000 punkter er 0,05 % og skal ikke koste økta pulskurven; et belte låst i 40
minutter er ~90 % og skal.

**Vi forkaster, vi reparerer ikke.** Samme prinsipp som
`suggestForgottenTracking`, men uten forslaget: «ingen brukbar puls» er en
tilstand systemet alt håndterer riktig — sone og tidsdeling blir `undefined`,
effort faller til MET. Å kaste enkeltpunkter og beholde resten ville skjult at
sensoren var ødelagt; å gjette en verdi ville gjort en gjetning til en måling.

**Fastlåst alene feller ingen økt.** Fem minutter innenfor ett slag er ikke
fysiologi, men en enhet som glatter og rapporterer heltall kan levere en flat
serie likevel, og et nedsamplet spor gjør det verre — og prisen for en falsk
positiv er hele øktas pulskurve. Derfor krever `pinned` et artefakthopp i samme
kurve. Det er nettopp mønsteret et belte som mister kontakten lager: et hopp, og
så fast der oppe. Hver av de to alene er tvetydig; sammen er de ikke det.

Det ble oppdaget av testene: de eksisterende testene på tidsdelingen bruker
konstant puls (`at(130, 600)`), og en fastlåst-detektor uten korroborering felte
dem. Det var ikke et testproblem — det var regelen som var for grov.

**Vakta står inni begge HR-funksjonene, ikke bare i `analyzeWorkout`.** Alle
produksjonskallere går i dag gjennom `analyzeWorkout`, men en vakt som kan gås
rundt er en vakt som blir gått rundt — samme begrunnelse som testen over rå
sensorlesing: problemet er etterlevelse, ikke design.

**`MAX_PLAUSIBLE_HR` er `MAX_HR_MAX`, ikke et nytt tall.** «Over dette er tallet
ikke en puls» er samme påstand enten den gjelder en oppgitt makspuls eller en
måling i et spor, og et kalibreringstall får ikke finnes to steder.

**Terskelen på 3 slag/s er romsligere enn `hr-recovery.ts` sine 2.** Der måles et
60-sekundersvindu rundt et kjent anker, og en falsk positiv koster én måling. Her
dømmes en hel økt. Starten på et hardt drag klarer ~1,5 slag/s; 130 → 230 på ett
sekund er 100.

**`hrRejected` summerer ikke med de tre andre**, og det er sagt både i
endepunktets doku og på kortet: en forkastet kurve skrives likevel, siden
distanserekorder og terrengjustering er upåvirket av at pulssensoren løy. Samme
lærdom som telle-fiksen tidligere samme dag — en sekkepost man prøver å summere
gjør riktige tall til gale.

**Ingen tom påstand om makspuls.** Beltetoppene på 200+ er ikke målinger, så de
er ute som kandidater til `resolveMaxHr`. Tanaka 179 står, 188 fra Strava er et
redigerbart felt, og et ekte tall krever én hard innsats med et belte som virker.

## Verifisering

- 14 nye tester i `hr-artefacts.test.ts`: det ekte beltemønsteret (to detektorer
  fyrer), en vandrende kurve som skal godtas, én enkelt gal måling som skal stå,
  et mønster av gale målinger som skal felles, en flat kurve uten hopp som skal
  godtas, langsom drift som ikke er fastlåst, et hopp over et hull som ikke er et
  hopp, og starten på et hardt drag som er fysiologi.
- 4 nye tester i `intensity-split.test.ts` på integrasjonen: det ødelagte beltet
  gir hverken tidsdeling eller sonefordeling, men beholder `bestEfforts` og
  rapporterer grunnen — og en ekte økt beholder begge.
- `npm test`: 4265 tester i 298 filer, alle grønne (fra 4247/297).
- `npm run check`: 0 feil, 0 advarsler.

## Kjent rest

- **`getEffortBaseline` leser bare siste 30 døgn**, og `observedMaxes` filtreres
  av `trimmedObservedMax` sitt eget spenn (100–230), ikke av `MAX_PLAUSIBLE_HR`.
  Riktig for hvilepuls, som er en tilstand; galt for makspuls, som er et tak som
  faller med omtrent ett slag i året. Ikke rørt her, siden `resolveMaxHr`
  behandler observerte topper som siste utvei uansett.
- **Ingen diagnose per PERIODE.** Vakta dømmer én økt av gangen. Spørsmålet
  «hvilke år er pulsdata til å stole på» krever en egen lesing, og den hører før
  arkivimporten.
- Dommen lagres ikke, så en flate kan ikke si «denne øktas puls ble forkastet» —
  bare etterfyllingsjobben ser det.
- Ekko har ingen tilsvarende vakt på egne live-økter.
