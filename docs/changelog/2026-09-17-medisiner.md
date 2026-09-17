# Medisiner

Dato: 2026-09-17
Status: ferdig

## Kontekst

Forløpsflaten har en tidsakse for hva som skjedde MED kroppen — nivå, vekt,
puls, søvn, temperatur, bevegelse — og ingenting om hva som ble GJORT med den.

Nivået er ryggraden nettopp fordi det er det eneste signalet som kan si «jeg ble
bedre og så dårligere igjen». Men når kurven snur, sier ingenting hvorfor, og en
kur startet dagen før er den mest sannsynlige forklaringen som finnes.

Brukeren gikk på to medisiner med «litt ulik forventet effekt og rytme», og
ingenting i repoet kunne registrere dem.

## Faser

### Fase 1: En kur er en periode, en dose er en hendelse

`$lib/domain/health/medications.ts`. Samme todeling som sykeperiode mot symptom,
og sykeperiode mot nivå-innsjekk.

### Fase 2: Rytmen er et strukturelt skille

`fast` og `ved_behov` stiller ULIKE spørsmål, og det avgjør hva en dag SER UT som:

- **`fast`**: planen sier hvor mange doser dagen har, så dagen er en rekke SLOTS
  man haker av.
- **`ved_behov`**: ingen plan, ingen slots. Dosene legges til fortløpende, og
  ANTALLET per dag er det som betyr noe.

### Fase 2b: Dosekalenderen — og en rettet feilprioritering

**Første utgave logget ikke doser på faste kurer i det hele tatt**, med den
begrunnelsen at antallet er gitt av planen. Det var feil, og feilen lå i
rammingen: valget ble lagt fram som en avveining mot å se sammenhenger med
symptomer, mens brukeren var ute etter en **dosekalender**. Da er det motsatt —
det er nettopp den faste kuren som har slots å hake av, og uten dem finnes ingen
kalender.

- **`schedule` som fritekst er erstattet av `times: string[]`** («HH:MM», Oslo).
  Uten klokkeslett kan ingen slot ORDNES, og da finnes verken «neste dose» eller
  en felles tidslinje for to medisiner med ulik frekvens — som er hele poenget.
  Flaten sender et ANTALL og serveren slår opp `DEFAULT_TIMES`, så ingen må
  skrive klokkeslett for hånd; de kan rettes etterpå.
- **`nextDose` fletter kurene på én akse.** Det er spørsmålet man har med to
  medisiner på ulik frekvens, og kortet leder med det.
- **`buildMedicationDay` gir dagens slots med status.**

### Fase 3: Skrive- og leseveien

`$lib/server/health/medication-log.ts`, endepunktene under `/api/helse/medisiner`.
To datatyper på den eksisterende `tilstand_flag`-sensoren: `medication` og
`medication_dose`.

### Fase 4: Flatene

`MedicationCard` på Helse, rett under sykestatusen. Kurene som spenn på
forløpets tidsakse (`buildMedicationBars`), med doser per dag tegnet oppå for
ved-behov. Pågående kurer i helsebriefingen, med et eksplisitt tolkningsforbud.

## Beslutninger

- **Vi sier ALDRI om en kur virket**, og grunnen er statistisk framfor forsiktig:
  en infeksjon går over av seg selv, så HVA SOM HELST startet midt i forløpet ser
  virksomt ut. n = 1, ingen kontroll, konfundert av det naturlige forløpet. En
  effektdom her ville vært den andre «for mye»-dommen CLAUDE.md advarer mot, og
  den ville lest som et medisinsk råd. Briefingen sier det som en egen regel, og
  en test krever setningen.
- **Ingen doseringssjekk, ingen interaksjoner, ingen påminnelser.** Den siste er
  ikke bare utenfor scope: repoets påminnelser er slots på ukelista, ikke push,
  og en medisinpåminnelse som svikter stille er verre enn ingen. `schedule` er
  derfor FRITEKST — et strukturert intervall ville invitert til et varsel vi ikke
  leverer.
- **`purpose` er brukerens egne ord**, ikke en kategori vi validerer mot. Samme
  begrunnelse som `annet` blant symptom-typene: en tvungen kategorisering er
  verre enn en åpen.
- **`slot` sies av flaten, aldri utledet av klokka.** «Jeg tok morgendosen først
  kl. 11» er helt vanlig, og en nærmeste-slot-gjetning ville da fylt
  formiddagssloten og latt morgenen stå som glemt — altså gjort loggen gal i
  akkurat det tilfellet den finnes for å fange. En slot som ikke står i planen
  avvises med 400 framfor å skrives stille: raden ville ellers stått i basen uten
  en rad å stå i på kalenderen.
- **`due` mot `missed` er skillet mellom en dag som er omme og en som ikke er
  det.** En dose kl. 20 er ikke glemt kl. 10. Samme regel som `accumulates` på
  skritt og `frameDay` i ernæringen.
- **En FORFALT dose er ikke «neste».** Ellers ville linja stått fast på en glemt
  morgendose resten av dagen og aldri pekt på den som faktisk kommer; den glemte
  vises som «klar nå» i stedet.
- **To hakinger på samme slot er ett feiltrykk, ikke to doser.** Den første står,
  den andre blir en ekstradose — ellers kunne en dobbelttrykk se ut som en dose
  brukeren aldri tok.
- **En fast kur uten klokkeslett avvises.** Uten tider har dagen ingen slots, og
  en halvferdig registrering ville sett ut som en flate som ikke virker.
- **`0` inne i kuren er en MÅLING, `null` utenfor er fravær av en.** Motsatt av
  ernæringsregelen («hull er null, aldri 0»), og det er med vilje: en dag uten
  doser inne i kuren er en dag du ikke trengte den, og det ER signalet. Blandes
  de to, leses «ikke trengt den» som «ikke logget» og bedringen forsvinner ut av
  raden.
- **Ingen foreldelse, i motsetning til sykeperioden.** En åpen sykeperiode
  UNNSKYLDER streak-dager, så en glemt bryter har konsekvenser og må ha et tak.
  En åpen kur beskriver bare, og en fast medisin man går på i årevis er normal.
  Et tak her ville vært en påstand om at behandling er midlertidig.
- **Avslutning setter sluttdato til I DAG**, i motsetning til sykeperiodens
  gårsdag. Skillet er hva de gjør: perioden unnskylder dager, så én for mye
  koster en streak-dag; en kur beskriver, og «siste dagen jeg tok den» er dagen
  du tar den siste dosen. Samme regel som et symptom som markeres over.
- **En sluttdato fram i tid er LOV**, i motsetning til på sykeperioden: «kuren
  varer ut uka» er en faktisk opplysning fra resepten, og den unnskylder
  ingenting. `resolveMedication` teller uansett aldri dager som ikke har vært.
- **Koblingen kur↔sykeperiode er datooverlapp**, ikke en fremmednøkkel — som
  `symptomsDuringPeriod`. En blodtrykksmedisin man går på i årevis «tilhører»
  ikke denne influensaen.
- **Dagens dag holdes utenfor doseTELLINGEN på forløpet** (`accumulates`-regelen
  fra skritt), men kortet på Helse viser dagens teller live. To ulike spørsmål om
  de samme radene: «har jeg tatt den i dag» mot «hva er mønsteret».
- **Kurbjelken tegnes kromafritt.** Den er kontekst for radene over, ikke et
  signal i seg selv, og en kulør ville lest som en dom om behandlingen. Samme
  begrunnelse som normalbåndet.

## Verifisering

- `npm run check` — 0 feil.
- `npx vitest run` — 4828 tester i 325 filer grønne. 58 i `medications.test.ts`
  (21 av dem på kalenderen), 4 i `medication-log.test.ts`, 4 i
  `health-briefing.test.ts`.
- `npm run build` — grønn.
- **Vakten mot dagsstempling er verifisert ved å innføre feilen**: byttet
  `timestamp: now` med `new Date(\`${day}T12:00:00Z\`)`, og to tester feilet. En
  vakt som ikke kan feile er ingen vakt.

## Kjent rest

- **Ingen chat-inngang.** `saveMedication`/`logMedicationDose` er klare for
  verktøy, men et `log_medication_dose` ville vært det naturlige neste — en dose
  logges gjerne mens man holder telefonen av andre grunner.
- **Ingen påminnelser**, se beslutningene.
- **En dose kan angres, men ikke flyttes.** Tok du morgendosen og haket av feil
  slot, må den angres og hakes av på nytt.
- **Ingen varsling.** Kalenderen sier «neste kl. 14», men ingenting banker på.
  Det er samme grense som før: repoets påminnelser er slots på ukelista, ikke
  push, og et varsel som svikter stille er verre enn ingen.
- **Klokkeslettene kan ikke rettes fra kortet ennå** — bare settes ved
  opprettelse (gjennom antallet). `PATCH` tar `times`, så veien er kort.
- **Forløpsflaten viser doser, men ingen setning oppsummerer dem.**
  `describeDoseUse` finnes og er testet, men ingen flate kaller den ennå.
- **`weight-nugget.ts` vet fortsatt ikke om sykeperioder**, og nå heller ikke om
  kurer — en rekord satt under en kur feires som alle andre.
