# Vedvarende samtaletråd for Ekko-coachen

Dato: 2026-06-21
Status: ferdig

## Kontekst

`POST /api/apps/coach` var statsløst: hvert kall sto alene, så coachen kunne ikke følge opp
en tidligere tur. Ekko-klienten er allerede bygd for en server-holdt samtaletråd og venter på
at serveren skal eie tilstanden. Serveren nøkler tråden på `(token-bruker, conversationId)`;
klienten sender bare ny ytring + en opak, server-generert `conversationId` (null første gang).

Server-kontrakten kom fra klient-teamet og er bakoverkompatibel: kall uten `conversationId`
skal oppføre seg nøyaktig som før (statsløst engangssvar — brukes av etter-økt-vurderingen).

## Faser

### Fase 1: Delt struktur med resonans + `source`-skille

Coach-trådene lagres i de **eksisterende** `conversations`/`messages`-tabellene (ikke egne
coach-tabeller), via den delte tjenesten i `src/lib/server/conversations.ts`. De arver gratis:

- tittel-generering fra første brukermelding,
- person-mention-indeksering,
- `updatedAt`-bumping og eksisterende sletting (`DELETE /api/conversations/[id]`).

Ny kolonne `conversations.source` (`'web'` | `'ekko'`, default `'web'`, migrasjon
`0022_conversations_source.sql`) skiller hvilken flate en samtale oppsto på. Coach-tråder lagres
som `'ekko'` og holdes ute av web-chatlisten: både `getUserConversationList` (`/samtaler` + hjem)
og `getOrCreateConversation` (web-chattens aktive-samtale-fallback) filtrerer nå på `source = 'web'`.
Eksisterende rader får `'web'` via DEFAULT. En **handoff** av en ekko-tråd inn i web-chatten gjøres
senere ganske enkelt ved å sette `source` til `'web'`.

### Fase 2: Tråd-adapter

`src/lib/server/programs/coach-conversation.ts` er et tynt lag over `conversations.ts`:
opprett (`createConversation`), eierskaps-sjekk (`getConversationByIdForUser`), last
`user`/`assistant`-turer (filtrerer bort eventuelle `system`-meldinger fra web-chatten),
append via `addMessage`, og slett (speiler den eksisterende conversation-DELETE-en). I tillegg
en ren, testet `selectContextWindow()` som beholder de 20 nyeste turene ordrett og rapporterer
hvor mange eldre som ble droppet.

### Fase 3: LLM-runner

`runCoachConversationTurn()` i `coach.ts` bygger LLM-kontekst av (i rekkefølge):
samtalepartner-system-prompt → valgfri program-kontekst → trunkerings-notis → trådhistorikk
→ efemær situasjonskontekst → ny ytring. Felles LLM-kall (`callCoach`) deles med den statsløse
`runProgramCoach`.

### Fase 4: Endepunkter

- `POST /api/apps/coach`: aksepterer nå `conversationId?` og `context?`. Tråd-modus aktiveres når
  feltet `conversationId` er med (også `null`). `null` ⇒ ny tråd (opprettes først etter at
  LLM-svaret er i havn, så feilede kall ikke legger igjen tomme tråder); kjent id ⇒ last historikk;
  ukjent/eid av annen bruker ⇒ `404`. Lagrer kun `user`/`assistant`-turene — aldri efemær `context`.
- `GET /api/apps/coach/conversations/[id]`: gjenoppretting for visning (turer + ISO-tidsstempler).
- `DELETE /api/apps/coach/conversations/[id]`: «glem samtalen» — sletter den delte conversation-raden.

## Beslutninger

- **Delt struktur med resonans + `source`-skille (etter ønske):** coach-tråder er resonans-samtaler
  (samme tabeller), men en `source`-kolonne skiller flatene. Coach-tråder (`'ekko'`) holdes ute av
  web-chatlisten nå, mens kolonnen gir grunnlag for en framtidig handoff (sett `source = 'web'`).
  Eierskaps-sjekken er fortsatt kun bruker-scopet (ikke source-scopet), så en handet-off tråd kan
  fortsettes fra begge flater.
- **Tråd-modus utløses av feltets tilstedeværelse, ikke av en sann verdi.** Kontrakten sier både
  «null/utelatt ⇒ ny tråd» og «kall uten conversationId = som før (statsløst)». For å unngå at
  etter-økt-vurderingen (som ikke sender feltet) plutselig begynner å persistere tråder, tolker vi
  *fravær av feltet* som statsløst og *tilstedeværelse (inkl. `null`)* som tråd-modus.
- **Efemær `context` lagres aldri** — injiseres som en system-melding kun for inneværende tur.
- **Samtalepartner-system-prompt** i tråd-modus, med guardrails: ingen markdown, ingen oppdiktede
  tall, og «unngå ordet ekko» (klientens barge-in-vekkeord).

## Verifisering

- `npm test` — alle tester grønne (inkl. 6 for `selectContextWindow`).
- `npm run check` — 0 feil, 0 advarsler.
- Manuell kontrakt-gjennomgang mot Ekko-spec: bakoverkompatibilitet (kall uten `conversationId`),
  eierskaps-404, efemær context lagres ikke, `text` + `conversationId` i 200-svar.
