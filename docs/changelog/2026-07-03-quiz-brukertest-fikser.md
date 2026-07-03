# Quiz-fikser etter brukertest i full bil

Dato: 2026-07-03
Status: ferdig

## Kontekst

Bilquizen ble brukertestet med full bil, og barna ga opp. Kontrakten for fiksene er
spesifisert i `ekko/QUIZ_AGENT_SPEC.md` i resonans-lab (gren
`claude/quiz-chat-testing-feedback-2oclsp`, se også `ekko/QUIZ_API.md`); dette dokumentet
dekker server-halvdelen i resonans. Observert i test:

- «Erle 7, Nils 9, Kjetil 42» registrerte bare Erle — og Erle spilte mot en «Kjetil» som
  hang igjen fra en tidligere quiz (stale state).
- Samme spørsmål kom 3 ganger på 26; nivået var for lett og skilte ikke 7 fra 42 år.
- To raske svar («Riktig», så «Snø») ga to motstridende fasit-vurderinger av samme spørsmål.
- Lang responstid på hver tur.

Board-skjemaet i `/api/quiz/status` er UENDRET (Ekko-kontrakten). Ekko-klienten sender nå
pågående quiz-tilstand i det efemære `context`-feltet, så agenten slipper en verktøyrunde
for å vite hvor spillet står.

## Faser

### Fase 1: Stale state — fersk quiz med tom deltakerliste
- `quiz_score action="start"` (`quiz-tools.ts`) deaktiverer en eventuell pågående quiz og
  oppretter en fersk med TOM deltakerliste (før: start krevde navn og satte rosteret direkte).
  Deltakere arves aldri implisitt; «samme lag som sist» skjer kun ved at modellen registrerer
  laget eksplisitt etter bekreftelse (prompt-håndhevet).
- Verifisert at `/api/quiz/status`, `/spill` og `/api/share-link/[token]/quiz` kun leser den
  aktive quizen (uendret kode, alle går gjennom `projectQuizBoard`).

### Fase 2: Deltaker-registrering som array
- Ny `action="register"` tar HELE laget som ett array av `{name, age, interests?}`.
  Ren logikk: `participantsFromEntries` + `coercePlayerEntries` (`quiz-logic.ts`) — dedupe,
  alders-klipping, interesse-trimming. Poeng bevares for navn som allerede står i rosteret
  (sen-registrering nuller ikke de andre).
- `QuizParticipant` har nå `age`/`interests`; alderen styrer vanskelighetsgraden i banken.
- Prompten (assistant.ts) krever: parse hele ytringer («Erle 7, Nils 9 og Kjetil 42» —
  komma/«og») til ETT kall, foreslå laget fra `trip_companions` ved quiz-start, og les hele
  laget med alder tilbake før første spørsmål.

### Fase 3: Pre-generert spørsmålsbank
- Ny `action="prepare"` (ved bekreftet lag, og som refill): batch-genererer 8–10 spørsmål per
  spiller med STERK modell (`EKKO_QUIZ_GEN_MODEL`, default gpt-5.5) — alderstilpasset
  (aldersbånd-føring per spiller), personlig (interesser der de er kjent), varierte kategorier
  innen temaet, valgfritt Tavily-research (`freshFacts`). Lagres på quizen som
  `question_bank`-jsonb: `{id, player, text, answer, category, used}`.
- Spilleturer (`action="next"`) TREKKER neste ubrukte og markerer det brukt — ingen
  on-the-fly-generering i tur-stien. Verktøyet roterer turen selv.
- Gjentakelses-vern: hvert stilte spørsmål logges normalisert (`normalizeQuestionText`) i
  `asked_log` på quizen; refill leser loggen fra brukerens siste 5 quizer og håndhever
  eksklusjon hardt med `filterRepeatQuestions` (prompt-hintet er bare et hint).
- `quiz_questions`-verktøyet er fjernet — banken erstatter det.

### Fase 4: Idempotens + serialisering
- Gjeldende spørsmål har id (`current_question_id`) og tilstand `open|answered`
  (`question_state`-statuskolonne — den serverless-vennlige serialiseringen, Neon HTTP-driveren
  har ingen interaktive transaksjoner).
- `action="record"` (questionId + correct) = evaluer → poeng → `answered` → bytt
  `currentPlayer`, alt i ÉN betinget UPDATE (`WHERE current_question_id = $id AND
  question_state = 'open'`). Taper CAS-en, eller er spørsmålet allerede brukt, svarer verktøyet
  `alreadyGraded` — svaret re-vurderes ALDRI, og agenten instrueres til å kvittere kort og lese
  gjeldende spørsmål på nytt. `next` er tilsvarende guardet (`IS DISTINCT FROM 'open'`) og
  beholder vakten mot å trekke nytt spørsmål før forrige er bokført.

### Fase 5: Prompt
- Quizmaster-instruksen er omskrevet: quiz-svar er ÉN strømmet melding i korte talevennlige
  setninger uten markdown, i FAST rekkefølge fasit → poeng/stilling → nytt spørsmål, med
  utfylt eksempel («Riktig, det er snø! Erle har 3 poeng og leder. Nils, din tur: …») slik at
  første talte setning alltid er fasiten. record + next kalles gjerne i samme verktøyrunde.

### Fase 6: Modell-ruting
- `hasActiveQuiz` (quiz-tools.ts, best-effort som `hasActiveStory`) ruter spilleturer til en
  RASK modell (`EKKO_QUIZ_MODEL`, default gpt-4o-mini) i begge agent-løkkene; fortelling
  vinner hvis begge er aktive. Den sterke modellen brukes kun i bank-genereringen (utenfor
  tur-stien).
- `isReasoningModel`/`completionTuning` flyttet til `model-tuning.ts` (re-eksportert fra
  assistant.ts) så quiz-tools kan gjenbruke dem uten import-sykel.

## Beslutninger

- **Statuskolonne-CAS, ikke DB-lås.** Neon HTTP-driveren støtter ikke interaktive
  transaksjoner/advisory locks; én betinget UPDATE nøklet på spørsmåls-id er atomisk og
  dekker både dobbel-vurdering (to raske svar) og parallelle turer.
- **Banken erstatter generering i turen.** Latens og gjentakelser kom av on-the-fly-generering
  per spørsmål; batch én gang (sterk modell, med eksklusjonslogg) gir bedre kvalitet OG
  raskere turer. Refill er et eksplisitt `prepare`-kall, aldri implisitt i `next`.
- **Gjentakelses-vern håndheves i kode.** Eksklusjonslista i genererings-prompten er et hint;
  `filterRepeatQuestions` mot normalisert logg (siste 5 quizer) er garantien.
- **Board-skjemaet uendret.** `projectQuizBoard` bruker `questionState` når den finnes og
  faller tilbake på `lastResult`-heuristikken for eldre rader.

## Verifisering

- `npm test`: 945 tester passerer (75 filer), inkl. nye for `participantsFromEntries`,
  `coercePlayerEntries`, `normalizeQuestionText`, bank-trekk/rotasjon, `filterRepeatQuestions`,
  `hasPendingAnswer` med `questionState` og board-gating.
- `npm run check`: 0 feil, 0 advarsler.
- Biltest-scenariene dekkes slik: lag foreslås fra `trip_companions` (prompt) → «Erle 7,
  Nils 9, Kjetil 42» blir ett register-kall med tre spillere og leses tilbake → banken gir
  aldersdifferensierte spørsmål uten gjentakelser (normalisert logg) → dobbelt svar gir
  nøyaktig én bokføring (CAS + alreadyGraded) → fasit først (prompt-eksempel) og raskere
  turer (gpt-4o-mini på spilleturene).
