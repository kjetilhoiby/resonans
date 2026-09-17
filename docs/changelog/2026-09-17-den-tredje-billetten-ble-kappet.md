# Den tredje billetten ble kappet

Dato: 2026-09-17
Status: ferdig

## Kontekst

Etter at billettbilder ble lagret i full oppløsning og delt i én oppføring per
billett, kom første ekte prøve: en Cosmopolite-side med tre billetter.

To av tre utsnitt traff — hele billetten, egen strekkode, skarp tekst
(`1152532792423` og `7067272220331`, ordrenummer `163166254` lesbart). Det
tredje var **avkuttet**: logo, sirkler, og så sluttet utsnittet akkurat i det
billettboksen begynte.

Det er den ene feilen `padRegion` finnes for å hindre, sagt eksplisitt i
`ticket-image.ts`: «et utsnitt som tar med litt for mye er fortsatt en billett
man kan vise i døra, mens et som kutter strekkoden er verdiløst».

Toppene lå riktig. Det var **høyden** som manglet — modellen anslo det siste
utsnittet til omtrent 0,20 der enheten er 0,33.

## Faser

### Fase 1: Rutenettet retter seg selv

`regularizeRegions` i `$lib/domain/events/ticket-image.ts`, kalt av
`regionsFromModel` før polstringen.

En billettside med tre billetter er tre **identiske** blokker — samme logo,
samme ramme, samme høyde. Ulike høyder i modellens svar er derfor et anslag som
skled, ikke en egenskap ved siden. Avstanden mellom naboene måler blokka, og
medianen av avstandene tåler at én av dem er feil.

Hvert utsnitt får `height = medianStride`, toppene bygges på et anker som er
medianen av `top_i − i·stride`, og det siste forankres i bunnen om det ellers
ville stukket utenfor.

## Beslutninger

**Høyden hentes fra AVSTANDEN, ikke fra anslaget.** Det er hele poenget: et
rutenett kan korrigere sitt eget svakeste ledd, mens et løst sett bokser ikke
kan det.

**Utsnittene ligger kant i kant.** `height = stride` gjør at de dekker siden
uten hull — og et hull er nøyaktig der en billett forsvinner.

**Ankeret er MEDIANEN av `top_i − i·stride`, ikke den første toppen.** Er
nettopp den ene bommet, ville hele rutenettet arvet bommen.

**Siste utsnitt forankres i BUNNEN**, ikke klippet mot kanten. Samme regel som
`planTicketSlices`, og av samme grunn: klipping korter av nettopp den siste
billetten, som er den vi nå vet blir kappet.

**Regelen rører ingenting når siden ikke ER en gjentakelse.** Spriker
avstandene mer enn `UNIFORM_STRIDE_TOLERANCE` (35 %) fra medianen, returneres
utsnittene urørt. Regelen henter sin styrke fra strukturen; uten strukturen har
den ingen, og da skal den ikke late som.

**Toleransen er romslig fordi det er ANSLAGENE som spriker — ikke sidene.** En
ekte billettside er maskinsatt og helt regelmessig. Kommer avstandene innenfor
en tredjedel av hverandre, er det den samme blokka om igjen.

**Rettingen skjer FØR polstringen.** Polstringen er et slingringsmonn, ikke en
korreksjon — å polstre et feil utsnitt gir bare et større feil utsnitt.

**Polstringen klippes fortsatt mot bildekanten, så høydene er ikke identiske
etter polstring — og skal ikke være det.** Ved kanten finnes det ikke mer å ta
med. Invarianten testen måler er derfor at intet utsnitt er KORTERE enn én
enhet, ikke at alle er like.

## Verifisering

- 9 nye enhetstester, inkludert den målte feilen gjengitt ende til ende
  (tre utsnitt der det siste er 0,20 mot enhetens 0,33).
- `npm test` grønt: 328 filer, 4887 tester.
- `npm run check` — 0 feil. `npm run build` — grønt.
- **Ikke** prøvd mot en ekte billettside i denne økta. Den forrige runden viste
  hvorfor det er den eneste prøven som teller.

## Kjent rest

- **Et sett utsnitt som er jevnt FORSKJØVET korrigeres ikke.** Regelen retter
  opp innbyrdes ujevnhet; er hele rutenettet forskjøvet en halv blokk, er det
  jevnt, og medianankeret arver forskyvningen. Polstringen dekker en liten
  skjevhet, ikke en stor.
- **Antall billetter kryssjekkes ikke mot `ticketCount`.** Rapporterer modellen
  tre billetter men bare to utsnitt, blir det to kort uten at noe sier fra.
  Stride og anker ville gjort det trivielt å utvide rutenettet til tre — men et
  `ticketCount` som er feil ville da lagd et tomt kort, og et tomt kort er verre
  enn et manglende.
- Billetter lastet opp før 17. september 2026 er fortsatt nedskalerte og må
  lastes opp på nytt.
