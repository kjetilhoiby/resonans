# Akkumulert snitt kunne synke

Dato: 2026-08-18
Status: ferdig

## Kontekst

> «Hvordan kan akkumulert forbruk ha gått ned?»

Den stiplede linja på Økonomi-oversikten — «snitt av 4 foregående perioder» — falt synlig midt i
grafen. **En akkumulert kurve kan ikke synke.** Den summerer utlegg, og det finnes ikke negative
utlegg. Spørsmålet var derfor ikke en observasjon om forbruk, det var en bugrapport.

Målt mot prod, `GET /api/tema/<id>/dashboard/economics`:

```
dag 29 → 30:  132 450 kr → 79 220 kr   (−53 229 kr)
```

Ett fall, presist der.

## Årsaken: snitt over en KRYMPENDE populasjon

Hver periodes egen kurve var riktig og monoton. Feilen satt i snittet:

```ts
const pointsForDay = perPeriodSeries
    .map((series) => series.find((point) => point.day === day) ?? null)
    .filter((point) => point !== null);          // ← perioder som ennå HAR dag N

total: pointsForDay.reduce(...) / pointsForDay.length   // ← nevneren endrer seg
```

Periodene har ulik lengde. Fram til dag 29 bidro alle fire; på dag 30 var tre av dem slutt, og
snittet ble tatt over den ene som sto igjen. Faller en periode med **høyt** forbruk ut, synker
snittet — uten at noen har fått penger tilbake.

Dette er samme feilform som resten av tillitsgjennomgangen: **en betingelse jeg ikke så som en
betingelse.** Her var det nevneren. Hvert ledd var riktig; bare sammensetningen var gal.

Og den er verdt å merke seg fordi den er **usynlig i koden og åpenbar på skjermen**. Ingen
enhetstest på ett punkt ville fanget den; det krevde å se på kurven — eller å formulere
invarianten.

## Faser

### Fase 1: Ut i domenelaget, med invarianten som test

Beregningen lå inline i `economics-dashboard.ts`, som er DB-koblet og derfor ikke testet. Flyttet
til `$lib/domain/economics/payday-comparison.ts` (`buildPaydayComparison`) med 17 tester.

`isMonotonicComparison` er eksportert som en **etterprøvbar invariant**, ikke som pynt: den finnes
fordi feilen ikke kunne leses ut av koden. Én test bygger nettopp prod-tilfellet — tre korte
perioder med høyt forbruk og én lang med lavt — og én genererer 110 dager med varierende utlegg
over fire ulike periodelengder og krever at kurven ikke synker.

### Fase 2: Konstant populasjon

Serien **kappes ved den korteste perioden**. Da bidrar alle periodene på hver tegnede dag, og
monotonien følger av konstruksjonen framfor å være noe man håper på.

To alternativer ble vurdert og forkastet:

- **Videreføre siste verdi** for en avsluttet periode. Populasjonen holder seg på fire, men kurven
  påstår at en periode på 29 dager har en dag 40 — den sammenligner mot noe som ikke fantes.
- **Normalisere x-aksen til prosent av perioden.** Riktigere i teorien, men da er x-aksen ikke
  lenger «dager siden lønn», og den grønne kurven ved siden av måtte fulgt med. Større ombygging
  enn feilen krever.

**Å tegne kortere er ærligere enn å tegne feil.** Linja slutter der sammenligningen slutter å være
en sammenligning, og flaten sier hvor og hvorfor.

### Fase 3: Den andre observasjonen i samme måling

Serien gikk til **dag 58** mens inneværende periode var 27 dager. En lønnsperiode er ~30 dager, så
minst én «periode» dekket to: `detectGlobalPayday` kjente ikke igjen en lønnsdato og slo dem sammen.

Kappingen ville **skjult** dette — kurven blir kort og ser fin ut. Derfor rapporteres
`comparisonDays` og `longestComparisonPeriodDays` i payloaden, og flaten sier fra over 35 dager:
«sannsynligvis to perioder slått sammen fordi en lønnsdato ikke ble kjent igjen. Snittet blir da for
høyt.»

En fix som gjør symptomet usynlig uten å fjerne årsaken er en dårligere fix.

### Fase 4: Manglende mellomrom

`27 dager.Stiplet linje` — teksten manglet et mellomrom etter punktum. Synlig i samme skjermdump.

## Beslutninger

**`MERGED_PERIOD_DAYS = 35`, ikke 31.** En lønning som havner på hver side av en helg kan gi en
periode på 32–33 dager uten at noe er galt. 35 roper ikke ulv.

**Snittet deler på antall PERIODER, aldri på antall utlegg.** Egen test, fordi de to er lette å
forveksle i en `reduce`.

**En periode uten nyere lønnsdato inngår ikke.** En halv periode ville trukket snittet ned på alle
dager — samme feilform som den vi retter, bare i den andre enden.

## Verifisering

- `npm run check`: 0 feil, 0 advarsler
- `npm test`: 254 filer, 3549 tester (17 nye)
- Prod-tallet som utløste saken (`−53 229 kr` mellom dag 29 og 30) er gjenskapt som test

## Rest

`detectGlobalPayday` mister en lønnsdato. Kappingen gjør at det ikke lenger ødelegger kurven, og
flaten sier fra når det skjer, men **årsaken er ikke funnet.** Det er neste tråd å trekke i dette
domenet.
