# Sykeperioder: «jeg er syk» som pauser streaks

Dato: 2026-09-02
Status: ferdig

## Kontekst

Brukeren ba om «en måte å sette meg som syk på under helse, som bl.a pauser
streaks», og husket at det fantes en rigg fra før. Den fantes — halvbygget og
begravd.

**Det som fantes.** `POST /api/tilstand/flag` skrev `{ sickUntil, crunchUntil }`
som en `tilstand_flag`-hendelse. `getActiveEgenfrekvensFlags` leste **bare den
nyeste** raden og svarte på «er jeg syk nå». To konsumenter:
`programs/readiness.ts` (`deriveState` → `state: 'rest'`, hopp dagens økt) og
`tracks/readiness.ts`. Og nøyaktig én inngang i UI: bryteren i
`ReadinessStrip.svelte`, som bare rendres på `/treningsprogram/[id]`.

Tre hull:

1. **Bryteren var uåtkommelig fra Helse.** Uten et aktivt treningsprogram framme
   fantes den ikke i appen i det hele tatt.
2. **Streaks visste ingenting om den.** `computeStreak` tok bare hendelsesdager
   og dagens dato.
3. **Og det avgjørende: rigga lagret et NÅ-FLAGG, ikke en periode.** Streaks
   stiller et annet spørsmål — *hvilke dager* var syke — og det kan ikke leses ut
   av en `sickUntil`. Rekonstruksjon fra eventloggen er tvetydig: klarerte du
   flagget kl. 22 på en dag du lå i senga, var den dagen syk eller ikke? Et svar
   som avhenger av klokkeslettet du trykket på en knapp, er ikke data.

## Faser

### Fase 1: Perioder framfor flagg

`$lib/domain/health/sick-periods.ts` (ren, 18 tester). En sykeperiode er en RAD
med `startDate` og `endDate` som kan rettes og slettes — samme form som
dupp-loggen (`updateNap`/`deleteNap`) og livviddeloggen.

Konsekvensen er at man kan melde seg syk **i etterkant** («jeg var syk mandag til
onsdag»), og streaken repareres retroaktivt. Det følger gratis av at streaks
aldri lagres som en teller.

- `endDate: null` betyr «syk inntil videre», og det er defaulten: ingen vet på dag
  én hvor lenge det varer, og den gamle rigga tvang deg til å gjette
  (`defaultUntil(5)`).
- **En åpen periode slutter å unnskylde etter `MAX_OPEN_SICK_DAYS` (14).** Ellers
  ville en glemt bryter unnskyldt alt for alltid, og da måler vi ikke lenger noe.
  Vi lukker den ikke selv — brukeren kan ha vært syk i tre uker, og et automatisk
  sluttpunkt ville vært en påstand. `staleOpen` sier fra, og flaten ber om et
  sluttpunkt.
- **En sluttdato fram i tid unnskylder ikke framtida.** «Jeg regner med å være
  dårlig ut uka» er en gyldig registrering, men onsdag har ikke vært — og en dag
  som ikke har skjedd kan ikke være brutt, altså ikke unnskyldt heller. Samme
  regel som `isFuture` i streak-kalenderen.

Lagring i `sensor_events`, `dataType: 'sick_period'`, på den eksisterende
`tilstand_flag`-sensoren — det ER den samme rigga, bare med en datatype som bærer
en periode. Ingen schema-endring, altså ingen migrasjon.

### Fase 2: Unnskyldte dager i streak-motoren

`excusedDayKeys` som fjerde argument til `computeStreak`. Dagene er
**gjennomsiktige**: rekka hopper over dem uten å bruke av toleransen
(`maxGapDays`), og telleren står stille. «6 dager på rad» er fortsatt 6 når du
blir frisk.

Alle tre reglene:

- **`consecutive_days`** — `findRun` hopper over unnskyldte enheter. Status blir
  `ok`, ikke `due_soon`, når i dag er en sykedag: den krever ingenting.
- **`count_per_window`** — terskelen reduseres FORHOLDSMESSIG av sykedagene i
  perioden (`effectiveWindowThreshold`). Med terskel 2 over sju dager: én sykedag
  krever fortsatt 2, to sykedager krever 1, seks sykedager krever 0 og perioden
  blir gjennomsiktig. Avrundingen er `round`, ikke `floor` — `floor` ville senket
  kravet fra 2 til 1 på den første sykedagen, altså gjort en uke med snue
  merkbart billigere enn den bør være.
- **`max_interval`** — sykedagene SKYVER fristen. Ei uke i senga stjeler en uke
  av intervallet, og en badevask som forfalt under feber skal ikke telles som
  forsømt. Intervallet ER toleransen her, så det er den eneste meningsfulle
  tolkningen av «pause».

`bestCount` senkes ikke av en sykeperiode (`longestRun` er unnskyldnings-bevisst):
historikken skal ikke føles tapt av en grunn brukeren ikke rådde over.

### Fase 3: Flatene

- **`SickStatusCard`** på Helse-mortemaet, over programkortet: er du syk, er det
  den opplysningen som forklarer alt annet på flaten. Én knapp når alt er bra;
  historikk bak en `<details>` for retting og for å legge inn perioder i etterkant.
- **Ukeplanen** merker sykedager med 🤒 på dagstripa (overskriver reise og ferie)
  og bærer en setning som sier hva merkingen BETYR — at uhakede rutiner de dagene
  er unnskyldt.
- **Streak-kalenderen** tegner sykedager skravert, ikke tomme. Ukesraden viser 🤒
  framfor «0 av 2 ✗», og radens fasit bruker den samme reduserte terskelen
  telleren gjør.
- **`StreakCard`** får `excusedDots` — en ring uten fyll, parallelt med `dots`.
- **Effort-budsjettet**: gulvet er 0 og taket `anchor × 0,35` i uka du er syk, og
  sykeuker holdes helt utenfor ankeret.
- **Helsechatten**: `SYKDOM`-seksjonen står ØVERST i briefingen.

## Beslutninger

**Unnskyldt, ikke «teller som holdt».** Alternativet ville gitt «11 dager på rad»
etter fem dager i senga — en streak som påstår noe brukeren ikke gjorde. En
teller man ikke kan stole på er ikke verdt å holde.

**Toleransen (`maxGapDays`) er ikke svaret på sykdom.** Den er per rekke og
brukes opp, så en uke med influensa river en rekke som skulle overlevd en enkelt
glemt dag senere. Sykedager koster derfor ingenting av slingringsmonnet — det
står igjen til den glemte dagen.

**En økt tatt mens man var syk teller som HOLDT, ikke som unnskyldt.**
Unnskyldningen fjerner kravet, ikke kreditten. Uten skillet ville ei uke man
trosset feberen i telt som en uke man ikke trente. Gjelder alle tre reglene, og
kalendercellene.

**Sykeuker holdes utenfor effort-ankeret, i motsetning til hvileuker.** En
hvileuke midt i vinduet teller som 0 — den ER informasjon om normalen din. En
sykeuke er det motsatte: en avbrytelse du ikke valgte, og et anker som tar den med
krever et lavere volum av deg i ukene etterpå enn formen din tilsier.

**Ingen «under ukas plan» i en sykeuke.** Gulvet er 0, så det finnes ikke noe å
ligge under — og «det er rom igjen» ville lest som en oppfordring til å trene med
feber. `describeBudgetStanding` og `training-summary.ts` tar samme avgjørelse, og
de må være enige.

**Over den senkede rammen er fortsatt ikke et helsevarsel.** Budsjettet er et
regnskap; akutt/kronisk er det eneste restitusjonssignalet, og det eneste som får
varselfarge. Sykdom endrer ikke på det — vi måler ikke kroppen.

**Friskmelding setter sluttdato til GÅRSDAGEN, ikke i dag.** «Jeg er frisk» sies
om dagen man våkner uten feber, og den dagen er da ikke lenger en sykedag. Hadde
vi satt i dag, ville en streak-dag brukeren faktisk kunne holdt blitt unnskyldt.

**`/api/tilstand/flag` skriver nå gjennom `sick-log`.** En `sickUntil` skrevet som
et flagg der ville vært en andre sannhet: readiness ville sett den, men streaks,
effort-budsjettet og helsechatten ikke — nettopp den splitten som gjorde det gamle
flagget ubrukelig. Bryteren på programsida er en reell inngang, så endepunktet
beholdes; det skriver bare til den samme stien som Helse-flaten.

**`crunch` er fortsatt et nå-flagg.** Ingen konsument spør hvilke DAGER som var
travle, så en periodemodell for crunch ville vært kode uten en leser.

**Det gamle nå-flagget leses fortsatt, men bare som «er jeg syk nå».**
`getSickState` faller tilbake på nyeste `tilstand_flag`/`egenfrekvens_checkin` med
en `sickUntil` som ikke er passert. Den lager INGEN periode, og unnskylder derfor
ingen streak-dager — vi vet ikke hvilke dager flagget dekket. Flaten sier det i
klartekst framfor å la brukeren tro at streaks er pauset.

**Setningene bor i domenelaget** (`describeSickPeriod`), fordi helsechatten må si
det samme som skjermen — samme grunn som `classifyTsb` ble flyttet ut av
`LoadBalanceCard`.

**Briefingen sier at mekanismen ALT virker.** Uten den setningen gjentar modellen
beroligelsen som om den var noe den fant på, og det er en beroligelse den ikke kan
innfri neste gang. Prompten sier også at det ikke finnes et verktøy for å sette
sykdom, så modellen viser til knappen framfor å tilby det.

## Verifisering

- `npm test`: 4117 tester i 287 filer, alle passerer. 40 nye — 18 på
  `sick-periods`, 13 på unnskyldte dager i de tre streak-reglene, 3 på
  sykeuke-budsjettet, 3 på ordene, 3 på kalenderen.
- `npm run check`: 0 feil, 0 advarsler.
- `npm run build`: grønn (med attrapp-env i analyse-steget, som Dockerfilen gjør).
- **Ikke kjørt:** `npm run test:visual`. Den krever `DATABASE_URL` og en dev-server
  med ekte data; miljøet endringen ble skrevet i hadde ingen base. Kortet på Helse,
  ukeplan-banneret og de skraverte kalendercellene er altså ikke piksel-verifisert.

## Kjent rest

- **Ingen chat-inngang.** Man kan ikke si «jeg har vært syk siden mandag» og få
  det registrert; prompten viser til knappen. Et `manage_sick_period`-verktøy
  ville vært en naturlig neste ting, og skrivestien er alt klar (`saveSickPeriod`).
- **Nudges ble bevisst holdt utenfor** denne runden. `fuel-nudge`,
  `writing-nudge` og øktvarslene maser videre gjennom en sykeperiode.
- Målprogresjon og `computePaceEstimate` vet ikke om sykdom: et vektmål ligger
  «bak skjema» like fullt.
- Autohakingen (`checklist-autocheck.ts`) er urørt — den haker AV mot sensordata
  og har ingen «uteblitt»-tilstand å unnskylde. Ukeplanen merker dagene i stedet.
- `crunch` har ingen inngang fra Helse; den bor fortsatt bare på programsida.
