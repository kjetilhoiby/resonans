# Brevet: en prototype med ekte data

Dato: 2026-10-06
Status: til utprøving

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

## Beslutninger

- **En egen side, ikke hjemskjermen.** Hjemskjermen er den flaten brukeren
  åpner mest. En prototype skal kunne fjernes uten at noe annet endres.
- **Ingen tellinger og ingen ulest-markør.** Et brev akkumulerer ikke; det byttes
  ut. Det er den strukturelle forskjellen fra en innboks, uavhengig av innholdet.
- **Ingen hurtighandlinger i brevet.** De står alt på hjemskjermen. To steder å
  se de samme påminnelsene på ville gjort brevet til en innboks med en gang.
- **Ingen kveldsvariant ennå.** Hilsenen følger klokka, men innholdet er det
  samme hele dagen. Kveld og «avslutt dagen» venter på svaret fra utprøvingen.

## Verifisering

- `home-letter.test.ts`: linser, kapp, «valgt bort», arrangementer, siden sist
  og sykdom.
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
