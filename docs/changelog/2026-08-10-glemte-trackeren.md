# Glemte trackeren: fra automatisk korreksjon til forslag

Dato: 2026-08-10
Status: ferdig i Resonans · Ekko-knappen ikke bygget

## Kontekst

En el-sykkeltur der sporingen ble glemt sto som 9,07 km / 2 t 20 min og fikk **effort 114**
der svaret var ~20. MET-stien er rent lineær i varighet, og økta hadde ingen puls, så det
fantes ingen annen dom. Samme `durationSeconds` priser aktivitetsforbruket i
`energy-expenditure.ts` — ~800 kcal fantomaktivitet — så ett felt forurenset ukas effort,
akutt/kronisk-dommen, dagsforbruket og fuel-nudgen samtidig.

Strava viste samme spor som 27 min 3 s. Distansen var identisk. Hele feilen var tid.

## Den forkastede løsningen, og hvorfor den var feil

Første utgave (PR #295, merget) regnet bevegelsestid automatisk for alle økter og skåret
effort på den. Den ble revet ut igjen samme dag.

Målt mot prod med `dryRun` ville den endret **96 økter** for en feil som skjer et par
ganger i året — og tok feil på de fleste av dem:

| Økt | Opptak | Automatikken sa | Hva det egentlig var |
|---|---|---|---|
| Løping 24. mars | 56 min | 8 min | Sporingen brøt sammen underveis |
| Løping 11. apr | 1 t 3 min | 12 min | Samme |
| Fjelltur 23. juli | 3 t 18 min | 1 t 39 min | Bratt terreng er sakte |

Feilen var ikke i terskler som kunne strammes. Den var i **formen på løsningen**: en
sjelden katastrofe ble behandlet som en systematisk skjevhet. En sveip over historikken
gjør en feilvurdering til noe brukeren må oppdage; et forslag gjør den til noe brukeren
avviser.

Underveis gikk jeg også på et feilspor verdt å skrive ned: jeg leste «hver verdi i
rapporten er et helt antall minutter» som et mønster i dataene. Det var kortets egen
`Math.round(sekunder / 60)`. **Leter du etter et mønster i en rapport, sjekk om rapporten
kan ha laget det.**

Den ekte årsaken fant brukeren ved å åpne økta: splits stopper på 1,25 km og
pulsfordelingen summerer til 7 min 34 s — begge regnet fra nøyaktig de `trackPoints`
beregningen leser. `coverage` fanget det ikke, fordi den måler krediterte intervaller mot
*sporets eget spenn*, ikke mot *økta*.

## Faser

### Fase 1: Ut med automatikken

- `computeWorkoutEffort` skårer igjen alltid på `data.duration`.
- `estimateWorkoutKcal` likeså. `energy-context`, `intraday` og `fuel-nudge` er tilbakestilt.
- `canonical_workouts.moving_seconds` droppes (migrasjon `0054`). `0053` beholdes — den
  kjørte i prod, og en migrasjon som har kjørt skal ikke forsvinne fra historikken.
- Backfill-endepunktet, backfill-modulen og `MovingTimeBackfillCard` er slettet.
- `HealthActivityList` viser opptakstid igjen. Flate og skåring skal aldri kunne si ulike ting.

### Fase 2: Inn med forslaget

`suggestForgottenTracking` i `$lib/domain/health/moving-time.ts` finner der ruta stopper,
og returnerer `{ cutAtIso, keptSeconds, droppedSeconds, droppedShare, family }` — eller
**null**, som er det vanlige svaret.

Forslaget følger med i svaret fra `POST /api/apps/upload`, altså i det øyeblikket det er
oppdagbart: rett etter at økta er lagret.

### Fase 3: Kontrakten mot Ekko

`docs/ekko-glemte-trackeren.md`. Ekko kutter **lokalt** og laster opp på nytt med samme
`sessionId`. Upserten treffer samme rad fordi hale-kutt lar `startTime` stå, og da blir
`data.duration` *sann* — ingen leser trenger å vite at en korreksjon har skjedd.

Det er også den eneste plasseringen som kan rette Apple Helse og Strava i samme
håndbevegelse, som var grunnen til at knappen hører hjemme der og ikke på web.

## Beslutninger

**Kuttpunktet krever vedvarende bevegelse**, ikke bare ett intervall som består portene.
Uten det landet kuttet nede i garasjen: multipath ga en enkelt spike på 4 m/s, og gåturen
inn på kontoret rett etterpå bestod den grove porten — den kommer jo faktisk noen vei. Med
kravet om at over halve det siste minuttet var bevegelse, kuttes både garasjen og gåturen.

**Sykkelterskelen er 2,5 m/s, ikke Stravas ~1,4.** Gange (1,2–1,7) kommer noen vei; ekte
sykling ligger på 4–8. Porten står midt i gapet. Løping har ikke det gapet (rask gange 1,7
mot sliten jogg 1,8), står på 0,7, og kutter derfor ikke en gåtur hjem. Kjent rest.

**Minst 10 minutter og 15 % av økta.** Et forslag på hver tur blir bakgrunnsstøy, og
bakgrunnsstøy blir slått av — samme resonnement som `sendFuelNudge` sin én-per-dag-gate.

**Ingen lagret overstyring.** Korreksjonen skjer ved å kutte sporet, ikke ved å legge et
`durationOverride` ved siden av. Da finnes det bare én varighet, og ingen leser kan komme
til å bruke feil.

**Ingen modellering av tynne eller delvise spor.** Fristelsen er å interpolere. Da hadde vi
konstruert data for å slippe å si «vet ikke».

## Verifisering

- `npm test`: 3076 grønne. Sju nye tester på `suggestForgottenTracking`, blant dem de tre
  tilfellene som må sies nei til: vanlig tur med rødlys, fjelltur i svært lavt tempo, og
  kort hale.
- `npm run check`: 0 feil, 0 advarsler.
- Testen for garasje + gåtur er den som fanget det siste designhullet.

**Ikke gjort:** Ekko-knappen, og de visuelle testene (ingen `DATABASE_URL` i
utviklingsmiljøet). `HealthActivityList` er tilbakestilt til det main hadde før #295, så
piksel-diffen bør være uendret.
