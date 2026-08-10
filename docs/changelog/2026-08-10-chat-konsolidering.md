# Chat-flatene på felles kode

Dato: 2026-08-10
Status: ferdig

## Kontekst

«Hvorfor kan ikke alt konsolideres til felles kode?»

Svaret var: det kan det, og det meste burde allerede vært det. Da vi målte, satt tre
flater — bok, film-per-film og film-på-tema — med **hver sin håndskrevne kopi av
SSE-løkka**. 35 linjer ×3 som parser `data: `-linjer, teller tokens og plukker
`complete`-payloaden, mens `streamProxyChat` hadde gjort det samme siden mars, og
`ChatState` hadde pakket det med avbrudd, watchdog, retry, kø og stopp-knapp.

De var ikke skrevet fordi noe var spesielt ved bok eller film. De var skrevet fordi
`ChatState` ikke fantes ennå da fanene ble laget, og ingen gikk tilbake.

Samme mønster på tvers: fire flater lastet hele tråden i ett kall, fem hadde hver sin
`{ role, text }`-array uten id, og pagineringen fantes i to varianter som ikke helt
mente det samme.

## Faser

### Fase 1: Radene

`$lib/client/chat-thread-rows.ts` — oversettelsen fra lagret rad til `ChatMessage`, med
de tre reglene som må være like overalt: DB-id-en beholdes som `id` (ellers virker ikke
dedupliseringen), system-meldinger filtreres bort ved visning, og markøren regnes fra
den **ufiltrerte** lista.

Serveren fikk `X-Oldest-Cursor`. Klienten kunne ikke utlede markøren selv: svaret er
system-filtrert, så «eldste viste rad» ville hentet system-meldingene om igjen i hver
runde — og en side som bare inneholdt system-meldinger ville stoppet pagineringen helt.

### Fase 2: Historikk inn i ChatState

`hydrate()`, `loadThread()`, `loadOlder()`, `hasMore`, `loadingOlder`, `historyError`.
Endepunktet, sidestørrelsen, markøren og dedupliseringen bor nå ett sted.

`setConversationId()` nullstiller markøren. Uten det ville lasting oppover i en ny
samtale hentet «før» et tidspunkt fra en helt annen tråd.

### Fase 3: ChatThread

`ui/ChatThread.svelte` — hele meldingsruten: scroll-container, bunnforankring, hent-ved-
scroll-opp med posisjonsbevaring, «henter eldre», tom-tilstand og `ChatMessages`.

Den tar **primitiver, ikke en ChatState**, fordi ikke alle flater har en: flyt-stegene
serialiserer tråden sin inn i `flowData` for localStorage-rehydrering, og lønnsmåned
holder én tråd per steg. En ChatState-signatur ville stengt dem ute fra pana.

### Fase 4: Bok og film på ChatState

De tre SSE-løkkene er borte. Bok beholder sine to særtrekk gjennom eksisterende kroker:

- `onAssistantMessage` fanger `<!--FREMDRIFT:n/m-->`, fyrer `onAutoProgress` og
  stripper taggen før meldingen vises.
- `SendOptions.displayText` — nytt — skiller boblen fra prompten. Brukeren ser
  «🎵 Lydklipp», modellen får hele transkripsjonen.

`BookDashboard` og `FilmDashboard` eier ikke lenger tråden: `chatMessages`,
`chatMessagesLoaded` og `onChatMessage` er fjernet fra begge.

### Fase 5: Dødt lokk av

- `$lib/client/streaming-chat.ts` (259 linjer, to SSE-løkker) — null konsumenter.
- `streamChatMessages` ut av `BookTabsApi` og `FilmTabsApi`.
- `/samtaler` sin lokale `toChatMessages` og pagineringsmarkør.

Netto: **−1001 / +398 linjer.**

## Beslutninger

- **`ChatThread` tar primitiver.** Se fase 3. To innganger (ChatState *eller*
  primitiver) ville vært en lukt; å kreve ChatState ville utelatt flyt og lønnsmåned.
- **`initialMessages` som escape hatch.** `/design`-galleriet mocker nettverket gjennom
  `api`-propen, men tråd-lastingen går nå gjennom ChatState og forbi den. Bok- og
  film-fanene tar derfor en ferdig tråd når den er oppgitt, og hopper over kallet.
- **Klassen på en komponent treffer ikke scoped CSS.** `class="bk-chat-messages"` på
  `<ChatThread>` lander på et element i en *annen* komponent, så forelderens regel
  (`.bk-chat-messages.svelte-hash`) matcher ikke. Flate-spesifikk ramme må være
  `:global(...)`. Dette er en stille feil — ingen advarsel, bare stiler som forsvinner.
- **`overflow-y: scroll`, ikke `auto`, beholdes** på bok/film sammen med
  `-webkit-overflow-scrolling: touch`. Det er iOS-momentum-oppsettet deres, og `auto`
  er ikke det samme.

## Hva som IKKE lot seg konsolidere, og hvorfor

- **Hvem eier tråden.** Flyt-stegene serialiserer tråden til `flowData` fordi den skal
  overleve en reload midt i et intervju; lønnsmåned holder én per steg. Det er ekte
  forskjeller i livssyklus, ikke duplisering. Begge bruker `ChatThread` for visningen.
- **`/samtaler` sin rute.** Hopp-til-dag, «dag i view»-undertittel og målte
  header/input-høyder som styrer scroll-padding. Den beholder sin egen container, men
  bruker de samme reglene (`chat-scroll.ts`) og den samme pagineringen
  (`chat.loadOlder()`).
- **Ekko.** `/api/apps/assistant` og `/api/apps/coach` kjører agent-løkka på serveren
  fordi en app-binær ikke skal holde nøkler eller verktøylogikk. Verktøyene deles
  allerede gjennom `server/assistant/shared-tools.ts`; transporten skal ikke deles.

## Verifisering

- `npm run check` — 0 feil, 0 advarsler.
- `npm test` — 3051 tester i 230 filer, alle grønne (22 nye for rader og scroll).
- Ikke verifisert mot prod-data. Bok- og film-chattene har byttet både transport og
  tråd-eierskap, så de bør røykestestes: åpne en bok med historikk, send en melding,
  send et skjermbilde av en lydspiller (fremdriftstaggen), og bytt bok med chat-fanen
  åpen.
