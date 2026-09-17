# Arrangementer og billetter

Dato: 2026-09-17
Status: ferdig

## Kontekst

Konsert, teater og kamp har en form ingenting i Resonans traff fra før: billetten
kjøpes måneder i forveien, datoen er satt av noen andre, og det som faktisk
gjenstår er alt rundt den — transport, barnevakt, kanskje overnatting. Det er
ikke en oppgave (den kan ikke gjøres i dag, og den kan ikke droppes), og det er
ikke en rutine.

Nærmeste eksisterende form var et `checklist_item` med dato. Den bærer ikke
inngang, sete, billettbilde eller et lite sett egne avkryssinger, og et
dag-punkt måtte ligget på en dag ingen har planlagt ennå — barnevakt ordnes seks
uker før, ikke samme morgen.

Samtidig finnes kilden ferdig digital: brukeren har alltid et skjermbilde eller
en PDF av billetten. `uploadAndExtractAttachment` gjorde alt det tunge fra før
(Cloudinary-opplasting, PDF-tekst), og skjermtids-parseren viste mønsteret for
bilde → JSON. Inngangen til et arrangement er derfor billetten, ikke et skjema.

## Faser

### Fase 1: Tabellen

`events` (migrasjon `0064_events.sql`, `schema.ts`). Dato som **DATE** og
klokkeslett som **tekst i `HH:MM`** — Oslo-veggklokke, aldri et timestamp. Se
beslutningen under.

`tickets` og `prep` er jsonb-lister framfor kolonner: antall billetter varierer,
og forberedelsene er en liste med minst fem realistiske varianter.

### Fase 2: Domenelaget

Fire rene, testede moduler i `$lib/domain/events/` (84 tester):

- `event-fields.ts` — normalisering av dato/tid/type/antall, sortering,
  `coversDay`, `isPast`, `splitByTime`, og setningene (`formatEventDate`,
  `formatEventTime`, `formatEventPlace`, `describeCountdown`).
- `event-input.ts` — validering delt av `POST`, `PATCH` og flaten.
- `prep.ts` — forberedelsene: standardsett, forslag, av/på, `describePrep`.
- `ticket-extraction.ts` — fra modellens svar til et utkast.
- `event-record.ts` — formen som forlater serveren (flaten kan ikke importere
  fra `$lib/server`, heller ikke en type).

### Fase 3: Lesing av billetten

`$lib/server/events/ticket-reader.ts`. Bilder leses av `gpt-4o` mot
Cloudinary-url-en; PDF leses som tekst av `gpt-4o-mini`, siden
`uploadAndExtractAttachment` alt har trukket teksten ut. En e-postbekreftelse
limt inn som ren tekst går samme vei.

`POST /api/arrangementer/les-billett` returnerer et **utkast** og lagrer
ingenting.

### Fase 4: Flaten

`/arrangementer` — «Last opp billett» øverst, så Kommende / Tidligere. Kortet er
bygget rundt datoen og nedtellingen, med forberedelsene som en stripe under.
Ikonlenke fra hjemskjermen (`calendar`).

### Fase 5: Dagsvisningen

Uka i `ukeplan/+page.server.ts` henter arrangementene sine med
`listEventsInRange`, og `DaySection` rendrer dem **over** Spond-linjene og med
mer plass. Et flerdagsarrangement legges på hver dag det dekker.

## Beslutninger

**Dato som DATE, klokkeslett som tekst — aldri et timestamp.** En konsert kl.
19:00 i Oslo lagret som `timestamptz` kan leses ut på feil dato: UTC-midnatt
ligger kl. 02 om natta om sommeren, nøyaktig fella som delte søvnnettene i to
(`2026-09-10-natta-som-ble-delt-av-utc-midnatt.md`). Og billetten sier «19:00»,
ikke «17:00Z» — tallet på skjermen skal være tallet på billetten. Samme valg som
`checklist_items.metadata.timeHour`.

**Utkastet lagres ikke av seg selv.** Modellen leser et skjermbilde og tar feil
noen ganger. Et arrangement som skrev seg selv ville ligget i lista med en
feillest dato som om noen hadde sett på den — og en dato i lista er nettopp det
man slutter å dobbeltsjekke. Brukeren bekrefter, og `warnings` sier hva som er
verdt å se på.

**Modellen skal IKKE normalisere selv.** Prompten ber om datoen «slik den står»
(«fredag 14. november 2026»), og tolkningen skjer i `parseTicketDate`. Gjorde
modellen det, mistet vi muligheten til å se at årstallet manglet — og det er
nettopp den slutningen brukeren skal få vite om («Årstallet sto ikke på
billetten — satt til 2026»).

**Et tomt felt slår et gjettet felt.** Prompten sier det, og normaliseringen
håndhever det: alt som ikke lar seg lese blir null. Brukeren ser på billetten
uansett, men et utfylt felt blir trodd.

**`parseTicketTime` krever minutter.** «kl 19» finnes på plakater, men et
arrangement 19:00 og et 19:30 er ulike kvelder. En tapt halvtime er verre enn et
tomt felt.

**Uten årstall velges første framtidige forekomst.** En billett gjelder aldri
noe som har vært. «2. mars» lest i september er 2027, ikke mars som gikk.

**Forberedelsene er en LISTE, ikke to kolonner.** Transport og barnevakt er de
to som går igjen og legges på automatisk; overnatting, billetter hentet og
middag før ligger som forslag ett trykk unna, og egne punkter kan legges til.
To uhakede punkter ser ut som det de er — fem ser ut som en jobbliste man ikke
har begynt på.

**Endepunktet for forberedelser tar en HANDLING, ikke hele lista.** Flere
avkryssinger kan skje raskt etter hverandre, og en klient som sender hele lista
ville overskrevet en samtidig endring med sin egen litt gamle kopi.

**`describePrep` navngir punktene.** «Mangler barnevakt» kan handles på; «1 av 2
igjen» tvinger deg til å åpne arrangementet for å finne ut hva. Samme regel som
`describeOpenItems` i dags-nudgene.

**«Over» måles mot DAGEN, ikke klokkeslettet.** En konsert kl. 19 står under
«kommende» hele den dagen. Flyttet den seg til «tidligere» kl. 19:01 mens
brukeren sto i køen, ville lista sett ut som en feil.

**Et arrangement uten tidspunkt sorteres SIST på sin dag** (`24:00`), ikke
først. En konsert vi ikke har lest tidspunktet på skal ikke legge seg over
frokosten i dagsvisningen.

**Arrangementer står over Spond-linjene i dagsvisningen, og med mer plass.** En
konsert med billett er dagens ankerpunkt, ikke en linje blant flere.
Forberedelsene vises som tekst der og hakes av på `/arrangementer` — dagen det
skjer er for sent å ordne barnevakt.

**`Checkbox` fikk `ariaLabel` og `dataTrack`.** Uten dem ender hver avkryssing
som en anonym `input[checkbox]` i bruksstatistikken, og komponenten er delt, så
attributtet må være en prop. `Input` og `DateInput` hadde dem fra før.

## Verifisering

- 84 nye enhetstester i `src/lib/domain/events/`; `npm test` grønt (327 filer,
  4846 tester).
- `npm run check` — 0 feil.
- `npm run build` — grønt.
- Ikke kjørt mot en base eller i nettleser i denne økta (ingen Postgres i
  miljøet), så migrasjonen og flatene er ikke røykttestet. Visuelle tester er
  ikke kjørt.

## Kjent rest

- **Ingen varsling.** Et arrangement med uordnet barnevakt to dager før sier
  ingenting. Den naturlige koblingen er `digest-nugget-rules.ts`, som alt
  rangerer det som fyrer én gang over det som er sant hver morgen — et
  arrangement med åpne forberedelser er nettopp den første typen.
- **Ingen chat-inngang.** `createEvent` er klar for et verktøy, og
  `query_*`-familien har ingen leser over `listEvents`.
- **Ingen kobling til økonomi.** Billettkjøpet ligger i
  `canonical_bank_transactions` med kategori `arrangement`, og et arrangement
  vet ikke om det.
- **Ingen kobling til tema.** `themeId` finnes på raden, men ingen flate setter
  den.
- **Billettbildet lastes opp til Cloudinary uten `userId` i mappa**, som resten
  av vedleggene i repoet. Url-en er hemmelig-ved-uklarhet, ikke tilgangsstyrt.
- Ingen seksjon på `/design` ennå.
