# HRV i forløpet — og diagnosen for hvorfor raden er tom

Dato: 2026-09-10
Status: ferdig (diagnosen er bygget, årsaken er ikke funnet ennå)

## Kontekst

Brukeren observerte at HRV «også lider» — sett i Health Mate, midt i et
pågående sykdomsforløp.

To ting følger av det, og de peker motsatt vei:

1. **HRV hører i sykdomsforløpet.** Det er nøyaktig den slags signal
   forløpsvisningen finnes for, og det manglet.
2. **Vi kan ikke vise det.** CLAUDE.md har siden 4. august sagt at HRV
   **aldri** har produsert data i prod (15 netter søvn, 0 med HRV) og at
   årsaken ikke er funnet.

At Health Mate viser en kurve er et NYTT datapunkt i den gamle saken: dataene
finnes hos Withings. Det utelukker «enheten måler det ikke i det hele tatt» som
forklaring, og flytter feilen inn i synken vår — eller i hva vi ber om.

## Faser

### Fase 1: HRV som rad i forløpet

`$lib/server/health/sick-episode.ts` leser `physiology.hrvNights`, som
`readNightlyPhysiology` alt returnerte. Raden filtreres bort så lenge det ikke
finnes målinger, så den koster ingenting i dag og tenner av seg selv den dagen
synken virker.

### Fase 2: `notableDirection` erstatter `risingIsNotable`

Feltet var en boolean fram til nå, og det holdt bare fordi alle radene som
skulle markeres pekte samme vei (puls opp, temperatur opp). HRV er den første
der **fallet** er signalet.

### Fase 3: Diagnosen

`GET /api/sensors/withings/debug/hrv?nights=5`, i samme familie som
`debug/coverage` og `debug/probe`.

## Beslutninger

- **HRV vises som AVVIK, aldri absolutt** (`absoluteIsMeaningless: true`).
  «Absoluttverdien vises ALDRI alene» er regelen fra `hrv.ts`: SDNN varierer for
  mye mellom folk, og det finnes ingen normtabell. Flagget håndhever den
  mekanisk — uten baseline sier raden det, framfor å skrive «42 ms» som om
  tallet betydde noe i seg selv. Samme behandling som hudtemperatur, av samme
  grunn.
- **`notableDirection: 'up' | 'down' | null` framfor en boolean.** En boolean
  kunne bare uttrykt HRV riktig ved å invertere betydningen for den ene raden,
  og det er nøyaktig den stille inversjonen `computePaceEstimate` gikk på:
  «tonen følger målretningen, ordet følger verdien». Retningene nå: dagpuls,
  sovepuls, temperatur og hudtemperatur `up`; søvn og HRV `down`; nivå og vekt
  `null`.
- **Vekt og nivå markeres IKKE.** Nivået ER forløpet, ikke et avvik fra det. Og
  vektraden bærer alt `WEIGHT_CAVEAT` — en farge i tillegg ville lest som en dom
  om et tall vi nettopp har sagt ikke er sammenlignbart.
- **Diagnosens første variant er byte-identisk med `syncSleepHrv`.** Samme
  vindu fra `nightFetchWindow`, samme `data_fields: 'sdnn_1'`. Uten den ville et
  treff i en av de andre variantene vært et utsagn om VINDUET framfor om FELTET,
  og vi hadde flyttet spørsmålet i stedet for å svare på det.
- **Den rapporterer NØKLENE, ikke bare verdiene.** Dette er hovedpoenget.
  `syncSleepHrv` sier i dag bare `unavailable++`, og «enheten leverte ikke» og
  «vi ba om feil felt» ser identiske ut derfra. Et svar som sier «segmentene
  inneholder hr, rr, snoring — ingen sdnn_1, ingen rmssd» avgjør saken; «0
  sdnn_1-verdier» gjentar spørsmålet.
- **`hr` er kontrollen.** Vi VET at `hr` kommer tilbake fra `action=get` —
  `backfillSleepHrForDate` bruker den. Kommer `hr` men ikke `sdnn_1` i samme
  kall, er det feltet som mangler, ikke vinduet, tokenet eller natta.
- **`rmssd` prøves ved siden av**, fordi det er det andre HRV-feltet Withings
  dokumenterer for `action=get`. Om det er det Health Mate viser, vet vi ikke —
  og det er en HYPOTESE, ikke en konklusjon, på nøyaktig samme måte som
  meastype-kartet for temperatur. Derfor en probe framfor en kodeendring:
  dokumentasjonssida er ikke wire-formatet.
- **Modellen som registrerte natta hentes fra `getsummary`.** Hvilken enhet som
  skrev en søvnrad finnes ikke noe sted i vår base, og «måler denne modellen
  HRV» er en helt annen forklaring enn «vi ber om feil felt». Feiler kallet,
  står resten — enhetsnavnet er en bonus, ikke svaret.
- **Lesenøkkelen står i SVARET, ikke bare i koden.** Den som åpner et
  diagnoseendepunkt har som regel ikke lest modulkommentaren.
- **Fila står i `knownRawReaders`**, med begrunnelsen over: den må sende
  nøyaktig samme kall som synken. Reglene den kunne brutt følges likevel —
  `nightKeyForTime` for nattbøtta, `isNap`-filteret for dupper.

## Verifisering

- `npm run check` — 0 feil.
- `npx vitest run` — 4709 tester i 322 filer, grønne. Én ny test dekker at en
  fallende rad får negativt avvik og aldri skriver råtallet.
- `npm run build` — grønn.
- **Ikke verifisert:** diagnosen har ikke kjørt mot Withings. Den er skrevet ut
  fra hva `syncSleepHrv` sender, ikke ut fra et observert svar — hele poenget er
  at ingen har sett svaret ennå.

## Neste steg

Kjør `GET /api/sensors/withings/debug/hrv?nights=5` innlogget og les `keys` per
variant:

- `hr` kommer, `sdnn_1`/`rmssd` fraværende → enheten leverer ikke HRV i
  `action=get`. Synken er ikke feil, den er blind, og HRV må hentes en annen vei.
- `rmssd` kommer, `sdnn_1` ikke → vi ber om feil felt. Én linje i
  `fetchNightHrv` og et felt i `parseSleepHrvSeries`.
- Nøkkelen finnes men `values` er 0 → serien er tom for natta; da er
  `unavailable` en ærlig rapport og spørsmålet er hvorfor Health Mate viser noe.
- Status ≠ 0 → Withings avviser kallet, og feilteksten står i svaret.

## Kjent rest

Årsaken er ikke funnet — dette er verktøyet for å finne den, ikke funnet selv.
HRV-raden i forløpet er tom til den er funnet, og filtreres derfor bort.
