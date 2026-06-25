# Spillskjerm for bilferie-quizen

Dato: 2026-06-25
Status: ferdig

## Kontekst

Bilferie-quizen (se `2026-06-25-bilferie-quiz.md`) kjøres med stemmen via Ekko, men levde
«skjult» i tale-flyten. Ønsket: en egen visuell skjerm ved siden av chat — for én gangs skyld
en annen UI enn snakkebobler — som viser et ekte scoreboard mens stemmen driver spillet.

Nøkkelinnsikt: spillet har allerede en server-tilstand (`quiz_sessions`). En skjerm trenger
derfor ingen chat-bobler — den rendrer tilstanden og poller for endringer, mens tale-verktøyene
driver logikken som før. Mønsteret for live-skjerm finnes (delesiden `/live` + `/share/[token]`
poller hvert par sekunder), så vi gjenbruker det.

## Faser

### Fase 1: Live-tilstand på sesjonen
- Migrasjon `0028_quiz_sessions_live_state.sql` + schema: `current_player`, `current_question`,
  `current_answer`, `last_result` på `quiz_sessions`.
- Ren `projectQuizBoard` (quiz-logic.ts) projiserer sesjonen til det skjermen viser, og **holder
  fasiten skjult til spørsmålet er besvart** (`last_result` satt) — så en delt skjerm i baksetet
  ikke røper svaret. `toQuizSessionState` mapper DB-rad → ren tilstand. 3 nye tester.

### Fase 2: quiz_score driver skjermen
- Ny action `ask` (player + question + answer) setter gjeldende spørsmål/tur og nullstiller
  forrige resultat — kalles rett før spørsmålet leses høyt.
- `record` setter `last_result` (avslører fasiten på skjermen) i tillegg til scoring.
- `start` nullstiller live-feltene. `status` returnerer nå hele board-projeksjonen.

### Fase 3: API
- `GET /api/quiz/status` — innlogget brukers aktive quiz (spillskjermen i appen poller dette).
- `GET /api/quiz/[token]` — offentlig, token-basert (delt skjerm). Krever et `quizSession`-
  share-token.
- `POST /api/quiz/share` — lager/gjenbruker en delelenke til aktiv quiz.
- Delings-systemet (`share_tokens`) utvidet med ressurstype `quizSession` +
  `getOrCreateQuizShareToken`. Delte quiz-skjermer vises via den eksisterende `/share/[token]`.

### Fase 4: UI
- `QuizBoard.svelte` (domain/quiz) — selv-pollende visning: tema + runde, spørsmålskort med
  «hvem sin tur» og svar-reveal, og et scoreboard med poeng, streak-flammer og leder-krone.
  Bruker designsystem-tokens (mørkt), ingen hardkodede farger.
- `/spill` — innlogget skjerm (AppPage + PageHeader «Spill») med «Del»-knapp som henter en
  delelenke (Web Share / utklippstavle).
- `/share/[token]` utvidet med en `quizSession`-gren som rendrer QuizBoard i en mørk fullskjerm
  (ikke det lyse share-skallet).

### Fase 5: Prompt
- Quizmaster-instruksen: kall `ask` rett før opplesning, og nevn at spill-skjermen finnes og kan
  deles — men spillet funker fint på stemmen alene.

## Beslutninger

- **Polling, ikke SSE.** Husmønsteret (`/live`) poller; ingen grunn til å innføre websockets for
  et turbasert spill. `QuizBoard` poller hvert 3. sekund.
- **Fasit-gating i ren funksjon.** `projectQuizBoard` avgjør om svaret skal vises — testbart, og
  gjelder likt for innlogget og delt skjerm, så svaret aldri lekker til baksetet før noen gjettet.
- **Gjenbruk `/share/[token]` framfor egen `/spill/[token]`.** Delings-infrastrukturen finnes;
  en ny `quizSession`-ressurstype var nok.
- **Skjerm = ren visning.** All skriving går via tale-verktøyene; skjermen leser bare. Holder
  ansvaret ett sted og unngår to kilder til sannhet.

## Verifisering

- `npm test`: 803 tester (64 filer), inkl. 22 for quiz-logikken.
- `npm run check`: 0 feil, 0 advarsler.

## Videre (ikke bygd)

- Surfacing/navigasjon til `/spill` i iOS-skallet (ved siden av chat) er en liten kobling utenfor
  dette repoet — ruten funker via URL i dag.
- Visuell regresjonstest av `/spill` (ikke i baseline-settet ennå).
- Animasjon ved poeng-/streak-endring kan gjøre scoreboardet enda mer levende.
