# Kanonisk chat — chat som ryggrad

Dato: 2026-07-01
Status: pågår

## Kontekst

Visjonen sier *«Samtalen er data»* og *«chat fungerer med smal, rik kontekst»* — og
intensjonen har hele tiden vært at chat skal være **ryggraden** i Resonans. I praksis
har det blitt omvendt: brukeren chatter av og til 2–5 meldinger inne i et tema eller som
respons på en nudge, men kommer aldri ordentlig i gang med chatten som en løpende flyt.

To ting driver friksjonen:

1. **Fragmentering.** Meldinger lever mange steder — temascoped (`themes.conversationId`),
   personscoped (`conversations.personId`), i flyter (persisteres ofte ikke), og fri
   hjem-chat. Fri chat fra forsiden lager i tillegg en *ny* samtale hver gang
   (`/api/conversations/new`), så ingenting akkumulerer. Det finnes ingen «tråd» å komme
   tilbake til.
2. **Blank side.** Et tomt chat-felt er skummelt. En dagbok som allerede har dagens dato
   (og etter hvert gårsdagens refleksjoner) i seg, inviterer.

Ønsket målbilde (fra bruker): én **kanonisk chattetråd** med avsnitt for hver dag
(dato-spacere i flyten), mulig å hoppe inn til riktig sted fra ukeplanen, med relevante
Resonans-hendelser som inline widgets. Noen chatter (f.eks. flyter) skal fortsatt kunne
stå utenfor den kanoniske tråden. Følelsen skal være «å prate med underbevisstheten».

## Beslutninger

### Kanonisk = ryggrad-samtale + visning, IKKE en ny silo

Dette er den bærende beslutningen. Meldinger lever allerede mange steder. Hvis «kanonisk»
blir en **tredje separat lagringssilo**, oppstår et to-akse-problem: reflekterer jeg om
trening inne i helse-temaet — havner det i temaets samtale eller i den globale? Det gir
duplisering og «hvor ble det av det jeg skrev». Det er kaos.

I stedet:

1. **Ryggraden er én ekte samtale** per bruker (`conversations`-rad med
   `themeId = null`, `personId = null`, `source = 'web'`, `metadata.canonical = true`).
   All fri hjem-chat skriver *alltid hit* i stedet for å lage ny tråd hver gang.
2. **Kanonisk visning** rendrer ryggrad-meldingene gruppert per dag med dato-spacere
   (dagbok-følelsen).
3. **Tema-/flyt-/person-chat dupliseres ikke inn.** De forblir egne samtaler. På sikt
   dukker de opp i kanonisk som *lette referanse-kort* som deep-linker til kilden — aldri
   som kopierte meldinger. Én sannhet per melding.

### Default-flate: kanonisk

Fri chat fra forsiden er standard, og standard er ryggraden. Tema, person og flyt er
*merkede omveier*. Dette fjerner «hvor skal meldingen?»-valget som var en del av
friksjonen.

## Faser

### Fase 1: Ryggrad + dato-seksjoner (denne endringen)

- **Ryggrad-samtale backend.** `getOrCreateCanonicalConversation(userId)` i
  `src/lib/server/conversations.ts` finner/oppretter den kanoniske tråden (markert via
  `metadata.canonical = true`, tittel «Dagbok»). Eksponert via
  `POST /api/conversations/canonical`. Type på `conversations.metadata` utvidet med
  `canonical?: boolean` (kun type — ingen DB-migrasjon, feltet er allerede `jsonb`).
- **Dato-spacere.** Ren, testet modul `src/lib/client/chat-day-sections.ts`
  (`formatDayLabel`, `daySpacerBefore`, `isSameDay`, `toDate`) med norske relative
  etiketter («I dag», «I går», ellers «onsdag 25. juni»). `ChatMessage` fikk et valgfritt
  `createdAt`-felt. `ChatMessages.svelte` rendrer en `DaySpacer` før første melding på en
  ny dag — bakoverkompatibelt: uten `createdAt` vises ingen spacer (dagens oppførsel).
- **Kobling.** Hjem-chatten (`HomeScreen.svelte`) resolver `getOrCreateConversationId` mot
  `/api/conversations/canonical` i stedet for `/api/conversations/new`, slik at alt
  akkumulerer i ryggraden. `/samtaler`-visningen sender `createdAt` (fra `m.timestamp`)
  gjennom til `ChatMessages`, så den kanoniske tråden vises med daglige seksjoner der
  historikken faktisk lastes. Klient-sendte meldinger tidsstemples i `ChatState`.

Lesesflaten for dagboken er `/samtaler?conversation=<kanonisk>` (hjem-chatten har allerede
en «Åpne»-knapp dit). Forsiden beholder sin rene «tøm hodet»-inngang.

### Fase 2 (ikke i denne endringen)

- **Hopp inn fra ukeplanen.** Stabile per-dag-ankere i den kanoniske tråden +
  scroll-til-dato, slik at en dag i ukeplanen linker rett til riktig dag i dagboken.
  (`planConversationId` finnes allerede på sjekklister som utgangspunkt.)
- **Inline hendelses-widgets.** Generaliser den eksisterende
  `message.metadata`-widgetmekanismen (`widgetProposal`, `statusWidget`,
  `photoAnnotation`) til noen typede tidslinje-innslag (fullført økt, nudge-respons,
  egenfrekvens-innsjekk) som dukker opp i dagboken.
- **Referanse-kort** fra tema-/flyt-samtaler inn i den kanoniske visningen.

## Verifisering

- `npm run check` (TypeScript + Svelte) grønn.
- `npm test` grønn, inkl. nye enhetstester for `chat-day-sections.ts`.
- Dato-spacere bekreftet i `/samtaler`-visningen (der historikk med tidsstempler lastes);
  ingen spacere i kontekster uten tidsstempler (bakoverkompatibelt).
