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
  - **`quiz_companions`**: finner den pågående reisen (vindu i `themes.tripProfile` eller
    `ferieProfile` som dekker dagens Oslo-dato, via `pickTripForDate`), henter deltakerne fra
    `ferieProfile.members` og slår opp alder fra `persons.birthDate`. Gjenbrukbart for andre
    reise-spill senere.
  - **`quiz_round`**: lager aldersdifferensierte spørsmål **med fasit**. `freshFacts=true`
    trigger Tavily-websøk (samme stack som `book_research`) for ferske/nisje-fakta; ellers
    bruker den modellkunnskap (raskt for matte/geografi/gloser). Genererer via `gpt-4o-mini`
    med JSON-respons, validert av `parseGeneratedQuestions`.
  - **`quiz_score`**: `start` / `record` / `status` / `end` mot `quiz_sessions`. Holder
    poeng og streaks per person og returnerer stilling + streak-hint.

### Fase 4: Innkobling + prompt
- `QUIZ_ASSISTANT_TOOLS` lagt til i `ASSISTANT_TOOLS` (`tools.ts`).
- Quizmaster-seksjon lagt til i systemprompten (`assistant.ts`): hent deltakere → start →
  velg tema → hent runde (forklarer når `freshFacts` skal på) → still ett spørsmål om gangen
  på omgang → registrer svar og bruk streak-hintet til tilrop → avslutt og kår vinner.

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

- `npm test`: 796 tester passerer (64 filer), inkl. 15 nye for quiz-logikken.
- `npm run check`: 0 feil, 0 advarsler.
- Research- og generering-stien bruker eksisterende, verifiserte byggeklosser (`tavilySearch`,
  `openai`) på samme måte som `book_research`.

## Videre (ikke bygd ennå)

Mønsteret (tale-verktøy + prompt-instruks + reise-deltakere) kan gjenbrukes til flere
bilferie-spill: stedsfortellinger underveis, «hvor lenge igjen?» for barna, samarbeidshistorie,
«vil du heller», familie-intervju. `quiz_companions` er allerede generell nok til å mate dem.
