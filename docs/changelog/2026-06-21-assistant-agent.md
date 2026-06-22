# Verktøy-bevisst assistent-agent for Ekko

Dato: 2026-06-21
Status: ferdig

## Kontekst

Kjøre-/hverdagsbruken i Ekko trenger mer enn den raske, statsløse coachen: en vedvarende,
verktøy-bevisst samtaleagent med generell Resonans-tilgang som kan svare på brede spørsmål
(«hvordan ligger jeg an, og hva bør jeg gjøre i morgen?») ved å hente faktiske data.

Bestillingen er **additiv**: `/api/apps/coach` og `/api/apps/programs/{id}/insight` er uendret.
Coach og assistent har ulike driftsprofiler (coach = lav latens, én rundtur, ingen verktøy;
assistent = tåler fler-stegs agent-løkke med server-kjørte verktøy), derfor et eget endepunkt.

## Faser

### Fase 1: Delt tråd-infrastruktur, parallell flate

Assistent-tråder lagres i de samme `conversations`/`messages`-tabellene som coach og web, men
med `source = 'ekko-assistant'` (utvidet `ConversationSource`). Eierskaps-oppslagene
(`src/lib/server/assistant/conversation.ts`) er **source-scopet**, så en assistent-tråd og en
coach-tråd aldri forveksles på tvers av endepunktene. Web-chatlisten viser fortsatt kun `'web'`,
så ingen ekko-tråder lekker dit.

Det rene kontekst-vinduet (`selectContextWindow`) ble flyttet til en nøytral modul
`src/lib/server/conversation-window.ts` og deles nå av coach og assistent. `coach-conversation.ts`
re-eksporterer det uendret, så coach-kontrakten er uberørt.

### Fase 2: Agent-løkke + verktøy

- `src/lib/server/assistant/tools.ts`: read-only verktøy scoped til token-brukeren, som gjenbruker
  eksisterende datalag — `programList`, `programDetail`, `programToday`, `recentSessions`,
  `athleteContext`, `dayPlan`, `teslaState` (alltid LAGRET tilstand, aldri `live` — vekker ikke bilen).
  Ingen muterende verktøy i v1.
- `src/lib/server/assistant/assistant.ts`: server-kjørt agent-løkke (LLM → verktøy → LLM …) med
  tak på 6 runder; siste runde tilbyr ikke verktøy, så et tekstsvar tvinges fram. Generell,
  talevennlig norsk system-prompt uten markdown.
- `pickRecentCompletedSessions` (ren, testet) trukket ut i `recent-sessions.ts`.

### Fase 3: Endepunkter

- `POST /api/apps/assistant`: samme request/response-form som coach-tråden + valgfri `usedTools`
  i svaret. Ny tråd opprettes først etter vellykket svar; `502` (`assistant_generation_failed`)
  ved LLM-/verktøy-feil.
- `GET`/`DELETE /api/apps/assistant/conversations/[id]`: gjenoppretting og «glem samtalen»,
  source-scopet til assistent-tråder.

### Fase 4: Additiv opt-in streaming (SSE)

`POST /api/apps/assistant` støtter nå strømming av det endelige svaret, opt-in via
`Accept: text/event-stream` eller `stream: true` i bodyen. JSON-kontrakten er **uendret** for
klienter som ikke ber om det — additivt, så dagens ekko er uberørt til de bygger en consumer.

- Agent-løkka løser verktøyrundene server-side (akkumulerer verktøykall-fragmenter fra streamen);
  når modellen til slutt svarer med tekst, sendes token-fragmentene som `delta`-events.
- Events: `start` { conversationId } (kun ved eksisterende tråd), `delta` { text },
  `complete` { ok, text, conversationId, usedTools }, `error` { code }.
- 401/400/404 forblir rene JSON-svar (sjekkes før streamen åpnes). Full tekst bufres uansett
  server-side for persistering, og er også med i `complete` for robusthet.

## Beslutninger

- **Eget endepunkt, ikke ny coach-modus:** tool-calling endrer request/response-livssyklusen
  (fler-stegs); det skal ikke ligge på coach-stien som fyrer av midt i et intervalldrag.
- **`source = 'ekko-assistant'` + source-scopet eierskap:** holder assistent- og coach-flatene
  adskilte og parallelle, selv om de deler tabeller. Web-listen filtrerer fortsatt `'web'`.
- **Kun lese-verktøy i v1, Tesla aldri `live`:** agenten skal ikke endre data eller vekke bilen.
- **Klienten kjører ingen verktøy:** serveren eier løkken og returnerer kun ferdig tekst, så
  Ekkos `AssistantViewModel` bare bytter sti fra `/coach` til `/assistant`.

## Verifisering

- `npm test` — 675 tester grønne (inkl. 5 nye for `pickRecentCompletedSessions`; coach-vinduets
  tester går fortsatt via re-eksporten).
- `npm run check` — 0 feil, 0 advarsler.
- Kontrakt-gjennomgang mot bestillingen: tråd-semantikk lik coach, efemær `context` lagres ikke,
  eierskaps-/source-404, `text` + `conversationId` (+ valgfri `usedTools`) i 200-svar, coach uendret.
