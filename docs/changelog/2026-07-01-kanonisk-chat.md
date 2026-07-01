# Kanonisk chat — chat som ryggrad

Dato: 2026-07-01
Status: pågår (fase 1 + 2 ferdig)

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

### Fase 2: Hopp-til-dag + inline hendelseskort (denne endringen)

- **Hopp inn fra ukeplanen.** `dayKey(date)` gir stabile dag-ankere (`id="dag-YYYY-MM-DD"`)
  på dato-spacerne. Ukeplanens `DaySection` fikk en «Dagbok →»-lenke per valgt dag som går
  til `/samtaler?canonical=1&date=<dag>`. `/samtaler`-lasteren løser opp den kanoniske
  tråden ved `?canonical=1`, og ved `?date=` laster den et dato-vindu
  (`getConversationMessagesFromDate` — dagen og alt etter, med buffer for tidssone) og
  returnerer `scrollToDate`. Klienten scroller til dag-ankeret; infinite-scroll-oppover
  henter eldre meldinger som før. Tom dag faller tilbake til vanlig «nyeste»-lasting.
- **Inline hendelseskort.** Rammeverk-agnostisk `src/lib/chat/event-cards.ts`
  (`ChatEventCard`, `buildCheckinEventCard`, testet) beskriver et kompakt kort lagret i
  `message.metadata.eventCard`. `ChatMessages.svelte` rendrer kortet (med valgfri
  deep-link). `ChatMessage` fikk `eventCard`. Server-writer `addCanonicalEventMessage`
  skriver et kort inn i ryggraden; `POST /api/conversations/canonical/event` lar
  klient-flyter gjøre det samme.
- **Første produsent.** En egenfrekvens-innsjekk med skreven refleksjon legger nå igjen et
  hendelseskort i dagboken (`submitEgenfrekvensCheckin`, fire-and-forget) — «prate med
  underbevisstheten». Kun refleksjoner, ikke kjappe morgen/kveld-tap, for å holde støyen
  nede.

### Vedlegg: pen visning i stedet for triage (denne endringen)

Vedlegg fra hjem-/kanonisk-chatten gikk før alltid gjennom den kalde
`/api/attachment-triage` (LLM-oppsummering + suggested-actions + auto-registrering av
tracking + skjermtid-parsing) — en funksjon som i praksis aldri ble brukt, og som la en
vegg av tekst rundt bildet.

- **Slank sti nå.** `submitCamera`/`submitVoice`/`submitFile` (`home-media.ts`) laster opp
  via den eksisterende slanke `/api/attachment-extract` (opplasting + innholdsuttrekk, ingen
  triage, ingen sideeffekter) og sender bildet + bildeteksten rett i tråden via `sendChat`.
  Resultat: pent bilde + valgfri kontekst («barna sover»), naturlig chat-respons, ingen
  auto-logging. Google Sheet-snapshot beholder sin egen flyt.

### Fase 3: Langpress-meny på bilde (denne endringen)

Langtrykk på et bilde i tråden gir en liten meny: **Beskriv / legg til kontekst**,
**Registrer i serie**, **Fjern**.

- **Id-plumbing (blokker løst).** Chat-strømmen returnerer nå `userMessageId` og
  `assistantMessageId` (`/api/chat`), og `ChatState` fester dem som `ChatMessage.dbId`.
  I `/samtaler` er `dbId = id` (allerede DB-id). Redigering/sletting bruker `dbId`, så
  persistent Beskriv/Fjern virker i begge flater. Beskriv/Fjern vises kun når `dbId` finnes.
- **Gjenbrukbar langtrykk.** Ny `src/lib/actions/longpress.ts` (`use:longpress`) — pointer-
  basert, samme mønster som dagsoppgavelistene, men uten duplisert timer-logikk.
- **Meny + handlinger.** `ChatImageMenu.svelte` (fixed-posisjonert, klikk-utenfor lukker,
  egen «beskriv»-visning). `ChatMessages` fikk callbacks `onImageDescribe/onImageRemove/
  onImageRegister`; wiret i hjem-chatten (`HomeChatZone`) og `/samtaler`. Backend: meldings-
  `PATCH` tar nå `content`, og fikk `DELETE` (`messages/[messageId]`), begge eierskaps-sjekket.
  «Registrer i serie» sender bildet til chatten med instruks om tracking-verktøyet (triage
  på forespørsel, ikke automatisk).

### Respons i dagboken (denne endringen)

- **Send-kø-fiks.** Meldinger med bilde/vedlegg hoppet før over sende-køen og kjørte
  samtidig med en pågående strøm; det bumpet generasjonstelleren, så det forrige svaret ble
  forkastet klient-side (to bilder rett etter hverandre → coach-svar forsvant). `ChatState`
  køer nå *alle* sendinger med full payload (tekst + bilde + vedlegg), så hvert innlegg får
  sitt eget svar i rekkefølge.
- **Vedlegg festes i skrivefeltet (A).** Kamera/fil/lyd sender ikke lenger umiddelbart.
  Etter opplasting festes vedlegget i skrivefeltet (`pendingImageUrl`/`pendingAttachment` i
  `HomeScreen`, vist som en chip i `HomeChatZone`), chatten åpnes fokusert med bildeteksten
  som utgangspunkt, og bilde + tanker sendes som **én** melding. `submitCamera/Voice/File`
  ble slanket til `(state, closeFn, onReady)`. Dette lar brukeren forankre en refleksjon i
  bildet i stedet for å fyre av løsrevne enkeltbilder. (Fler-bilde per melding = fase 4 «B».)
- **Ingen egen dagbok-tone.** Vurderte et «Dagbok-modus» i systemprompten, men forkastet det
  bevisst: brukeren styrer dybden via selve meldingen (kort deling → lett svar; refleksjon →
  substansielt svar). Den kanoniske tråden bruker samme coach/tone som ellers.

### Fase 4 (ikke i denne endringen)

- **Flere bilder per melding (B).** La én melding bære flere bilder (i dag ett `imageUrl`) —
  datamodell + Vision-API (flere `image_url`) + rendering av flere miniatyrer.
- **Flere produsenter.** Fullført økt, nudge-respons og flyt-fullføring som hendelseskort
  (via `addCanonicalEventMessage` / event-endepunktet).
- **Referanse-kort** fra tema-/flyt-samtaler inn i den kanoniske visningen (deep-link til
  kilden, ikke kopierte meldinger).
- **Dagbok fra forsiden.** Vurder om hjem-chatten skal laste ryggrad-historikk ved åpning
  (mer dagbok-følelse) vs. beholde den rene «tøm hodet»-inngangen. Produktbeslutning.
- **Dedup langtrykk.** Migrer de resterende inline-langtrykk-variantene (action-pills,
  tema-rader, `ChecklistItemRow`) til den nye `longpress`-actionen.

## Verifisering

- `npm run check` (TypeScript + Svelte) grønn (0 feil, 0 advarsler).
- `npm test` grønn — 900 tester, inkl. nye enhetstester for `chat-day-sections.ts`
  (dato-spacere + `dayKey`) og `event-cards.ts` (kort-bygging).
- Dato-spacere + dag-ankere bekreftet i `/samtaler`-visningen; hopp-til-dag via
  `?canonical=1&date=`; hendelseskort rendres fra `metadata.eventCard`. Bakoverkompatibelt:
  ingen spacere/kort i kontekster uten tidsstempler/metadata.
