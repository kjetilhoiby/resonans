# Retningen skal bære prioriteringer og milepæler

Dato: 2026-09-19
Status: pågår (fase 1–3 ferdig, fase 4 planlagt)

> Bygger på `2026-07-12-retning-livsintervju.md` (livsintervjuet, visjonene,
> `buildDirectionBlock`), `2026-07-17-retning-facelift-langtidsmaal.md` (målbare
> langtidsmål) og `2026-06-16-livskompasset.md` (ACT-modellen, ukentlig).

## Kontekst

Brukeren hadde «skifte jobb» som langsiktig mål. Det ble realisert etter måneder
i stedet for år. To ting fulgte av det, og ingen av dem har en plass i produktet:

1. **Milepælen har et regnskap.** Den frigjør noe (belastningen fra jobben, fra
   jobbsøkerprosessene) og den kostet noe (selve prosessen, økt spenning på
   daværende jobb). Det regnskapet er premisset for hva som kan prioriteres nå —
   og det finnes ingen steder å skrive det ned.
2. **Milepælen skal ligge der uten å ta over.** Den skal farge tolkningen, ikke
   åpne hvert svar med «siden du lyktes med å skifte jobb».

Bak dette ligger en større observasjon fra brukeren: livet består av faser med
samtidig framgang, stagnasjon og tilbakeslag på ulike områder. Retningen er
måten å sette mål langt nok fram til å ha hatt meningsfull framgang på FLERE
områder samtidig — og det forutsetter at man kan **justere vektingen over tid**,
bevisst.

- En nedprioritering av kultur eller venner over tid har konsekvenser for selvet.
  Det er drift, og den koster.
- En nedprioritering av bidrag hjemme kan **begrunnes, avtales og repareres** —
  om den er et bidrag til bedring på lengre sikt. Det er et valg, og det koster
  noe annet.

Livskompasset kan ikke skille de to. Det registrerer et gap ukentlig, og begge
tegnes som samme røde sektor. Den endimensjonale hjuløvelsen er for flat til å
fange dette — den har sin plass for refleksjon og små retningsforandringer, men
da må **Retningens prosa ligge i bunn, med nåværende mål, prioriteringer og
oppnådde mål**.

### Hva som finnes fra før, og hvorfor det ikke rekker

`buildDirectionBlock` (`$lib/server/services/direction-context.ts`) legges inn i
HVER chat, merket «brukerens egne, bekreftede formuleringer — ikke
AI-gjetninger», med instruks om å peke på gap og stille ett ubehagelig
oppfølgingsspørsmål. Den bærer i dag to ting: visjonsprosaen og en **flat**
verdiliste (pluss gap-notatet fra siste retningssamtale). Den bærer ikke
rekkefølge, og den bærer ikke oppnådde mål.

Et fullført mål settes til `status: 'completed'` og forsvinner fra Retning-siden
(`loadLangtidsmaal` filtrerer på `active`). Det havner riktignok i chat-prompten
— `getUserActiveGoalsAndTasks` filtrerer ikke på status, så raden står der med
`Status: completed` — men som et **faktum uten mening**: ingen dato for når,
ingen «dette frigjør», ingen «dette kostet», og i en annen blokk enn retningen.

Og de tre målbare langtidsmålene som finnes (vekt, 10 km-tid, sparing) er ALLE
fra kategorien brukeren kaller «noe man har kontroll over selv». Kategorien «ting
man kan legge til rette for» — ny jobb, endret tillit hos kone, barn, mer aktive
vennskap — har ingen representasjon i datamodellen. `createLongTermGoal` sin
metrikk-mapping treffer dem ikke, så de faller til `categoryName: 'Retning'` uten
måling og havner i den kollapsede «Uten måling»-skuffen på `/plan/mal`. Det er
nøyaktig der jobbmålet ble usynlig. **Produktet degraderer strukturelt den
halvdelen av livet brukeren sier betyr mest.**

### Den myke livskompass-koblingen, revidert

`2026-07-12` slo fast: «Livskompass-kobling holdes myk: dimensjonene brukes som
døråpnere i verdi-steget, ingen schema-kobling — verdiene er brukerens egne
formuleringer.»

Begrunnelsen står seg — verdiene skal ikke erstattes av en fast 12-punkts
taksonomi. Men den argumenterte mot å ERSTATTE, og ble implementert som INGEN
kobling: `livskompassDoorOpeners()` returnerer en statisk streng med
områdenavn, lik for alle brukere, mens `livskompass_importance` (viktighet 1–10
per dimensjon), ukentlig samsvar og `computeOutOfSync` ligger lagret på brukeren
og aldri leses av intervjuet. Setningen rett over døråpnerne i prompten —
«ikke en sjekkliste som skal gjennomgås» — er det som gjør bredden valgfri, og
modellen tar den på ordet.

Revisjonen er: dimensjonene forblir døråpnere, men brukerens EGNE tall på dem
er konfrontasjonsmateriale på linje med Balanse-kilden.

## Ryggraden

Brukerens egen formulering er i praksis en spesifikasjon for
`buildDirectionBlock`. Den skal bære fire ting, ikke to:

1. prosaen (som nå)
2. **rangeringen**, med eventuelle bevisste nedprioriteringer og hvor langt ut i
   terminen de er
3. aktive langtidsmål, **delt i kontrollerte og tilrettelagte**
4. **oppnådde milepæler**, med forfall — ferske som tema, eldre som bakgrunn

Alt annet i dette dokumentet er måter å fylle de slottene på.

## Faser

### Fase 1: Milepælen med regnskap og forfall

Minst arbeid, løser den utløsende klagen.

**Datamodell (ingen SQL-migrasjon):** milepælen bor i `goals.metadata.milestone`
— `{ achievedOn, frees, cost }` — på det fullførte målet selv. Samme valg som
`visionHorizon`: `metadata` er jsonb, og en egen tabell ville krevd en ny
skrivevei for noe som alt har en rad.

**Reglene rent** i `$lib/domain/goals/milestone.ts`:
`MILESTONE_FRESH_DAYS` skiller ferske milepæler (tema) fra bakgrunn, og
`buildMilestoneBlock` rendrer de to seksjonene med hver sin instruks.

**Forfallet er poenget, og mekanikken finnes fra før.** `PUSH_RANK` i
`weight-nugget-rules.ts` ble bygget fordi «Laveste snittvekt vi har målt» metter:
den står identisk hver morgen så lenge nedgangen varer. En milepæl er verre —
den er sann for alltid. Uten forfall blir «siden du lyktes med å skifte jobb»
åpningen på hvert svar til brukeren slutter å spørre.

**Bakgrunnsseksjonen sier eksplisitt at den ikke er et tema.** En modell som ser
en liste over prestasjoner uten instruks, gratulerer. Instruksen sier at
milepælene er premisser for hva som er mulig NÅ, og at de ikke skal nevnes med
mindre brukeren tar dem opp eller de faktisk forklarer noe.

**«Frigjør» og «kostet» er to felt, ikke ett notat.** De svarer på ulike
spørsmål, og det er det andre som pleier å mangle: en oppnåelse blir husket for
gevinsten, og prisen forsvinner. Begge er valgfrie — en milepæl uten regnskap er
fortsatt en milepæl, og et tomt felt er bedre enn et gjettet.

**Skriveveiene er tre, og alle går gjennom samme normalisering**
(`$lib/server/goals/milestone.ts`): `update_goal` med `complete` i chatten,
`PATCH /api/goals/[id]`, og «Fullfør»-knappen på `/plan/mal`.

**«Fullfør»-knappen gjaldt bare målbare mål.** Den var gated på `reached` i
`GoalDetailCard.svelte`, som bare regner ut vekt- og løpsmål — så et jobbmål
kunne bare arkiveres, og arkivert er ikke fullført. Det er den klassen mål der
brukeren er den ENESTE som kan si at det er nådd, og den hadde ingen knapp.

**`achievedOn` settes én gang.** Fullfører man på nytt (eller retter regnskapet
etterpå), skal datoen stå: den sier når det skjedde, ikke når noen sist trykket.
Samme regel som at `sensor_events.timestamp` ikke flyttes ved retting.

**`update_goal` sitt skjema genereres nå** med `openAiFunctionDefinition`, ikke
skrives av. Kopien i `routes/api/chat/+server.ts` var nettopp den formen
CLAUDE.md advarer mot, og de nye feltene ville ellers vært usynlige i
web-chatten mens Ekko så dem.

### Fase 2: Bevisst, tidsavgrenset nedprioritering

Den egentlig nye ideen. Én rad per periode:
`{ dimensionId, startDate, endDate, reason, repair, confirmedOn, settledOn, outcome }`.

**Formen er hentet fra `sick-periods.ts`** — en periode som unnskylder noe, med
livstegn, varsel før vakten slår til, og et bortfall som gjelder framover og
aldri bakover. Men ÉN ting er snudd, og det er den viktigste beslutningen her:

**Terminen er OBLIGATORISK.** Sykeperioder lar `endDate` være null, fordi
«inntil videre» er den ærlige defaulten: ingen vet på dag én hvor lenge en
infeksjon varer. Her er det motsatt. En nedprioritering uten sluttdato er ikke et
valg — det er drift med en forklaring foran. Du KAN velge terminen, og det å
velge den er selve handlingen. Validatoren avviser derfor en tom sluttdato med
nettopp den setningen, og `MAX_TERM_DAYS` (365) er taket: over et år er det ikke
en periode lenger, det er den du har blitt.

**Oppgjøret ved terminslutt er vakten**, ikke en periodisk bekreftelse. Når
terminen går ut slutter den å unnskylde, og flaten tilbyr tre utfall: hentet opp
igjen, forlenget, eller **det var drift**. Det tredje er det som gjør de to
andre troverdige — uten det kan en forlengelse gjentas i det uendelige og
fortsatt kalles et valg. En forlengelse setter `confirmedOn`, så den står som en
handling og ikke som fravær av en.

**`CHECKIN_INTERVAL_DAYS` (60) dekker den lange terminen.** Terminen er
forpliktelsen, så vi maser ikke på en på seks uker. Men en halvårig
nedprioritering ingen har sett på siden den ble satt, er ikke til å skille fra
drift — og det er nøyaktig forskjellen modulen finnes for.

**Møtepunktet med hjulet er `partitionOutOfSync`.** `computeOutOfSync` kjenner
bare viktighet minus samsvar og tegner derfor et valgt fravær som samme røde
sektor som en dimensjon ingen har sett på siden mars. Partisjonen gjør
forskjellen synlig uten å skjule noe: et valgt gap er fortsatt et gap, det er
bare ikke et avvik. En UTLØPT termin faller tilbake blant de driftende — i det
oppgjøret ikke er tatt, vet vi ikke lenger hva det er.

**Coachingen er den som gjorde mest skade uten dette.**
`buildCoachingSystemPrompt` ba modellen finne de største gapene og foreslå å heve
dem ett poeng — altså det stikk motsatte av det brukeren nettopp hadde bestemt
seg for. Valgte dimensjoner filtreres nå ut av den lista og står som kontekst,
med beskjed om å ikke be om et mål på dem.

**Innsjekken skjuler dem ikke.** «Valgt bort i denne perioden» står som en egen,
dempet seksjon under «Ute av synk»: et tall som bare forsvinner er ikke til å
etterprøve. Ingen varselfarge — det er ikke et varsel.

**Flaten er Retning-fanen, ikke livskompasset.** Hjulet er ukentlig og måler uka
som gikk; en nedprioritering spenner over måneder og hører sammen med prosaen,
målene og milepælene. Hjulet LESER den, men den settes der retningen bor.

**`getOrCreateLivskompassSensor` flyttet til `livskompass-sensor.ts`.**
Innsjekk-modulen leser nedprioriteringene inn i statusen, og
nedprioriteringsmodulen trenger sensoren å skrive på — lå hjelperen hos den ene,
importerte de to modulene hverandre. Samme grunn som `loadMerchantMappings` ble
flyttet ut av `spending-analyzer.ts`.

**`buildDirectionBlock` tar nå et `extras`-objekt.** Da den tredje samlingen kom,
var alternativet fire valgfrie posisjonelle parametere der to er lister — og et
kallsted som bytter om på to lister får ingen feil.

### Fase 3: Målart — kontrollert mot tilrettelagt

**Navnet på skuffen var problemet.** «Uten måling» er en påstand om OSS — vi fant
ingen metrikk — presentert som en egenskap ved MÅLET. `createLongTermGoal` sin
metrikk-mapping dekker vekt, 5/10 km-tid, hvilepuls, belastning,
kroppssammensetning og sparing; alt sammen tall man selv kan flytte. Ny jobb,
tillit hos kone og barn, mer aktive vennskap traff ingenting og havnet i en
kollapset skuff med en etikett som gjorde det til brukerens problem.

**Løsningen er ikke en metrikk for tillit.** Et tilrettelagt mål måles på
**betingelsene du setter opp**, ikke på utfallet. `GoalKind` er
`kontrollert | tilrettelagt`, satt av brukeren eller utledet.

**Utledningen gjetter ALDRI `tilrettelagt`.** En metrikk BEVISER at målet er
kontrollert: noen har oppgitt et tall man selv flytter. Fravær av metrikk beviser
ingenting — «gå ned i vekt» uten målvekt er et uferdig kontrollert mål. Å gjette
her ville vært samme feil som `startWorkout.type` sin stille default: en KONKRET
verdi satt inn der sannheten er «ikke oppgitt». Derfor `null`, og flaten SPØR.

**Den ledende indikatoren er ikke ny lagring.** Mekanismen fantes: en OPPGAVE
under målet med `frequency` og `targetValue`, registrert med
`record_tracking_event`. `readLeadingIndicator` sier bare hvordan den skal LESES.
Første aktive frekvens-oppgave vinner — to «ledende» indikatorer er ingen
indikator, og valget hører hos brukeren, ikke i en sorteringsregel.

**Fire båser, og de to nye sier hva som mangler.** `kontrollert`,
`tilrettelagt`, `mangler-indikator`, `uavklart`. De to siste erstatter «Uten
måling», og forskjellen er ikke kosmetisk: begge har en handling ved siden av seg.
Kriteriet for hvem som havner der er UENDRET (ingen måling, ingen oppgaver), så
endringen flytter ingen mål ned — bare de som alt lå der.

**Linja i chat-konteksten sier hva arten BETYR, ikke bare hva den er.** Uten den
halvdelen leser modellen «tilrettelagt» som en etikett og fortsetter å spørre om
framdrift mot utfallet — nettopp det brukeren ikke styrer. Kontrollerte mål får
INGEN linje: normalen trenger ikke en, og en linje per mål ville vært støy. Og
linja settes bare på aktive mål; et fullført mål har ingen framdrift igjen.

**`update_goal` fikk `set_kind`**, og `PATCH /api/goals/[id]` tar `goalKind` —
validert mot unionen, ikke gjennom den rå `metadata`-flettingen. En fritekstverdi
der ville gjort `resolveGoalKind` stum (den forkaster det den ikke kjenner), og
målet ville stått som «uavklart» uten at noe sa fra. `null` fjerner arten.

### Fase 4: Intervjuet (planlagt)

Sist med vilje — intervjuet er FORFATTERFLATEN for fase 1–3. Skriver vi om
promptene før tingene det skal forfatte finnes, produserer det bare mer prosa.

- **Bredderunde før graving.** Alle fire chat-stegene sier «Still ETT spørsmål om
  gangen» og «grav der det blir ekte»; ingen sier noe om bredde. `<status>`-blokka
  skal dessuten oppdateres etter HVER respons, fra første svar — altså må en
  4–7-linjers liste eksistere før samtalen har rukket å åpne seg. Trakten er ikke
  en modellsvakhet, den er designet.
- **Livskompasset som data**, ikke som statisk ordliste: viktighet, siste
  `outOfSync` og åtte ukers historikk inn i `interview-context`.
- **Rangering og nedprioriteringer forfattes**, ikke bare prosa.
- **Faser i tiårssteget.** «Hva gjør du en vanlig tirsdag» ber om et
  øyeblikksbilde; en tiårshorisont med barn er en sekvens av faser. Dette er det
  eneste punktet som krever at lagringsformatet røres.

**Intervjuet kan ikke være eneste vei inn.** Det er estimert til 30 minutter og
oppleves alt som tungt; legger vi på to steg blir det verre. Fase 1–3 skal kunne
settes og endres direkte på Retning-siden — samme mønster som visjonene alt har
(✏️ ved siden av intervjuet).

## Filer (fase 2)

| Fil | Rolle |
|-----|-------|
| `src/lib/domains/livskompass/deprioritization.ts` | reglene rent: termin, oppgjør, partisjon, ord |
| `src/lib/server/livskompass-deprioritization.ts` | lagring og lesing, én skrivevei |
| `src/lib/server/livskompass-sensor.ts` | delt sensor-hjelper (bryter sirkelen) |
| `src/lib/domains/livskompass/dimensions.ts` | coaching-prompten hopper over valgte gap |
| `src/lib/server/livskompass-checkin.ts` | statusen bærer nedprioriteringene |
| `src/lib/server/services/direction-context.ts` | prioriteringsblokka i chat-konteksten |
| `src/routes/api/livskompass/nedprioritering/+server.ts` | GET/POST/PATCH/DELETE, PATCH tar en handling |
| `src/lib/components/domain/plan/DeprioritizationSection.svelte` | flaten på Retning-fanen |
| `src/lib/components/domain/LivskompassCheckin.svelte` | «Valgt bort i denne perioden» |
| `src/lib/server/prompts/domains.ts` | blokk i `self` om hva et valgt gap er |

## Filer (fase 3)

| Fil | Rolle |
|-----|-------|
| `src/lib/domain/goals/goal-kind.ts` | arten, den ledende indikatoren, grupperingen, ordene |
| `src/routes/api/chat/+server.ts` | art-linja i mål-blokka, bare på aktive mål |
| `src/routes/api/goals/[id]/+server.ts` | `goalKind` i PATCH, validert mot unionen |
| `src/lib/ai/tools/update-goal.ts` | `set_kind` |
| `src/routes/plan/mal/+page.svelte` | «Trenger en form» med art-velger |
| `src/lib/server/prompts/domains.ts` | blokk i `self` om de to artene |

## Verifisering (fase 3)

- `npm test`: 4964 tester grønne (331 filer), inkludert 15 nye for `goal-kind.ts`
  og 2 for `set_kind`.
- `npm run check`: 0 feil. `npm run build`: OK.
- **Gjenstår i dev:**
  1. Et mål uten måling og uten oppgaver står under «Trenger en form» med to
     knapper. Trykk «Jeg legger til rette» → raden sier at det mangler én jevnlig
     handling.
  2. Send en chatmelding → målet bærer «Art: tilrettelagt …» i mål-blokka, og
     coachen foreslår en frekvens-oppgave framfor å spørre om utfallet.
  3. Si «det der er ikke noe jeg styrer selv» i chatten → `update_goal` med
     `set_kind`.

## Kjent rest etter fase 3

- **Ingen framdrift på et tilrettelagt mål på flaten.** `calculateGoalProgress`
  snitter oppgavene som før; den vet ikke at utfallet ikke skal telles. Riktig nok
  i praksis (indikatoren ER en oppgave), men det er tilfeldig, ikke bestemt.
- **`createLongTermGoal` setter ikke arten.** Et mål fra livsintervjuet uten
  metrikk blir «uavklart» og må avklares på flaten. Fase 4 er stedet: speil-steget
  vet hvilken art det foreslo.
- **Ingen kobling mellom arten og «Fullfør».** Et tilrettelagt mål er nådd når
  brukeren sier det — som før — men ingenting sier at det er den eneste måten.
- **`create_goal` tar ikke `kind`.** Et nytt tilrettelagt mål må merkes i to steg.

## Beslutninger

- **Gjenbruk framfor ny datamodell**, som i `2026-07-12`. Milepælen er et felt i
  `goals.metadata`; nedprioriteringen får gjenbruke `livskompass_importance`-
  sensoren framfor en egen tabell.
- **Forfall framfor fjerning.** En milepæl slettes ikke når den blir gammel — den
  flyttes til bakgrunn. Det er forskjellen på å glemme og å ha lært.
- **Prisen registreres sammen med gevinsten.** Uten `cost` blir milepælslista en
  seiersliste, og en seiersliste er ikke et grunnlag for å prioritere.
- **Ingen automatisk utfylling av regnskapet.** Modellen kan foreslå i en samtale,
  men feltene er brukerens. Et gjettet «dette kostet deg …» er en påstand om et
  indre liv vi ikke måler.
- **Ingen nye AI-verktøy i fase 1.** `update_goal` finnes og skal utvides, ikke
  dubleres — to verktøy om samme sak gir samme problem som to mål om samme sak.

## Filer (fase 1)

| Fil | Rolle |
|-----|-------|
| `src/lib/domain/goals/milestone.ts` | reglene rent: forfall, rangering, lagringsform, validering |
| `src/lib/server/goal-milestones.ts` | lesing av fullførte mål + les-flett-skriv for chat-verktøyet |
| `src/lib/server/services/direction-context.ts` | milepælsseksjonen i «LANGSIKTIG RETNING» |
| `src/lib/server/services/context-service.ts` | laster milepælene inn i chat-konteksten |
| `src/lib/ai/tools/update-goal.ts` | `complete` tar `frees`/`cost`, går via delt normalisering |
| `src/routes/api/chat/+server.ts` | skjemaet genereres, kopien er borte |
| `src/routes/api/goals/[id]/+server.ts` | `milestone` i PATCH, flettet inn i `metadata` |
| `src/lib/components/domain/plan/GoalCompleteForm.svelte` | regnskapsskjemaet |
| `src/lib/components/domain/plan/GoalDetailCard.svelte` | «Fullfør» for alle aktive mål |
| `src/routes/plan/mal/+page.svelte` | «Fullfør» også i «Uten måling»-gruppa |
| `src/routes/plan/drommer/+page.svelte` | seksjonen «🏁 Oppnådd» på Retning-fanen |
| `src/lib/server/prompts/domains.ts` | milepælsblokk i `self`, `complete` nevnt i `health` |

## Verifisering

- `npm test`: 4916 tester grønne (329 filer), inkludert 29 nye for
  `milestone.ts`, 4 for milepæler i `direction-context`, og 4 nye vakter i
  `tool-schema.test.ts`.
- `npm run check`: 0 feil, 0 advarsler.
- `npm run build`: OK (med attrapp-verdier for `DATABASE_URL`/`OPENAI_API_KEY`,
  som Dockerfilen gjør — `analyse`-steget importerer server-chunkene).
- **Gjenstår i dev (krever DATABASE_URL/OPENAI_API_KEY):**
  1. Fullfør et mål uten måling fra `/plan/mal` → regnskapsskjemaet vises, målet
     havner under «Fullførte mål», og `goals.metadata.milestone` har `achievedOn`.
  2. Åpne `/plan/drommer` → milepælen står under «🏁 Oppnådd», fersk først.
  3. Send en vanlig chatmelding → «NYLIG OPPNÅDD» står i retningsblokken mellom
     verdiene og gap-notatet, og coachen åpner IKKE svaret med den.
  4. Si «jeg har byttet jobb» i chatten → `update_goal` med `complete`, og
     modellen spør etter prisen når bare gevinsten er nevnt.
  5. Rett regnskapet på et alt fullført mål → `achievedOn` står uendret.
  6. `VISUAL_REVIEW_CONTEXT="Milepælsregnskap på mål og Retning-fanen" npm run test:visual:review`
     (Retning-fanen er ikke i piksel-suiten; `/plan/mal` kan påvirkes.)

## Verifisering (fase 2)

- `npm test`: 4948 tester grønne (330 filer), inkludert 27 nye for
  `deprioritization.ts`, 3 for prioriteringsblokka i `direction-context` og 3 for
  coaching-prompten.
- `npm run check`: 0 feil, 0 advarsler.
- **Gjenstår i dev:**
  1. Retning → «Nedprioriter noe bevisst» → velg Kultur, 12 uker, grunn. Raden
     dukker opp med «Uke 1 av 13».
  2. Ta ukesinnsjekken med lavt samsvar på Kultur → den står under «Valgt bort i
     denne perioden», ikke under «Ute av synk», og «Snakk om det» foreslår ikke å
     heve den.
  3. Send en chatmelding → «BEVISST NEDPRIORITERT NÅ» står i retningsblokka
     mellom verdiene og milepælene, og coachen konfronterer ikke det valget.
  4. Sett en termin som alt er over (rett `endDate` i basen) → raden flytter seg
     til «terminen gikk ut» med tre utfall, og faller tilbake blant de driftende
     i innsjekken.

## Kjent rest etter fase 2

- **Ingen nudge når en termin går ut.** `digest-nugget-rules.ts` er den naturlige
  koblingen, og en utløpt termin fyrer ÉN gang — altså høyt i `PUSH_RANK`. Uten
  den må brukeren åpne Retning-fanen for å se at oppgjøret venter.
- **Ingen chat-inngang.** `saveDeprioritization` er klar for et verktøy, men
  prompten viser til flaten — samme valg som sykeperiodene.
- **En startdato fram i tid avvises.** «Fra 1. oktober» er ikke urimelig, men en
  slik rad ville vært usynlig: hverken aktiv, uoppgjort eller avsluttet, altså i
  ingen av flatens lister. Skal det støttes, må flaten få en fjerde liste først.
- **«Forleng» er hardkodet til 12 uker** i flaten. En forlengelse man ikke velger
  lengden på er en halv beslutning.
- **Ingen kobling til `livskompass_importance`.** En nedprioritering endrer ikke
  viktigheten, og det er riktig — viktighet er hva som BETYR noe, ikke hva som
  får plass. Men ingenting sier det til brukeren.
- **Rangeringen mangler fortsatt.** Ryggradens punkt 2 er «rekkefølgen, med
  eventuelle bevisste nedprioriteringer»; fase 2 leverte den andre halvdelen.
  En ordnet topp-3 av verdiene er ikke bygget, og det er fase 4s jobb —
  intervjuet er forfatterflaten for den.

## Kjent rest etter fase 1

- **Ingen SQL-migrasjon, og ingen trenger det** — `metadata` er jsonb. Men det
  betyr også at milepæler ikke kan spørres på i basen uten en jsonb-indeks.
- **`splitMilestones` kalles to steder med hver sin `now`** (flaten og
  chat-konteksten). De kan i teorien havne på hver sin side av døgnskillet for en
  milepæl som akkurat fyller 30 dager. Prisen er at flaten sier «fersk» én dag
  lenger enn prompten, eller motsatt — ikke verdt en delt klokke.
- **Retning-fanen kan ikke REDIGERE regnskapet.** PATCH-en tar det, og chatten
  kan skrive det, men flaten viser bare. «Ingen regnskap ført» lenker derfor til
  en handling som må gjøres i chat.
- **Ingen kobling mellom milepæl og visjonsprosa.** Modellen blir bedt om å si fra
  når prosaen er utdatert, men ingenting SJEKKER det — det krever at noe kan se at
  en setning i prosaen handler om et nådd mål. Fase 4 er stedet.
- **Målet står to steder i prompten.** `getUserActiveGoalsAndTasks` filtrerer ikke
  på status, så det fullførte målet ligger fortsatt i «BRUKERENS AKTIVE MÅL OG
  OPPGAVER» med `Status: completed` — samtidig som milepælen står i retningsblokken
  med regnskapet. Duplikatet er ufarlig (den ene bærer meningen), men et opprydd
  hører hjemme når goals-blokken uansett skal deles i kontrollert/tilrettelagt i
  fase 3.
- **`abandoned` er ikke en milepæl**, og skal ikke bli det. Men statusen vises
  fortsatt som «aktiv» på `/plan/mal`, som regner alt som ikke er
  `archived`/`completed` som aktivt. Urørt her.
