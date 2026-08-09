# Tidligere nedgangsperioder

Dato: 2026-08-09
Status: ferdig

## Kontekst

«Samle inn tidligere nedganger og gi meg varighet, samlet nedgang og snitt-tempo.»

Milepælene svarer på *hvor står jeg nå* — laveste trend siden, bratteste 90 dager. De
sier ingenting om **mønsteret**: har jeg gjort dette før, hvor lenge holdt det, og
hvilket tempo klarte jeg? Det er spørsmålet man stiller når man skal ned igjen, og
svaret lå i historikken uten at noe leste den slik.

Med HealthKit-backfillen på plass er grunnlaget nå 2014–2026, ikke bare 2017–2026 — så
spørsmålet har flere perioder å finne enn det ville hatt i går.

## Faser

### Fase 1: Deteksjonen

`$lib/domain/health/weight-declines.ts` — `findWeightDeclines` og `summarizeDeclines`.

### Fase 2: Verktøyet

`queryType: 'declines'` på `query_weight`, registrert på begge flater.

## Beslutninger

**Topp til bunn, med toleranse for tilbakeslag.** En nedgang avsluttes først når trenden
har steget `REBOUND_TOLERANCE_KG` (1 kg) over sitt laveste punkt — ikke ved den første
oppturen. Uten toleransen ville hver lille bølge delt en reell nedgang i tjue biter, og
et platå midt i en nedgang ville avsluttet den. Det er dekket av en test.

**Terskler som holder lista lesbar.** Under 2 kg eller 21 dager telles ikke. En
«nedgang» på 1,2 kg over ni dager er væske, og en liste full av dem gjør de ekte
periodene usynlige.

**Trenden, aldri målingene.** Samme regel som milepælene: rå veiinger spriker et kilo på
væske, og perioder funnet på dem ville vært støy i tilfeldig retning.

**Perioden starter på toppen.** Det ga en test som først så feil ut — en nedgang etter en
oppgang starter på oppgangens siste dag, ikke dagen etter. Det er riktig: toppen er
tidspunktet vekta snudde.

**`longestGapDays` per periode.** Et tempo regnet over et vindu der halvparten av
målingene mangler er ikke observert. Verktøybeskrivelsen ber modellen kvalifisere det
framfor å oppgi tallet bart.

**`averageKgPerWeek` er vektet på varighet.** En periode på ti måneder sier mer om hva
brukeren får til enn en på tre uker, og et uvektet snitt av snittene lar den korte
dominere — de korte er systematisk raskere.

**Perioden som pågår tas med.** Den mangler en opptur på slutten, men å droppe den ville
skjult nettopp den perioden brukeren står i.

## Verifisering

- `npm test` — 2 989 grønne, 14 nye. Dekker platå midt i en nedgang, tilbakeslag over og
  under toleransen, terskler i begge retninger, ren oppgang, hull, pågående periode, og
  vektingen av snittempoet.
- `npm run check` — 0 feil, 0 advarsler. Ingen visuell endring.
- Ikke prøvd mot ekte historikk: at verktøyet svarer er verifisert, hvilke perioder det
  finner i brukerens data ser man først i drift.

## Gjenstår

Ingen flate viser dette — det er foreløpig bare et svar chatten kan gi. Et kort på
Vekt-flaten er neste steg hvis mønsteret er noe man vil se uten å spørre.
