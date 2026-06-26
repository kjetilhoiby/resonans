# Ekko-integrasjon: bilferie-quiz

Spesifikasjon for Ekko-siden (iOS). Server-delen (tale-agent, verktøy, skjerm,
endepunkter) er bygd; dette dokumentet beskrider hva Ekko skal lage og hvilket
API som finnes.

## Intensjon

En leken quiz for hele bilen, drevet av stemmen (Ekko), men med en **egen
visuell skjerm** i stedet for snakkebobler: et scoreboard med poeng, streaks
(«on fire!»), gjeldende spørsmål og hvem sin tur det er. Skjermen kan også deles
til et eget nettbrett i baksetet.

## Arkitektur — hvem gjør hva

- **Gameplay** skjer i den vanlige tale-samtalen. Server-agenten kaller verktøy
  (`trip_companions`, `quiz_questions`, `quiz_score`) og eier **all tilstand** i
  databasen (`quiz_sessions`). Ekko kaller *ikke* disse verktøyene direkte — de
  trigges av at brukeren snakker med assistenten.
- **Skjermen** *leser* bare tilstanden (poller) og rendrer den. Ingen skriving
  fra skjermen. Én aktiv quiz per bruker om gangen.
- Fasiten (`answer`) holdes **skjult** til spørsmålet er besvart, så en delt
  skjerm i baksetet ikke røper svaret.

## Ekkos del — to ting å bygge

1. **Gameplay:** ingenting nytt. Fortsett å sende taleturer til
   `POST /api/apps/assistant`. Quiz-evnen ligger allerede i agenten. (Valgfritt:
   send deltakere via `context`, se under.)
2. **Skjermen** («Spill», ved siden av chat/cockpit). Velg én:
   - **A) Enklest:** åpne web-ruten `/spill` i en in-app webview (arver samme
     innlogging som andre web-skjermer dere viser).
   - **B) Nativt:** rendr selv ved å polle `GET /api/quiz/status` (~hvert 3. sek)
     og tegne board-JSON-en (skjema nederst).
3. **Delt skjerm** (valgfritt, for barna): kall `POST /api/quiz/share`, få en URL,
   og del den (Web Share / AirDrop) til en annen enhet som åpner `/share/<token>`
   (offentlig, ingen innlogging).

## Auth

- `/api/apps/assistant`, `/api/quiz/status`, `/api/quiz/share` og web-ruten
  `/spill` bruker **samme innlogging** som Ekko allerede har mot assistenten
  (session-cookie / `locals.userId`). Webview for `/spill` må bære cookien.
- `/share/<token>` og `/api/share-link/<token>/quiz` er **offentlige** (kun token,
  ingen innlogging) — laget for delte enheter.

## API

### ① `POST /api/apps/assistant` (eksisterende — taledrevet gameplay)

Body (camelCase):

```json
{
  "prompt": "Start en quiz",
  "conversationId": "<uuid>|null",
  "context": "I bilen: Nils (9), Erle (7), pappa (42)",
  "stream": true
}
```

- `conversationId`: feltet til stede ⇒ tråd-modus. `null` ⇒ ny tråd; kjent id ⇒
  last historikk; ukjent/fremmed ⇒ 404.
- `context`: **efemær** situasjonskontekst, lagres aldri. Nyttig hvis reise/
  deltakere ikke er satt opp i appen — da slipper assistenten å spørre «hvem er med».
- `stream`: valgfritt; ellers ren JSON.

Svar (JSON):

```json
{ "ok": true, "text": "...", "conversationId": "<uuid>", "usedTools": ["quiz_score"] }
```

Svar (SSE, ved `stream: true` / `Accept: text/event-stream`):

```
event: start     data: { "conversationId": "<uuid>" }   (kun eksisterende tråd)
event: delta     data: { "text": "<fragment>" }
event: complete  data: { "ok": true, "text": "...", "conversationId": "...", "usedTools": [...] }
event: error     data: { "code": "assistant_generation_failed" }
```

### ② `GET /api/quiz/status` (innlogget — appens spillskjerm poller dette)

- Ingen aktiv quiz: `{ "active": false }`
- Ellers: board-objektet (se skjema under).

### ③ `POST /api/quiz/share` (innlogget — lag/gjenbruk delelenke)

- Body: ingen.
- Svar: `{ "token": "<token>", "url": "https://<host>/share/<token>" }`
- `409` hvis ingen aktiv quiz å dele.

### ④ `GET /api/share-link/<token>/quiz` (offentlig — delt skjerm poller dette)

- Svar: board-objektet (samme skjema). `404 { "error": "not_found" }`.

### Web-ruter (for webview-varianten)

- `/spill` — innlogget, appens spillskjerm (mørk, scoreboard).
- `/share/<token>` — offentlig, delt spillskjerm (samme board, token-basert).

## Skjema — board-objektet

Returneres av ② og ④ (og av `quiz_score` action `status`):

```json
{
  "active": true,
  "theme": "hovedsteder",
  "round": 0,
  "currentPlayer": "Erle",
  "currentQuestion": "Hva er hovedstaden i Norge?",
  "answered": false,
  "answer": null,
  "lastResult": { "player": "Erle", "correct": true },
  "standings": [
    {
      "name": "Nils",
      "score": 3,
      "streak": 3,
      "bestStreak": 3,
      "streakLabel": "varm",
      "current": false
    }
  ]
}
```

Felt-noter:

- `theme`, `currentPlayer`, `currentQuestion`, `lastResult` kan være `null`.
- `answer`: fasit — `null` til `answered === true`.
- `streakLabel`: `"varm"` (≥3), `"on fire"` (≥5), `"uslåelig"` (≥7), ellers `null`.
- `standings` er sortert på poeng, så streak, så navn. `current` = denne
  spillerens tur.

## Renderingstips (for native variant B)

- `!active` ⇒ tom tilstand («Be Ekko starte en quiz»).
- Vis `currentQuestion` stort + «{currentPlayer} sin tur».
- Når `answered`: vis `answer` + ✓/✗ fra `lastResult`.
- Per spiller: navn, stor score, 🔥`{streak}`, badge ved `streakLabel`, uthev
  `current`. Krone på lederen.
- Poll ~hvert 3. sekund. Tål `404`/`401` stille (prøv neste poll).

## Status (server)

Kode ferdig og testet (typesjekk + enhetstester). Krever DB-migrasjon (0027 +
0028) ved deploy før det fungerer i prod. `TAVILY_API_KEY` trengs for ferske
research-spørsmål (ellers brukes modellkunnskap). Se changelogene
`2026-06-25-bilferie-quiz.md` og `2026-06-25-spillskjerm.md`.
