# Symptomer, temperatur og «hvordan går det?»

Dato: 2026-09-02
Status: ferdig

Bygger på `2026-09-02-sykeperioder.md`, som gjorde sykdom til en periode som
pauser streaks.

## Kontekst

Brukeren formulerte innsikten som avgjorde modellen:

> «Nå har vi jo satt statusen "syk" (egentlig en proxy for "ute av stand til å
> løpe"). Akkurat nå har jeg vondt i halsen, slimhoste og samtidig har jeg et
> litt ømt kne, men det er luftveisinfeksjonen som gjør at jeg holder senga.»

Tre ting følger av det, og alle tre gjorde symptomer umulige å presse inn som
felter på sykeperioden:

1. **Flere samtidig.** Tre rader, ikke ett felt.
2. **Bare én holder deg i senga.** Kneet er der, men infeksjonen er grunnen.
3. **De overlever perioden, og finnes uten den.** Et ømt kne varer lenger enn
   infeksjonen, og et vondt ankel finnes når du ellers er frisk — det er nettopp
   da det betyr noe for hva du kan trene.

Underveis kom det også fram at vi har **to** temperaturkilder (Withings Thermo
over wifi, og klokka som måler kontinuerlig-ish), og at det burde finnes en
oppfølging mens perioden står.

## Faser

### Fase 1: Hvilepuls hadde to lesninger, og signalet leste feil felt

Før noe kunne drive et sykdomsforslag måtte dette rettes.
`resting_hr_elevated_7d` (`signal-service.ts`) hadde sin egen SQL som brøt alle
tre reglene nattfysiologien har:

- Den leste **`hr_average`**, som `sleep-heart-rate.ts` sier eksplisitt IKKE er
  hvilepulsen — snittet blander inn REM og oppvåkninger og ligger 5–10 slag
  høyere.
- Den tok med **dupper** som netter (`isNap` ble ikke filtrert).
- Den **snittet segmenter** framfor å ta minimum, mens en natt normalt har flere
  segmenter fordi Withings deler den når man er ute av senga.

Søvn-flaten og signalet svarte altså ulikt på «hva er hvilepulsen din», og begge
sto synlig på helseflatene. `readNightlyPhysiology` er flyttet ut av
`sleep-dashboard.ts` til `$lib/server/health/nightly-physiology.ts`, og begge går
nå gjennom den. `signal-service.ts` er ute av `knownRawReaders` for `sleep`.

**Konsekvens:** `value_number` på lagrede signaler fra før rettelsen er på en
annen skala (regnet på snittpuls). Retningen er sammenlignbar, nivået ikke.

### Fase 2: Symptomer som egen logg

`$lib/domain/health/symptoms.ts` (rent, 19 tester) +
`$lib/server/health/symptom-log.ts`. En rad per symptom, `dataType: 'symptom'`,
med `label`, `kind`, `severity`, `startDate`/`endDate` og **`limiting`** — det
siste er feltet som gjør sykeperioden presis: det sier HVORFOR du er ute.

Koblingen til en periode er ren datooverlapp (`symptomsDuringPeriod`), ikke en
lagret fremmednøkkel. Kneet som startet under infeksjonen og varer to måneder
etter «tilhører» ikke perioden i noen meningsfull forstand.

### Fase 3: To temperatursignaler, holdt fra hverandre

`$lib/domain/health/temperature.ts` (rent, 14 tester) + `syncTemperatureData` i
Withings-synken + `$lib/server/health/temperature-log.ts`.

- **Termometeret** (Thermo) er kjernetemperatur — absolutt, 38,9.
- **Klokka** er hudtemperatur på håndleddet, flere grader lavere, og oppgis
  **bare som avvik fra brukerens eget snitt**.

Egne datatyper (`body_temperature` / `skin_temperature`), aldri én
«temperature».

### Fase 4: «Er du syk?», spurt av tallene

`$lib/domain/health/illness-hint.ts` (rent, 11 tester) +
`$lib/server/health/illness-hint.ts`. Sovepuls ≥7 slag eller hudtemperatur
≥0,5 °C over egen baseline i ≥2 netter på rad → et spørsmål på Helse-flaten, med
`since` = første natt avviket startet. Sier brukeren ja, backdateres perioden dit
og streaks repareres bakover.

### Fase 5: «Hvordan går det?» mens perioden står

`$lib/domain/health/sick-checkin.ts` (rent, 12 tester) +
`$lib/server/sick-checkin.ts` + `/api/cron/sick-checkin` (hver time).

Spør **konkret** om symptomene som pågår («Sist meldte du vondt i halsen og
slimhoste. Bedre, uendret eller verre?»), og svaret er ett trykk per rad på
kortet.

## Beslutninger

**Symptomer er sin egen logg, ikke felter på perioden.** De tre egenskapene over
gjør det umulig å modellere som felter. Samme forhold som mellom en økt og en
tur: to ting med hver sin levetid, koblet der de faktisk møtes.

**Alvorlighet er tre nivåer, ikke ti.** Sultskalaen (1–5) virker fordi den er
DAGLIG — `predictHunger` krever fem observasjoner og to sterke, og får dem på ei
uke. Symptomer under sykdom er kanskje fire målinger per forløp og to-tre forløp
i året; en 1–10-skala ville aldri blitt kalibrert mot brukerens egne svar, så en
7 i mars og en 7 i november ville ikke betydd det samme. Tre nivåer trenger ingen
kalibrering fordi ordene bærer betydningen selv: «litt», «merkbart», «mye».

**De to temperaturkildene slås ALDRI sammen.** Slått sammen ville serien hatt
34,2 og 38,9 side om side, og hver trend over den vært tull. Det er samme felle
som `hr_min`/`hr_average` (fase 1) og meastype 6/8 (fettPROSENT lagret som
`fatMass` og lest som kilo) — begge kostet en gal visning i prod. Derfor er
kilden en del av datatypen, ikke et valgfritt metadatafelt.

**Hudtemperatur vises aldri som et absolutt tall.** Det finnes ingen normtabell
for håndleddstemperatur, og tallet ser autoritativt ut uten å være det. Retningen
er som HRV og sovepuls: siste måling mot egen baseline, ikke beste observasjon.

**Kartet meastype → størrelse er en HYPOTESE.** Vi vet hva Withings kaller
typene (12 «Temperature», 71 «Body Temperature», 73 «Skin Temperature»), ikke
hvilken enhet som poster hvilken. Synken logger antall per type ved hver kjøring
og forkaster verdier utenfor plausibilitetsspennet med rå-verdien i loggen. Samme
framgangsmåte som meastype 123 ble bekreftet med. **Ikke tolk hardere før loggen
har bekreftet kartet.**

**Temperatur måtte ha sitt EGET kall.** `parseWeightData` filtrerer gruppene på
`MEASTYPE.weight`, så en temperaturmåling — som ikke har vekt i gruppa — ville
blitt kastet i sin helhet, stille. Samme grunn som VO2max har sitt eget kall.

**Forslagets terskel er høyere enn flatens.** `NOTABLE_DEVIATION_BPM` (5) er
«verdt å se på» på et kort du alt har åpnet; et forslag dytter seg på deg, så det
må klare en høyere lut eller bli bakgrunnsstøy. Derav 7 slag og kravet om to
netter — én natt er en sen kveld.

**Forslaget nevner hard trening som den andre forklaringen.** Vi kan ikke skille
sykdom fra en hard uke, og å late som ville gjort et forslag brukeren avviser til
en påstand hen må korrigere — og neste gang ville hen ikke trodd på det.

**Oppfølgingen er den ENESTE nudgen som skal gå i en sykeperiode.** De andre
maser om å gjøre noe, og det er feil når man ligger nede. Denne spør hvordan du
har det, og det blir mer relevant av tilstanden, ikke mindre.

**Kadensen faller av.** Daglig → hver 2. → hver 4. → ukentlig. Et spørsmål hver
dag i tre uker er ikke omsorg, det er mas — og mas blir slått av. En influensa
får fire-fem spørsmål; en skade som varer i to måneder får ikke seksti.

**Ingen oppfølging på dag 1.** Du registrerte deg som syk i dag; du vet hvordan
det går. Et spørsmål samme dag leser som at appen ikke fikk det med seg.

**Et symptom markeres som over med sluttdato I DAG, en sykeperiode med
GÅRSDAGEN.** Skillet er hva de gjør: perioden UNNSKYLDER dager, så én for mye
koster en streak-dag brukeren kunne holdt. Et symptom beskriver bare.

**Symptomer og temperatur går i briefingen med et eksplisitt tolkningsforbud.**
Det er en grense, ikke et forbehold: en klinisk form drar en språkmodell hardt
mot triage. Loggen er brukerens journal — noe hen kan sammenligne forløp med og
vise en lege — ikke et grunnlag for en vurdering vi ikke har dekning for. Vi
måler ingenting her; brukeren har skrevet det selv.

**Ingen smerteskala 1–10.** Vurdert og forkastet av kalibreringsgrunnen over.
`note` på perioden dekker fritekst, og `severity` dekker retningen.

## Verifisering

- `npm test`: 4177 tester i 291 filer, alle passerer. 60 nye — 19 på symptomer,
  14 på temperatur, 12 på oppfølgingen, 11 på forslaget, og fire i briefingen.
- `npm run check`: 0 feil, 0 advarsler.
- `npm run build`: grønn (med attrapp-env i analyse-steget, som Dockerfilen gjør).
- `sensor-event-access.test.ts` passerer med `signal-service.ts` fjernet fra
  `sleep`-lista.
- **Ikke verifisert mot ekte data:** temperatursynken har aldri kjørt mot
  Withings herfra (miljøet har ingen `DATABASE_URL` og ingen tokens), så kartet
  meastype → størrelse er ubekreftet, og vi vet ikke om kontoen har
  temperaturmålinger i det hele tatt. Loggingen er bygget for nettopp det.
- **Ikke kjørt:** `npm run test:visual` — krever database og dev-server med ekte
  data. Kortet er altså ikke piksel-verifisert.

## Kjent rest

- **Temperatursynken må bekreftes mot prod.** Kjør en synk, les
  `[temperatur] Målinger per meastype`-linja, og bekreft mot Health Mate før noe
  tolkes hardere. Er kartet feil, er det den ene linja som må endres.
- **Muskel/skjelett-skillet lagres, men brukes ikke.** Et vondt ankel betyr
  oftest «kan ikke løpe, kan sykle» — en substitusjon, ikke en unnskyldning.
  `generateSessionAlternative` finnes i readiness-motoren og er den naturlige
  koblingen, men den er ikke gjort.
- **`MAX_OPEN_SICK_DAYS` (14) er kort for en skade.** En belastningsskade som
  varer i to måneder blir `staleOpen` etter to uker og slutter å unnskylde.
  Brukeren kan forlenge, men det er en påminnelse hen ikke burde trengt.
- **De øvrige nudgene er fortsatt ikke gatet på sykdom.** `fuel-nudge`,
  skrivenudgen og øktvarslene maser videre.
- **Ingen chat-inngang** for hverken sykeperioder eller symptomer. Skrivestiene
  (`saveSickPeriod`, `saveSymptom`) er klare for verktøy.
- Kjerne­temperatur har ingen graf; bare siste og høyeste vises. Hudtemperatur har
  ingen kurve på Søvn-flaten, der den hører sammen med HRV og sovepuls.
- Oppfølgingen kan bare besvares på flaten, ikke fra varselet — et interaktivt
  svar i pushen ville spart et trykk.

## Etterspill 3. september: nudgen manglet en svarflate

Brukeren fikk oppfølgingen og oppdaget hullet med én setning: «den ligger ikke som
Hurtighandling på hjemskjermen». Riktig — pushen ble bygget, men ingen
`ActionProducer`. Konsekvensen er verre enn en manglende snarvei: **et spørsmål
som bare finnes i et varsel er borte i det øyeblikket varselet sveipes bort**, og
da kan det ikke besvares i det hele tatt. Friskmeldingen lå dessuten to
navigasjoner unna.

`sickCheckinProducer` (`action-producers/sick-checkin.ts`) med beslutningen rent i
`decideSickChip`:

- **Chipen er ikke nudgen.** Pushen er tids- og kadensegatet med vilje; chipen
  står så lenge perioden gjør, på en skjerm brukeren selv har åpnet. Samme skille
  som `screen-time-onboarding`-chipen, som står til oppgaven er gjort.
- **To tilstander.** Sendt og ubesvart → «Hvordan går det?» (prioritet 85, samme
  ord som pushen). Ellers → «Syk · dag 3» (prioritet 50). Begge fører til samme
  kort.
- **«Besvart» måles mot `createdAt`, aldri `timestamp`.** På et symptom er
  tidsstempelet STARTDAGEN, så et symptom registrert i etterkant ville sett ut som
  et svar som kom før spørsmålet.
- **Sammenligningen er tidspunkt mot tidspunkt, ikke «sendt i dag».** En ubesvart
  oppfølging fra i går kveld er fortsatt ubesvart i dag.
- Kun en ekte periode med kjent startdag gir chip — samme gate som pushen, så de
  to er enige om når spørsmålet finnes.

**Og en utilsiktet bug funnet på veien:** `PRODUCER_NAMES` i
`action-suggestion-service.ts` var en parallell array «holdt i samme rekkefølge
som PRODUCERS», og den hadde drevet — `hodedump` manglet, så alt fra indeks 4 og
utover ble perf-logget under NABOENS navn, og den siste produsenten som
`undefined`. En treg `retning-kvartal` var altså umulig å finne i loggen. Navnet
bor nå på oppføringen (`{ name, produce }`), en form som ikke kan drive.

Verifisering: 4202 tester (6 nye), `npm run check` og `npm run build` grønne.
`npm run test:visual` fortsatt ikke kjørt.

## Etterspill 3. september, del 2: innsjekken som en flyt

«'Hvordan går det?' lander bare på helse-temaet» — riktig, og en navigasjon til
et kort blant mange lar spørsmålet stå ubesvart. Brukeren foreslo en flowsheet
med slider og en kort sykeprat, med søvn/HR/temp som kontekst: «ikke for
diagnostisering og villedning».

`sick_checkin` (`$lib/flows/sick-checkin.ts`), bygget av en fabrikk som
egenfrekvens-slotten fordi symptomlista og forløpsdagen ER innholdet.

### Nivå framfor retning — «eller»-en i spørsmålet

Brukeren tilbød begge («'dårlig-frisk' eller 'verre-bedre'»). De er ikke
likeverdige:

- **«Verre eller bedre?»** er det du VET når noen spør. Men det kan ikke
  plottes, og feilen akkumulerer: tre «bedre» på rad fra et lavpunkt er fortsatt
  et lavpunkt. Om fjorten dager kan ingen si hvor du lå.
- **«Hvor dårlig er du?»** er sammenlignbart gjennom hele forløpet OG mellom
  forløp — «forrige influensa lå jeg på 2 i fire dager».

Og retningen er ikke tapt: den er `nivå nå − nivå sist`. **Ett spørsmål gir
begge svar**, og retningen SIES («Ett hakk opp fra i går») framfor å spørres om.
Samme grep som egenfrekvens, der `level` lagres og `balance` utledes.

### Tallene etter slideren, ikke før

Den viktigste beslutningen i flyten. Sovepuls og hudtemperatur ligger i steg 2.
Vises de først, **ankrer de selvrapporten** — og den er det eneste signalet ingen
sensor kan hente. Samme regel som `log_hunger`, der modellen ikke får gjette at
«dritsulten» er en 5 fordi skalaen er kalibrert mot brukerens egne svar. Et
ankret nivå ødelegger nettopp den kalibreringen.

Tallene er SETNINGER fra domenelaget med kilde navngitt, aldri rå verdier, og
uten en dom.

### Tre steg

1. Slider 1–5 «elendig → frisk», `autoAdvance`, ingen tall rundt seg.
2. `decision-list` over pågående symptomer: bedre / uendret / verre / over.
   Ledeteksten bærer den utledede retningen først, deretter tallene.
3. «Noe nytt?» — fritekst symptom + notat, med `secondaryAction` «💬 Snakk om
   det».

Praten er en `secondaryAction`, ikke et fjerde steg — «kort innsjekk» er kravet,
og det er nøyaktig hva egenfrekvens gjør med «Fortsett i chat». Symptomsteget
droppes helt når det ikke finnes symptomer: et steg som ber om ingenting er verre
enn ingen steg.

### Beslutninger

**`level 5` avslutter perioden.** Sier du «frisk», er det unaturlig å måtte finne
kortet på Helse. Innsjekken er stedet forløpet faktisk ender; sluttdatoen er
fortsatt `endSickPeriod` sin (gårsdagen).

**Én skrivevei for hele innsjekken** (`POST /api/helse/syk/innsjekk`). Halvveis
lagret er verre enn ikke lagret — en flyt som feiler på steg tre skal ikke
etterlate nivået skrevet og symptomene urørt. Retningene skrives gjennom
`saveSymptom`/`endSymptom`, altså de samme funksjonene kortet bruker.

**`lastSickLevel` holder dagens egne målinger utenfor.** «Ett hakk opp fra i går»
skal sammenligne med i går, ikke med svaret man ga to timer siden — en andre
innsjekk samme dag er en retting, ikke en ny observasjon.

**Et avvist nytt symptom velter ikke innsjekken.** Nivået er alt skrevet;
feilen returneres som `newSymptomError` framfor å forsvinne.

### Utvidelser den krevde

**`buildPrompts` gjelder nå ALLE stegtyper.** Den var chat-only, så et form-
eller listesteg kunne ikke si noe som avhenger av svaret brukeren nettopp ga —
og den utledede retningen krevde nettopp det. Alle fjorten eksisterende brukere
er chat-steg, så endringen er atferdsnøytral for dem. `systemPrompt` leses
fortsatt bare av chat.

**`decision-list` nøkler på punktets TEKST, ikke på id.** Etikettene snapshotes i
`symptomLabels` i samme rekkefølge som symptomene og mappes tilbake på indeks —
to symptomer med samme ordlyd ville kollidert på tekst alene.

**Sovepuls manglet i `buildSickPayload`** og er lagt til gjennom
`loadSleepHeartRate`, altså den samme ene lesningen.

Verifisering: 4272 tester (25 nye), `npm run check` og `npm run build` grønne.
`npm run test:visual` fortsatt ikke kjørt — flyten er ikke piksel-verifisert.
