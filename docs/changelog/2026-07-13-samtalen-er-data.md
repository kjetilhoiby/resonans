# «Samtalen er data»: Råtekst-bevaring i Retning-systemet

Dato: 2026-07-13
Status: ferdig (ende-til-ende-verifisering gjenstår i dev)

## Kontekst

Retning-systemet (se `2026-07-12-retning-livsintervju.md`) fulgte bursdagsintervju-mønsteret:
modellskrevne `<status>`-destillater lagres som visjoner, transkripter arkiveres. Brukeren har
erfart at slike løsninger reduserer kvalitet når oppsummeringer i praksis erstatter råteksten —
konkretiserings-/prioriteringsøvelser underveis er fine, men samtalene er verdifulle i sitt
opprinnelige format.

Kartleggingen fant én god nyhet og fire problemer:

- **Godt nytt:** Flow-chatter går gjennom den ekte chat-pipelinen — hvert replikkskifte lagres
  allerede ordrett i `messages`-tabellen, uavhengig av destillatene.
- **Overskriving:** Transkript-refleksjonene brukte `upsertReflectionForPeriod` — et re-intervju
  samme periode slettet forrige samtale fra refleksjonslaget.
- **Skrivebeskyttet arkiv:** Ingenting leste transkriptene tilbake (ingen AI-verktøy, kavalkaden
  leser bare destillat) — «indeks, ikke erstatning» var i praksis erstatning.
- **Prompt-bloat:** `ContextService.recentReflections` dumpet siste 7 dagers refleksjoner
  utrunkert og uten kind-filter — et langt transkript ville blåst opp hver systemprompt i en uke.
- **Uten kontekst og kilde:** Intervjuturene ble appendet til brukerens *nyeste* web-samtale
  (utitulert, blandet med vanlig chat), og visjonene manglet `inputRefs` til kilden.

**Bugfunn:** `forceNewConversation` var en stille no-op på proxy-stien —
`chat-stream-messages/+server.ts` destrukturerte flagget men videresendte det ikke til
`_runChatRequest`. Eneste eksisterende bruker (lønnsmåned-chatten) var dermed stille brukket.

## Faser

### Del 1: Små, sikre fikser

- **Append-only transkripter:** `livsintervju_chat`, `retningssamtale` og
  `birthday_interview_chat` bruker nå `createReflection` — hver gjennomkjøring blir en ny rad.
  Destillater/state (`livsintervju`, `retningsgap`, `birthday_interview`) beholder upsert; de ER
  indeksen. Eksistenssjekker (`getReflectionForPeriod` = `findFirst` desc) er upåvirket.
- **Prompt-bloat-vern:** ny ren modul `src/lib/server/services/reflection-block.ts`
  (`TRANSCRIPT_REFLECTION_KINDS` + `buildReflectionsBlock`, testet): transkript-kinds og
  `birthday_photos` (JSON) holdes helt utenfor systemprompten, hver refleksjon trunkeres til
  ~700 tegn med «… [forkortet]». `ContextService.recentReflections` over-henter (limit 12) og
  delegerer rendering.
- **Kildekobling:** `dreams.inputs`-typen fikk `conversationIds` (jsonb, ingen migrasjon);
  `saveAuthoredVision` tar `inputRefs` og retning-rutene sender
  `{ reflectionIds: [destillat, transkript], conversationIds }` — hver visjon kan spores til
  samtalen den kom fra. NB: `getConversationByIdForUser(conversationId, userId)` — id først.

### Del 2: Egne, titulerte samtaler for intervjuflytene

Hele kjeden FlowSheet → ChatState → streamProxyChat → chat-stream-messages → `_runChatRequest`
→ `createConversation`:

- `createConversation` tar valgfri tittel (eksplisitt tittel overlever auto-titling, som kun
  overstyrer generiske titler).
- `_runChatRequest`: `conversationTitle` i body; **tema-routing gates av
  `forceNewConversation`** så flytens første melding ikke tema-kapres; no-op-buggen fikset i
  `chat-stream-messages` (regresjonsfikser lønnsmåned).
- `ChatStateOptions`: `forceNewConversation` (sendes kun når `conversationId` mangler — aller
  første melding; `reset()` bevarer id-en så alle steg deler samtalen) + `conversationTitle`.
- `Flow.conversationTitle?: string | ((data) => string)` — tilstedeværelse = flyten eier egen
  samtale. Satt på `livsintervju` («Livsintervjuet 2026»), `retning_kvartal`
  («Retningssamtalen 2026-Q3») og `birthday_interview` («Selvangivelsen 2026»).
- FlowSheet: `onPayload` fanger `conversationId` inn i `flowData._conversationId` (overlever
  resumable-utkast i localStorage, følger med til `flow.onComplete`);
  `getOrCreateConversationId` gjenopptar samme samtale etter reload; `restartFlow()` nullstiller
  også ChatState-samtale-id-en så omstart gir fersk samtale.
- Samtalene har `source: 'web'` → synlige i samtalelisten, åpnes via
  `/samtaler?conversation=<id>`.

### Del 3: Lesetilgang — indeks → fulltekst ved behov

- **Nytt AI-verktøy `query_reflections`** (`src/lib/ai/tools/query-reflections.ts`): henter
  refleksjoner/transkripter i fulltekst etter `kind`/`periodKey` (default 3, maks 10, nyeste
  først). Registrert i chat-rutens tools-array, dispatch og progress-labels («Leser
  refleksjoner...»).
- Retningsblokken (`direction-context.ts`) sier eksplisitt at visjonene er destillater og at
  fullteksten hentes med `query_reflections` — kun når retningen er brukerforfattet.
- Retning-siden: `<details>` «📜 Hele intervjuet» med siste `livsintervju_chat`-transkript
  (`getLatestReflection`, ny hjelper i `reflections.ts`) og lenke «Åpne intervjusamtalen →» til
  rå-samtalen (via `dreams.inputs.conversationIds`).

## Beslutninger

- **Rå-samtalen er primærkilden, tre lag:** (1) `messages`-tabellen har alt ordrett — nå i egen
  titulert samtale per intervju; (2) transkript-refleksjoner er søkbart arkiv, append-only;
  (3) destillater er indeks og kan overskrives. Verktøy og UI leser nedover i lagene ved behov.
- **Destillatene beholdes som upsert** — de skal alltid speile gjeldende retning, historikken
  bor i supersede-kjeden (visjoner) og de append-only transkriptene.
- **`conversationTitle` som opt-in på Flow-nivå** — små flyter (egenfrekvens, inbox-notat) skal
  fortsatt lande i hovedchatten; bare de store intervjuene fortjener egen tråd.
- **Ingen embedding/søk ennå** — `query_reflections` er kind/periode-basert; semantisk søk kan
  komme når memories får vector-støtte.

## Verifisering

- `npm test`: 1333 tester grønne (8 nye: reflection-block + direction-context-hint).
  `npm run check`: 0 feil.
- **Gjenstår i dev (krever DATABASE_URL/OPENAI_API_KEY):**
  1. Kjør livsintervjuet → egen samtale «Livsintervjuet 2026» i samtalelisten, alle fem steg i
     samme tråd, ingen tema-kapring av første melding.
  2. Re-kjør intervjuet → NY `livsintervju_chat`-rad (forrige bevart), destillat oppdatert.
  3. Sjekk `dreams.inputs` på visjonene: `reflectionIds` + `conversationIds` satt.
  4. `/drommer`: «Hele intervjuet»-transkript synlig, lenken åpner intervjusamtalen.
  5. Vanlig chat: spør «hva sa jeg i livsintervjuet om …» → `query_reflections`-kall.
  6. Regresjon: lønnsmåned-chatten (`/economics/lonnsmaned`) får faktisk ny samtale.
