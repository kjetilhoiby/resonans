# Hybrid klient-verktøy — serverkontrakt (svar til Ekko)

Dato: 2026-06-24
Status: implementert (server)

Svar på handoffen `ekko/ASSISTANT_HYBRID_TOOLS.md`. Server-halvdelen er bygd. Under: hva som er
bekreftet, og den ene tingen Ekko må justere.

## Bekreftede beslutninger

### Resume-semantikk: NY strøm per etappe (ikke hold-open)
Handoffen lot dette være serverens valg. Vi velger **ny strøm per etappe** fordi appen kjører på
Vercel serverless: en `POST /tool-result` lander som en separat request (potensielt på en annen
instans) og kan ikke mate en allerede åpen strøm-controller uten ekstern pub/sub.

Konkret: `POST /api/apps/assistant/tool-result` **svarer selv med SSE-strømmen** som fortsetter
samtalen. Klienten trenger altså ikke å gjenåpne `/assistant` — den leser fortsettelsen rett fra
tool-result-svaret.

→ **Ekko må justere antakelsen** «den åpne strømmen fortsetter». Den opprinnelige `/assistant`-
strømmen LUKKES etter `suspended`. Fortsettelsen kommer som svar på `tool-result`-POSTen.

### Transport: SSE (ikke NDJSON)
`/assistant` og `/tool-result` bruker `text/event-stream` (`event: <type>\ndata: <json>\n\n`),
ikke NDJSON. Eventtyper:
- `start` `{ conversationId }` — sendes før annet (også for nye tråder, etter at id-en finnes).
- `delta` `{ text }` — tekstfragmenter.
- `tool_call` `{ id, name, args }` — kjør dette klient-verktøyet (args = kun strenger).
- `suspended` `{ conversationId, toolCallIds }` — strømmen lukkes nå; POST resultater.
- `complete` `{ ok, text, conversationId, usedTools }`.
- `error` `{ code }`.

## Flyt

1. Klient → `POST /api/apps/assistant` `{ prompt, conversationId?, context?, stream:true }`.
2. Server strømmer `delta`. Kaller modellen et klient-verktøy: server lagrer suspendert tilstand,
   sender `tool_call` (ett pr kall) + `suspended`, og **lukker strømmen**. Brukerturen er lagret.
3. Klient kjører verktøyet on-device og → `POST /api/apps/assistant/tool-result`
   `{ conversationId, toolCallId, result }`.
4. Server legger resultatet inn i agent-tilstanden.
   - Flere kall i samme runde ubesvart → JSON-ack `{ ok, pending:true, remaining:[...] }`. POST de
     resterende.
   - Alle besvart → svaret er en **ny SSE-strøm** som fortsetter (`delta` … og enten `complete`
     eller en ny `tool_call`+`suspended`-runde).
5. Ved `complete` er assistentturen lagret. Turen er ferdig.

## Allow-list (server tilbyr disse til modellen, kjører dem aldri)
`driveDistance { to }`, `resolvePlace { name|to }`, `nearestPlace {}`, `sendToCar { to }`.
args er kun strenger. `result`-objektet lagres ordrett som tool-svar til modellen — alle felt
valgfrie (distanceKm, etaMinutes, destinationName, placeName, found, shareURL, error).
Feil rapporteres ved å sende `result.error` (modellen forklarer da pent for brukeren).

## Detaljer / begrensninger
- **Én aktiv suspendert tur pr samtale.** En ny suspensjon erstatter en eldre. Pending-rader
  eldre enn 2t TTL-ryddes (klienten kom aldri tilbake).
- **Ikke-strømmende `/assistant`** tilbyr ikke klient-verktøy (kan ikke suspendere uten strøm) —
  JSON-kontrakten er uendret.
- **`context`-feltet** injiseres allerede per tur (efemært, aldri lagret).
- **Server-side kjøreruting (OSRM) er fjernet** — ruting/steder eies nå av klienten (personvern:
  `SavedPlace`-koordinater forlater aldri enheten). Serveren beholder `nearby_chargers` og
  `query_tesla_vehicle`.

## Datamodell
Ny tabell `assistant_pending_turns` (migrasjon `0023`): `messages` (OpenAI-array så langt),
`pending_tool_calls`, `used_tools`, scoped til bruker+samtale.
