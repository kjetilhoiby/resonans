# Brevet: en prototype med ekte data

Dato: 2026-10-06
Status: til utprøving (fase 2)

## Kontekst

Spor 3 i `2026-10-05-redesign-fremdriftsplan.md` er hjemskjermen etter døgnet.
Forslaget var et «brev» øverst: noen setninger om det som er verdt å vite nå,
med én eller to handlinger under.

Brukeren var usikker: «disse brevene føles mest som påminnelser av typen som
havner i en innboks med rød prikk i andre apper», og «jeg må nesten se det i
praksis før jeg forstår om det er et reelt alternativ».

Det kan ikke avgjøres av en skisse med oppdiktede data. Derfor er prototypen en
egen side med brukerens ekte data, ikke en endring av hjemskjermen.

## Fase 1: `/brev`

- **Ren logikk** i `$lib/domain/home-letter.ts` (`buildHomeLetter`). Brevet
  regner ingenting selv. Det leser:
  - dagsoversiktens regler (`digestNuggets`),
  - vektreglene (`weightNuggets`), der bare den sterkeste setningen tas med,
  - arrangementer med åpne forberedelser de neste 14 dagene, og arrangementer i
    dag eller i morgen,
  - åpne punkter på dagens dagsplan,
  - «siden sist»: økter siden forrige besøk, etter mer enn 20 timer borte.
- **Innhentingen** i `$lib/server/home-letter.ts` bruker den SAMME innhentingen
  som push-varslene. `gatherDigestInput` og `gatherWeightNuggetInput` er trukket
  ut av `computeDigestPush`/`computeWeightPush`, og `openItemsFromDay` er
  eksportert. Pushene gjør nøyaktig det samme som før. Ingenting skrives.
- **To linser.** Hver linje er enten `venter` (ber om noe: en rekke som ryker,
  et åpent punkt, en barnevakt som mangler) eller `status` (hvor du står: uka,
  vekta, siden sist). Siden kan vise dem hver for seg. Det er brukerens
  innvending gjort etterprøvbar: er det `venter` som føles som en innboks,
  mens `status` er det som gjør brevet verdt å lese?
- **Maks tre linjer per linse.** Resten vises under «Valgt bort», sammen med
  kilden og linsen for hver linje, så utvalget kan vurderes.
- **Syk:** brevet sier bare at ingenting haster. Samme regel som
  dagsoversikten, som ikke sender noe da.
- **Inngangen** er en midlertidig ✉-lenke i hjemskjermens topprad. En PWA har
  ingen adresselinje, så uten den kan siden ikke prøves på telefonen.

## Fase 2: styringssignaler (8. oktober 2026)

Første utgave ga tre linjer en morgen: «Siste 3 dager ligger 1,99× over
snittet siste 30 — ta en rolig dag», «Under ukas plan (391–469) — det er rom
igjen» og «2,2 kg under i fjor på samme dato». Brukerens dom var at ingen av
dem er tydelige styringssignaler:

- **Snittet over 30 dager inneholdt en sykeperiode.** Sykedagene telte som
  nuller i nevneren, så den første normale uka etter sykdom så ut som en topp.
  Det er en feil i motoren, ikke i brevet. `computeEffortBudget` holder nå
  sykedagene utenfor det kroniske snittet, både dagen og effort den dagen,
  slik ankeret alt gjorde. Krever fortsatt minst 14 friske dager.
  Feilen rammet også dagsvarselet og Trening-flaten, og rettingen gjelder der
  også.
- **Kalenderuka står på null hver mandag.** Brevet bruker nå de løpende sju
  dagene (`spentLast7Days`, samme grunnlag som `spentThisWeek`) mot rammen,
  med ordene i `describeRollingEffort`. Budsjettkortet på Trening viser
  fortsatt kalenderuka, fordi progresjonsplanen er lagt per uke.
- **Vekta har et mål.** Brevet var stumt om det og valgte et årssammenligning.

Brevet er bygget om i fire deler:

1. **Målene:** hvert aktivt løpe- og vektmål med frist, med fremdrift og
   «på dagens tempo er du der rundt …». Tallene leses gjennom
   `$lib/server/goal-trajectories.ts`, som er trukket ut av `/plan/mal`, og
   datoen regnes av `describeGoalTrajectory`, som `/plan/mal` nå også bruker.
   Brevet og målsiden kan derfor ikke gi ulike datoer for samme mål.
2. **Uka:** de løpende sju dagene mot rammen, belastningen (bare når den
   faktisk er høy, og nå uten sykedagene), og punkter på ukelista som ingen dag
   har tatt (`metadata.linkedChecklistItemId`), gruppert på `scheduleLabel`
   («Løp ×2»).
3. **Løse tråder:** en rekke som ryker, arrangementer der noe mangler, punkter
   som ble liggende på dager som har gått (sju dager tilbake, utsatte punkter
   utenfor), og dagens åpne punkter.
4. **Ellers:** «siden sist», arrangementer i dag eller i morgen, og
   vektkrydderet, men bare når det ikke finnes et vektmål.

Overliggerne fra i går, kalenderuka og ukas vekt står under «Valgt bort» med en
setning om hva som erstattet dem.

### Etterarbeid etter første lesing med ekte data (8. oktober)

- **Målene sorteres på den faktiske fristen.** Sorteringen sto på `targetDate`,
  som er tom for mål med frist i metadata, og NULL havner sist. «Løpe 90 km i
  oktober», målet med nærmest frist, falt derfor ut bak tre mål med frist i
  2027. Nå er det nærmeste frist først, og taket på fire kapper bort de fjerneste.
- **Ukelista teller ganger, ikke punkter.** Et punkt kan bære målet i parentes,
  «Dele legging i to med Anita (3 ganger)». Første utgave så det som ett punkt,
  viste parentesen som en del av navnet, og ville tatt det bort i det det var
  lagt på én dag. `weekItemTarget` leser målet, `remainingWeekPlacements` trekker
  fra dagene som peker på punktet, og linja sier hvor mange dager som er igjen
  av uka: «Fire dager igjen av uka, og uten en dag ennå: Dele legging … ×3».
- Kjent rest: å hake av et dagpunkt haker også av ukepunktet det peker på
  (`/ukeplan`), så et «(3 ganger)»-punkt forsvinner fra brevet etter første gang.
  Det er ukelistas regel, ikke brevets, og den er ikke rørt.

## Beslutninger

- **En egen side, ikke hjemskjermen.** Hjemskjermen er den flaten brukeren
  åpner mest. En prototype skal kunne fjernes uten at noe annet endres.
- **Ingen tellinger og ingen ulest-markør.** Et brev akkumulerer ikke; det byttes
  ut. Det er den strukturelle forskjellen fra en innboks, uavhengig av innholdet.
- **Ingen hurtighandlinger i brevet.** De står alt på hjemskjermen. To steder å
  se de samme påminnelsene på ville gjort brevet til en innboks med en gang.
- **Arrangementer bare når noe mangler** (eller de er i dag eller i morgen).
  Brukeren bekreftet at det var riktig: konserten var med så lenge barnevakt
  sto åpen.
- **Ingen kveldsvariant ennå.** Hilsenen følger klokka, men innholdet er det
  samme hele dagen. Kveld og «avslutt dagen» venter på svaret fra utprøvingen.

## Verifisering

- `home-letter.test.ts`: målene, delene og kappene, hva som er erstattet,
  ukelista, arrangementer, siden sist og sykdom.
- `effort-budget.test.ts`: sykedager utenfor det kroniske snittet, og de
  løpende sju dagene over et ukeskifte.
- `npm test` og `svelte-check` er grønne.
- **Ikke verifisert herfra:** siden med ekte data, siden økta ikke har tilgang
  til basen.

## Neste steg

Brukeren åpner `/brev` noen morgener og kvelder. Spørsmålene er:

1. Leser det som en innboks, og er det i så fall `venter` eller begge?
2. Sier `status` noe som er verdt å åpne appen for?
3. Mangler det noe som burde stått der?

Svarene avgjør om brevet flytter inn på hjemskjermen, blir en ren
status-tekst, eller forkastes. Forkastes det, slettes `/brev`, ✉-lenken og
`home-letter.ts`. De uttrukne innhentingsfunksjonene kan bli stående.
