# Reparasjonsvinduet måtte kunne pekes bakover

Dato: 2026-09-06
Status: ferdig

## Kontekst

Etter at `refreshForRange` ble fikset (se
`2026-09-06-projeksjon-som-sletter-mer-enn-den-bygger.md`) sto det fortsatt et
hull igjen i `canonical_workouts`: sesongkurven «Akkumulert løping» begynte
2026-linja i **mars**, mens alle de grå tidligere årene startet i januar.
«Året mitt starter plutselig i mars.»

Tallene var identiske før og etter både en `reprojiser?weeks=26` og en full
`aggregateAllPeriods` — 383 km, 71 dager med løping. Ingen av de to handlingene
rørte januar og februar.

## Årsaken, i to ledd

**Hullet var reelt, ikke en visningsfeil.** `loadRunningHistory` har ingen
radgrense og leser `canonical_workouts` uten datofilter utover ti år, så en
kurve som starter i mars betyr at radene fra januar og februar ikke finnes.
Signaturen er den gamle `refreshForRange`-feilen: en kjøring slettet vinduet
sitt og bygde bare opp igjen de 2000 eldste aktivitetene, og etterlot alt fra
der de tok slutt og fram til «nå».

**Verktøyet som kunne reparert det, rakk ikke fram.** `resolveReprojectWindow`
satte `toDate = now`, alltid. Vinduet var derfor bare «siste N uker», og med
`MAX_REPROJECT_WEEKS = 26` var det samme tallet samtidig et tak på **spennet**
og på **rekkevidden**. 26 uker fra 6. september er 8. mars — én uke for kort.
Den ene knappen i produktet som gjør nøyaktig den jobben som trengtes, kunne
ikke pekes på hullet.

Og «Reberegn» var det heller ikke som fikset noe for periodetabellen: den leser
`sensor_aggregates`, en helt annen tabell, bygget av `aggregateAllPeriods`
(nattlig cron) eller av en fersk øktskriving. To rørledninger med nesten samme
navn på flaten.

## Fasen

### Fase 1: `until` flytter vinduet

`resolveReprojectWindow(weeks, now, until?)`:

- `until` (YYYY-MM-DD) blir `toDate`; `fromDate` er fortsatt `toDate − weeks`.
- Spennet er **uendret** — `until` flytter vinduet, den forlenger det ikke.
- Framtida avvises: et vindu som slutter etter i dag ville slettet og bygget
  opp igjen et tomrom.
- Tom streng er «ikke oppgitt», ikke en feil — et tomt datofelt i skjemaet
  betyr «fram til nå».
- `anchoredToNow` følger med i svaret, så en logglinje og en flate kan si hva
  som faktisk ble kjørt.

`POST /api/helse/trening/reprojiser?weeks=26&until=2026-03-08` er dermed
reparasjonen for hullet over, og logglinja navngir nå datospennet.

### Fase 2: tørrkjøringen ble hullfinneren

`dryRun` returnerte allerede `weeklyEffortBefore` per uke, men kortet kastet
det (`rows = null`) og skrev bare «N økter i vinduet». Nå rendres ukene, uker
med **0 økter** merkes, og sammendraget teller dem: «… og 6 uker uten en eneste
økt. Trente du i dem, mangler radene.»

Det er den diagnosen som ikke fantes da hullet ble jaktet på — den ble utledet
av en graf i stedet.

### Fase 3: kortet fikk et sluttpunkt

`EffortReprojectCard` har et «Bakover fra»-felt (`DateInput`, `max` = i dag).
`DateInput` fikk en `dataTrack`-prop mens jeg var der: uten den ville feltet
endt som et anonymt `input[date]` i brukslogginga.

## Beslutninger

- **Spenntaket beholdt, men begrunnelsen rettet.** Kommentaren sa at et for
  stort spenn «risikerer å bli avbrutt mellom slett og skriv». Det er ikke
  sant lenger — chunkingen sletter og skriver per side. Grunnen som STÅR er
  pulskurvene: projeksjonen laster sporet for hver løpeøkt i vinduet, og ni år
  i ett kall ville lastet alle samtidig. Samme grense og samme grunn som
  reanalyse-endepunktet. En grense som beholdes med en utdatert begrunnelse er
  en grense ingen kan vurdere neste gang.
- **Ikke et nytt endepunkt.** Det er samme operasjon på samme funksjon
  (`refreshForRange`) med samme rapport — et parallelt «reparer»-endepunkt
  ville vært to steder å holde i sync om det samme.
- **`MIN_REPROJECT_WEEKS` (5) står, også for et flyttet vindu.** Begrunnelsen
  (effort-ankerets fire uker) gjelder strengt tatt bare et vindu som slutter nå,
  men å løsne den inviterer til en annen feil, og den koster ingenting her.
- **Egen tabellform for tørrkjøringen.** Å fylle `after` med samme tall som
  `before` ville lest som «ingenting endret seg» — det motsatte av det en
  tørrkjøring svarer på.
- **Reparasjonen skårer med DAGENS baseline.** `getEffortBaseline` leser siste
  30 døgn uansett hvilket vindu som bygges, så januar-øktene blir skåret mot
  makspuls 192. Det er meningen med en reprojeksjon, men det betyr at et
  reparert vindu ikke er identisk med det som en gang sto der.

## Verifisering

- `npm test`: 4652 tester i 319 filer, alle grønne — inkludert åtte nye på
  `until` (flytter vinduet og beholder spennet, utvider ikke taket, godtar
  spennet helt ut på et flyttet vindu, avviser framtida, godtar i dag, avviser
  en ugyldig dato, tom streng = ikke oppgitt).
- `npm run check`: 0 feil, 0 advarsler.
- Ikke dekket av piksel-diff: `/settings/sources` er ikke i
  `tests/visual/pages.spec.ts`, så kortets nye felt og tabell har ingen
  baseline.

## Kjent rest

- **Hvor hullet slutter er ikke målt herfra, det er lest av en graf.**
  Tørrkjøringen over januar–mars svarer på det presist nå, men den må kjøres.
- **Ingen full-historikk-gjennomgang.** Ligger det flere hull lenger tilbake,
  må vinduet flyttes dit manuelt, 26 uker av gangen. Et verktøy som selv finner
  alle hullene i hele historikken finnes ikke — det ville krevd en
  dekningsrapport per år mot kilden, og kilden er den samme dyre jobben.
- **De to rørledningene har fortsatt nesten samme navn på flaten.** «Reberegn
  treningsbelastning» bygger `canonical_workouts`; periodetabellen leser
  `sensor_aggregates`. Ingenting på flaten sier at et hull kan sitte i det ene
  laget og ikke i det andre.
