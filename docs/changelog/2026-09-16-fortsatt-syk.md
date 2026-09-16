# Fortsatt syk

Dato: 2026-09-16
Status: ferdig

## Kontekst

Brukeren, på dag 16 av en sykeperiode som fortsatt pågikk, fikk et kort som sa
«Syk?» med en «Jeg er syk»-knapp — og ett varsel:

> Åpen sykeperiode fra 1. sep — over 14 dager uten sluttdato, så den unnskylder
> ikke lenger. **Sett sluttdato**

Den ene handlingen som ble tilbudt er den ene en som fortsatt er syk ikke skal
gjøre. «Jeg er fortsatt syk» fantes ikke som et valg noe sted.

`MAX_OPEN_SICK_DAYS` (14) er en vakt mot bryteren ingen skrudde av — modulens
eget doku-hode sier det: *«Ikke en påstand om hvor lenge folk er syke.»* Men
klokka løp fra `startDate`, altså fra en hendelse som ikke sier noe om hvorvidt
bryteren er glemt. En vakt mot glemsel som ikke kan ta imot et livstegn er en
frist.

Tre ting fulgte av det, alle stumme:

1. **Sykeinnsjekken sluttet å fyre.** `decideSickCheckin` gater på
   `getSickState().active`, og `activeSickPeriod` filtrerer bort foreldede
   perioder. Den ene nudgen som hører hjemme i en sykeperiode («hvordan går
   det?») ble slått av på dag 15 — og dags-nudgene, som gater av på det samme
   flagget, begynte å mase igjen.
2. **Hurtighandlingen på hjemskjermen forsvant**, så svarflaten forsvant med
   den.
3. **Streaks, ukeplan og readiness gikk tilbake til normal drift** for en
   bruker som lå nede.

Og en fjerde, verre: **bortfallet virket bakover.** `resolveSickPeriod` kapper
`effectiveEnd` ved taket nettopp for å si hvor langt perioden rakk, men
`sickDayKeys` gjorde `continue` på hele perioden. Dag 15 fjernet dermed
unnskyldningen for dag 1–14 også. To uker i senga ble to uker brutt streak, med
tilbakevirkende kraft og uten et ord om det.

## Faser

### Fase 1: Taket måles fra siste livstegn

`$lib/domain/health/sick-periods.ts`. `SickPeriod` fikk `confirmedOn`, og
`resolveSickPeriod` regner `openCap` fra `countsFrom` = seneste av startdato og
bekreftelse. En bekreftelse før startdagen eller fram i tid ignoreres — den er
ikke et livstegn for denne perioden, og kan bare komme av en rettet startdato.

Nye felt på `ResolvedSickPeriod`: `countsFrom`, `daysLeft`, `needsConfirmation`.

### Fase 2: Et bortfall gjelder framover

`sickDayKeys` leser `effectiveEnd` framfor å hoppe over perioden. Dagene den
rakk står; den slutter bare å unnskylde nye.

### Fase 3: To kilder til bekreftelse, slått sammen i den ene leseveien

`$lib/server/health/sick-log.ts`. `listSickPeriods` slår sammen `data.confirmedOn`
med den seneste sykeinnsjekken (`sick_level`) datert inne i perioden, og tar den
seneste av dem. Å svare på «hvordan går det?» er et sterkere livstegn enn å
trykke på en knapp, så den som svarer på innsjekkene treffer aldri taket.

Oppslaget gjøres bare når en åpen periode finnes — en lukket periode har en
sluttdato, og taket gjelder ikke den.

`confirmSickPeriod` er den nye skrivingen, motstykket til `endSickPeriod`, og
går gjennom `saveSickPeriod` som alt annet.

### Fase 4: Flaten spør før den ryker, og tilbyr begge svar

`SickStatusCard.svelte`. `needsConfirmation` gir et forvarsel med «Fortsatt
syk»; det foreldede banneret har nå «Fortsatt syk» **først** og «Sett sluttdato»
etter. `describeEpisode` sier det samme på forløpsflaten.

«Jeg er syk»-knappen i hodet skjules mens en foreldet åpen periode står: den
ville opprettet en ANDRE periode fra i dag og latt den gamle ligge åpen.

## Beslutninger

- **`confirmedOn` kommer aldri fra en forespørselskropp.** Skriveveien setter
  den selv; `validateSickPeriod` validerer den bare så et gammelt felt ikke kan
  bære søppel videre. Tre kallsteder som skriver perioden (`PATCH /api/helse/syk/[id]`,
  `/api/tilstand/flag`, `endSickPeriod`) løfter feltet tilbake fra den lagrede
  raden, fordi `data` skrives i sin helhet — samme regel som
  `USER_OWNED_METADATA_KEYS` på øktene. En utplukking som glemmer et felt sier
  ikke fra.
- **`CONFIRM_WARNING_DAYS` er 3.** Nok til at en bekreftelse rekker fram, kort
  nok til at spørsmålet ikke står der halve perioden.
- **Sammenslåingen skjer i `listSickPeriods`, ikke hos kallstedene.** Gjorde de
  det selv, ville en periode vært foreldet ett sted og levende et annet —
  nøyaktig de to sannhetene om «er jeg syk» som gjorde den gamle nå-flagg-rigga
  ubrukelig for streaks.
- **`MAX_OPEN_SICK_DAYS` er ikke hevet.** Taket er riktig som vakt; det var
  målepunktet som var feil. Å heve det ville gjort vakten dårligere uten å løse
  noe — en skade på to måneder ville truffet det igjen.
- **Innsjekken fyrer fortsatt ikke på en foreldet periode.** Det er med vilje:
  vi skal ikke gjenoppta masingen på en periode ingen har bekreftet. Ett trykk
  på «Fortsatt syk» starter den igjen, og deretter holder innsjekkene den i
  live av seg selv.
- **Ingen automatisk lukking, som før.** Et sluttpunkt vi fant på ville vært en
  påstand.

## Verifisering

- `npm run check` — 0 feil.
- `npx vitest run` — 4762 tester i 323 filer grønne. 12 nye i
  `sick-periods.test.ts`, én invariant i `sick-checkin.test.ts`.
- To eksisterende tester endret, begge asserterte den gamle oppførselen:
  `foreldet åpen periode unnskylder ingenting` (nå: beholder dagene den rakk) og
  `sier at den ikke unnskylder lenger` (nå: sier hvor langt den rakk, og spør).
- Invarianten `kadensen mot taket`: tregeste innsjekk-kadens (7 dager) må ligge
  under `MAX_OPEN_SICK_DAYS` (14). Ellers sulter en periode i hjel mellom to
  spørsmål, og den som trofast svarer blir likevel bedt om å bekrefte manuelt.

## Kjent rest

- **Ingen bekreftelse fra chatten.** `confirmSickPeriod` er klar for et verktøy,
  som `saveSickPeriod` har vært siden september.
- **Innsjekk-pushen sier ikke fra om at taket nærmer seg.** Forvarselet bor bare
  på flaten, så den som ikke åpner Helse ser det først når banneret har skiftet.
- **`MAX_OPEN_SICK_DAYS` er fortsatt kort for en skade** i den forstand at en
  skade krever en bekreftelse hver andre uke. Nå er det i det minste en
  bekreftelse man kan gi.
