# Billetten som ble skalert i hjel

Dato: 2026-09-17
Status: ferdig

## Kontekst

Første ekte billett gjennom `/arrangementer` (Cosmopolite, «ULD», 9. desember
2026) ga mye riktig — tittel, dato, spillested, antall — og **ett felt feil**:
ordrenummeret sto som `151165243` der billetten sier `163166254`.

Årsaken lå ikke i prompten. `uploadAndExtractAttachment` skalerer bilder med
`{ width: 1600, height: 1600, crop: 'limit' }`, som er riktig for et bilde i en
chat. Et «hele siden»-skjermbilde av en billettside er smalt og høyt — 1170×6000
er vanlig — og `c_limit` gjør det da til **312×1600**.

Det ødela to ting på én gang:

1. **Bildet brukeren skal vise i døra.** Strekkoden og QR-koden er uleselige.
2. **Grunnlaget for uttrekket.** Modellen leste den nedskalerte grøten.

Brukeren meldte det første og foreslo to utveier: en lenke til billetten ved
siden av bildet, eller ett bilde per billett. Begge er gode og begge er bygget —
men ingen av dem traff årsaken.

## Faser

### Fase 1: Originalen lagres urørt

`$lib/server/events/ticket-upload.ts`. Billettbilder går ikke lenger gjennom den
generiske vedleggsveien. Ingen `transformation` ved opplasting i det hele tatt:
det som ligger i Cloudinary er nøyaktig fila brukeren valgte.

Alle visninger er utsnitt utledet via Cloudinary-URL: `ticketThumbUrl` (300 px,
`auto:eco`) til lista, `ticketFullUrl` (originalen selv når bildet ikke er
beskåret) til det man åpner i døra.

PDF går fortsatt den generiske veien — der er det teksten vi er ute etter, og
den skaleres ikke.

### Fase 2: Lesing i snitt

`planTicketSlices` (`$lib/domain/events/ticket-image.ts`) deler et langt bilde i
2–5 overlappende vannrette snitt, hvert omtrent kvadratisk. Snittene sendes som
separate bilder i ETT modellkall, med `detail: 'high'`.

Prompten fikk to nye regler: lange sifferrekker leses siffer for siffer og
utelates helt ved tvil, og «dørene åpner» er bare et eget felt når det står på
billetten.

### Fase 3: Ett bilde per billett

Modellen rapporterer `ticketRegions` — hvor hver billett ligger loddrett på
siden, i prosent. `regionsFromModel` tolker det, `splitByRegions` lager én
oppføring per billett.

**Ingen nye opplastinger:** alle oppføringene peker på samme `publicId` med hvert
sitt utsnitt, og Cloudinary beskjærer i URL-en.

### Fase 4: Lenke til billetten

`events.ticket_url` (migrasjon `0065`). `normalizeUrl` slipper bare http og https
gjennom.

## Beslutninger

**Komprimering hører til LESINGEN av et bilde, ikke til lagringen.** En
nedskalering gjort ved opplasting kan ikke angres. `quality` og `fetch_format`
ligger derfor på de utledede URL-ene, der de kan endres i ettertid.

**`detail: 'high'` er poenget med hele oppdelingen.** Uten den nedskalerer OpenAI
bildet selv, og snittene er bortkastet arbeid.

**Snittene overlapper med 12 %.** Uten overlapp kan et snitt gå tvers gjennom en
tekstlinje eller en strekkode, og da finnes tallet ikke helt i noen av delene.

**Siste snitt forankres i BUNNEN.** Regnet framover ville avrunding pluss
overlapp lagt det utenfor bildet, og de nederste linjene falt ut — som er der
ordrenummeret pleier å stå.

**Terskelen for «langt bilde» er 1,8 og valgt lavt.** En telefonskjerm er ~2,2,
så en enkelt skjermdump havner allerede over. Prisen ved å dele et bilde som ikke
trengte det er to ekstra bildefelter; prisen ved å la være er et feillest
ordrenummer.

**Enheten på `ticketRegions` avgjøres av HELE lista, ikke av det enkelte tallet.**
Første utgave leste per verdi, og gjorde da `1.5` — som ikke kan være en andel —
til 1,5 %. Modellen svarer konsekvent i én enhet, så enheten er en egenskap ved
svaret. Fanget av en test.

**Et halvt sett utsnitt forkastes helt.** Er én rad tull, droppes hele lista:
brukeren ville ellers fått «Billett 1 av 3» og «Billett 3 av 3» og trodd at én
var borte.

**Utsnittene polstres med 3 %, og feilene er ikke symmetriske.** Et utsnitt som
tar med litt for mye er fortsatt en billett man kan vise i døra; ett som kutter
strekkoden er verdiløst.

**Splitting er reversibel ved konstruksjon.** Fordi utsnittene er URL-er mot en
urørt original, koster en bom ingenting — originalen er der.
`worthSplitting` avviser dessuten utsnitt som i praksis dekker hele bildet: to
kort som viser det samme er verre enn ett.

**`normalizeUrl` er en hviteliste.** Bare http og https. Verdien kan komme fra et
uttrekk av et bilde, altså fra noe vi ikke kontrollerer, og `javascript:` i en
`href` kjører i brukerens økt. En denylist må kjenne alle farlige skjemaer; en
allowlist trenger bare kjenne de to vi vil ha.

**Miniatyrene er høye, ikke kvadratiske.** `object-fit: cover` på en kvadratisk
flate kutter bort strekkoden — nøyaktig det man ser etter i en miniatyr.

**`normalizeTickets` er en hviteliste, og `region`/`label` måtte legges til der.**
Glemmes et felt, faller oppdelingen stille tilbake til hele siden. Samme
begrunnelse som `toPublicCronRun`.

## Verifisering

- 32 nye enhetstester (`ticket-image.test.ts`, pluss `normalizeUrl` og
  billettlenke-validering). `npm test` grønt: 328 filer, 4878 tester.
- `npm run check` — 0 feil. `npm run build` — grønt.
- **Ikke** prøvd mot en ekte billett i denne økta — det er brukerens neste steg,
  og det er den eneste prøven som teller: om ordrenummeret nå leses riktig.

## Kjent rest

- **Eksisterende billetter er fortsatt nedskalerte.** Fiksen gjelder nye
  opplastinger; det finnes ingen jobb som laster opp gamle på nytt, og originalen
  er tapt for dem. De må lastes opp igjen for å bli lesbare.
- **Modellen anslår `ticketRegions` uten å måle.** Den ser snitt og skal svare i
  prosent av hele siden — en indirekte oppgave. Polstringen og «forkast hele
  lista»-regelen gjør en bom billig, men treffsikkerheten er ukjent til den er
  prøvd på flere billettsider.
- **Ingen kontroll av ordrenummer mot strekkoden.** De står ofte begge på
  billetten, og et avvik mellom dem ville vært et signal om at lesingen glapp.
- Flere snitt i ett kall koster mer per opplasting. Ikke målt.
