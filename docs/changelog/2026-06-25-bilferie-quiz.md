# Bilferie-quiz for tale-assistenten

Dato: 2026-06-25
Status: ferdig

## Kontekst

Tale-assistenten (Ekko) har allerede et bil-/biltur-spor (`car-tools.ts`: kjørerute, ladere)
og bilekspertise i systemprompten. Neste steg er å gjøre selve bilferien gøy: et quiz-spill
for hele bilen som kjøres med stemmen.

En ren konversasjonell quiz kan modellen kjøre selv, men har to svakheter den ikke løser
pålitelig alene:

1. **Fakta.** Modellen kan dikte opp fasit, særlig for nisje-/personlige temaer (en bestemt
   barneserie, dagsaktuell sport). CLAUDE.md krever at vi aldri dikter opp fakta.
2. **Tracking.** Over et langt spill mister modellen tellingen på poeng og streaks, så
   «tre på rad — Nils er on fire!» blir gjetting.

Verktøyene her dekker nettopp det modellen ikke gjør godt alene; flyten (tur-rekkefølge,
tilrop, tema-valg) styres konversasjonelt via en quizmaster-instruks i systemprompten.

Familien som motiverte designet: Nils (9), Erle (7) og en voksen (42) — altså behov for
**differensierte** spørsmål (samme tema, ulik vanskelighet per spiller) og **per-person**
tracking.

## Faser

### Fase 1: Datamodell
- Ny tabell `quiz_sessions` (`scripts/db-migrations/0027_quiz_sessions.sql` + `schema.ts`):
  deltakere med `score`/`streak`/`bestStreak`/`asked`/`correct` i en JSONB-array, pluss
  `theme`, `round`, `active`. Partial unique index sikrer **én aktiv quiz per bruker**
  (familien deler én enhet i bilen).

### Fase 2: Ren logikk + tester
- `src/lib/server/assistant/quiz-logic.ts` (rene funksjoner, ingen DB/IO):
  - `ageFromBirthDate` (alder fra ISO-fødselsdato, UTC-deterministisk),
  - `ageBand` (småbarn/barn/ungdom/voksen → styrer vanskelighetsgrad),
  - `applyAnswer` (immutabel scoring + streak/bestStreak),
  - `buildStandings`, `streakLabel` (hint: varm/on fire/uslåelig),
  - `participantsFromNames`, `findParticipantIndex`,
  - `parseGeneratedQuestions` (robust normalisering av LLM-JSON).
- `quiz-logic.test.ts`: 15 tester (norske navn).

### Fase 3: Verktøy
- `src/lib/server/assistant/quiz-tools.ts` — tre `AssistantTool`-er:
  - **`trip_companions`**: finner den pågående reisen (vindu i `themes.tripProfile` eller
    `ferieProfile` som dekker dagens Oslo-dato, via `pickTripForDate`), henter deltakerne fra
    `ferieProfile.members`, slår opp alder fra `persons.birthDate`, OG bygger et kompakt
    interesse-/kunnskaps-snapshot per person (notater + relevante minner + aktive mål — tre
    batchede spørringer, ingen N+1). Reise-nivå og gjenbrukbart for andre spill.
  - **`quiz_questions`**: lager spørsmål **med fasit**, tilpasset hver spillers alder OG
    interesser. `freshFacts=true` trigger Tavily-websøk (samme stack som `book_research`) for
    ferske/nisje-fakta. Genererer via `gpt-4o-mini` med JSON-respons, validert av
    `parseGeneratedQuestions`.
  - **`quiz_score`**: `start` / `record` / `status` / `end` mot `quiz_sessions`. Holder
    poeng og streaks per person og returnerer stilling + streak-hint.

### Fase 4: Innkobling + prompt
- `QUIZ_ASSISTANT_TOOLS` lagt til i `ASSISTANT_TOOLS` (`tools.ts`).
- Quizmaster-seksjon lagt til i systemprompten (`assistant.ts`): hent deltakere (med interesser)
  → start → velg tema → hent spørsmål (forklarer når `freshFacts` skal på, og at trivielle
  spørsmål lages selv) → still ett spørsmål om gangen på omgang → registrer svar og bruk
  streak-hintet til tilrop → avslutt og kår vinner.

### Fase 5: Personalisering + navngiving (samme dag)
- **Prinsipp:** et verktøy fortjener plassen sin når det henter inn data modellen ikke kan ha.
  Mekanikk (tur-rekkefølge, tilrop, «vinneren blir stående»-spill) styres konversasjonelt.
- **Research om deltakerne** ble kronjuvelen: `trip_companions` utvidet fra navn+alder til også
  interesser/kunnskap, så spørsmål blir *personlige*, ikke bare aldersdifferensierte («Nils, du
  som spiller fotball …»). `quiz_questions` tar nå `interests` per spiller.
- **Navngiving:** `quiz_companions` → `trip_companions` (reise-nivå, ikke quiz). `quiz_round` →
  `quiz_questions`. Poeng/scoring viste seg å være quiz-formet (rett/galt → poeng), ikke
  spill-generisk — så `quiz_score`/`quiz_sessions` beholdt `quiz_`-prefiks. Ingen `game_`-
  navnerom innføres før noe faktisk deles av flere spill.
- Ny ren logikk `buildKnowledgeSnapshot` + `hasKnowledge` (4 nye tester).

## Beslutninger

- **Tracking i DB, ikke i hodet på modellen.** Lett `quiz_sessions`-tabell keyed på bruker.
  Valgt fordi pålitelige streaks var en eksplisitt kjernefunksjon; én-aktiv-per-bruker holder
  modellen enkel (verktøyene får bare `userId`, ikke `conversationId`).
- **Betinget research.** `freshFacts` er en boolean modellen setter — den har konteksten til
  å vite om et tema trenger ferske fakta. Sparer tid/kostnad på tidløse temaer.
- **Fasit returneres til modellen.** Spørsmål kommer alltid med svar, så quizmasteren slipper
  å gjette/hallusinere — i tråd med «aldri dikt opp fakta».
- **Differensiering via aldersbånd**, ikke fritekst: `ageBand` gir stabil, testbar mapping fra
  alder til vanskelighetsføring i spørsmålsprompten.

## Verifisering

- `npm test`: 800 tester passerer (64 filer), inkl. 19 nye for quiz-logikken.
- `npm run check`: 0 feil, 0 advarsler.
- Research- og generering-stien bruker eksisterende, verifiserte byggeklosser (`tavilySearch`,
  `openai`) på samme måte som `book_research`.

## Videre (ikke bygd ennå)

Mønsteret (tale-verktøy + prompt-instruks + reise-deltakere) kan gjenbrukes til flere
bilferie-spill: stedsfortellinger underveis, «hvor lenge igjen?» for barna, samarbeidshistorie,
«vil du heller», familie-intervju. `quiz_companions` er allerede generell nok til å mate dem.
