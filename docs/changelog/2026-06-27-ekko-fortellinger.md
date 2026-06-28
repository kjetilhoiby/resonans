# Interaktive fortellinger for Ekko (server-halvdel)

Dato: 2026-06-27
Status: ferdig

## Kontekst

Ekko (tale-assistenten) skal kunne fortelle interaktive fortellinger som bærer en hel kjøretur
(~30 min). Klient-halvdelen er bygget i `resonans-lab`: appen er en ren LESER som poller et board
og deler en baksete-skjerm. Resonans eier ALL tilstand og driver gameplay via tale-agenten i
`POST /api/apps/assistant`. Denne endringen er server-halvdelen.

To varianter deler ett board:

- **`branching`** — velg-selv-eventyr med a/b-valg som forgrener seg. To faser: `setup` (bygg
  verdenen med hyppige, åpne spørsmål) og `adventure` (lev i verdenen med handlingsorienterte valg).
- **`madlib`** — tulle-fortelling der agenten ber om ord og vever dem inn til slutt.

Designet speiler den eksisterende bilferie-quizen (`/api/quiz/*` + `quiz_*`-verktøy): samme
share-link-infra, samme auth (`Bearer rsn_…`), og samme «én aktiv per bruker»-modell — men i en
egen tabell, så quiz og fortelling har hver sin tilstand og overlever hverandre.

## Faser

### Fase 1: Datamodell

- Ny tabell `story_sessions` (`scripts/db-migrations/0030_story_sessions.sql` + `schema.ts`).
  Ett board dekker begge variantene; motsatt variants felt står `null`/tomt.
  - Felles: `kind`, `title`, `theme`, `current_player`, `active`, `ended`, `story`, `bible`.
  - branching: `phase`, `world` (jsonb), `passage`, `choices` (jsonb), `last_choice`, `step`,
    `history` (jsonb).
  - madlib: `request`, `blanks_filled`, `blanks_total`, `filled` (jsonb).
  - Partial unique index `story_sessions_active_user_uq` på `(user_id) WHERE active` — maks én
    aktiv fortelling per bruker; `story_start` deaktiverer forrige først.
- `story` (full tekst) holdes skjult til `ended === true` (gating i `projectStoryBoard`), så en
  delt skjerm i baksetet ikke røper slutten.
- `bible` er den interne fortellings-bibelen (kanon + bue + tone). Den re-injiseres i modell-
  konteksten via `story_state` hver tur, men er ALDRI en del av det offentlige board-skjemaet.

### Fase 2: Ren logikk + tester

- `src/lib/server/assistant/story-logic.ts`: rene funksjoner (board-projeksjon, `mergeWorld`,
  `coerceChoices`/`coerceWorld`, `normalizeBlanksTotal`, `allBlanksFilled`) — ingen DB/IO, speiler
  `quiz-logic.ts`.
- `story-logic.test.ts`: dekker story-gating (skjult til `ended`), opposite-variant-nulling,
  world-merge, choice-coercion og blank-invarianter.

### Fase 3: Agent-verktøy

- `src/lib/server/assistant/story-tools.ts` med `STORY_ASSISTANT_TOOLS`, registrert i `tools.ts`:
  - `story_start` `{ kind, theme?, title?, blanksTotal?, bible? }` — ny fortelling (erstatter aktiv).
  - `story_scene` (branching) — skyver forrige `{passage, choiceLabel}` til `history`, `step++`,
    setter nytt `passage`+`choices`, slår nye fakta inn i `world`, kan bytte til `phase="adventure"`.
  - `story_request` / `story_fill` (madlib) — be om neste ufylte ord / bokfør ordet (`blanksFilled`
    +1, `request=null` til neste request).
  - `story_end` `{ story }` — `ended=true`, avslører `story`, tømmer `choices`/`request`. Terminalt.
  - `story_state` (les) — full intern tilstand inkl. `bible` + `history`; brukes ved start av hver
    fortelling-tur, særlig ved gjenopptakelse («Sist i eventyret …»).
  - `trip_companions` (gjenbrukt fra quizen) gir navn + alder for alderskalibrering.
- Forteller-instruksjoner lagt til i assistentens system-prompt (`assistant.ts`): Dahl-tone
  alderskalibrert mot yngste passasjer, allusjon ikke gjengivelse, setup→adventure-pacing, branching-
  og madlib-invarianter, bibel-vedlikehold, og 30-minutters pacing med «vil dere høre mer?»-kroker.

### Fase 4: Endepunkter

- `GET /api/story/status` (`Bearer rsn_…`) — board-objektet, `{ active: false }` uten aktiv.
- `POST /api/story/share` (`Bearer rsn_…`) — lager/gjenbruker delelenke ⇒ `{ token, url }`,
  `409` uten aktiv. `url` eies av Resonans (`buildShareUrl`) og brukes uendret av appen.
- `GET /api/share-link/<token>/story` (offentlig token) — samme board-skjema for baksete-skjermen.
- `getOrCreateStoryShareToken` + `'storySession'` lagt til `ShareResourceType` i `share-tokens.ts`.

## Beslutninger

- **Egen tabell, ikke gjenbruk av `quiz_sessions`.** Quiz og fortelling har ulik livssyklus og må
  kunne være aktive samtidig (spille quiz «imellom» en pågående fortelling). Separate `active`-
  indekser holder begge modellene enkle.
- **`story_end` setter IKKE `active=false`** (til forskjell fra quizens `end`). En avsluttet
  fortelling forblir den «aktive» raden så `/status` returnerer det avslørte board-et (full tekst +
  world) til skjermen — `ended === true` er det eneste som lukker den, og en ny `story_start`
  deaktiverer den. Dette muliggjør gjenopptakelse også neste dag.
- **Bibel via `story_state`, ikke automatisk kontekst-injeksjon.** Assistent-løkka er generisk
  (quiz injiserer heller ikke kontekst automatisk). Agenten leser bibelen med `story_state` ved
  turstart og oppdaterer den via `bible`-feltet på `story_start`/`story_scene`. Det holder kanon +
  buen stram over en halvtime uten å koble den generiske agenten til forteller-domenet.
- **Modell-tier (jf. oppgavens punkt 8): story-turer rutes til en egen, sterk modell.** Prosjektet
  har ikke intent/tiering-systemet `resonans-lab`-dokumentene beskriver; assistenten kjører ellers
  på `EKKO_ASSISTANT_MODEL` ?? `gpt-4o`. For fortellinger innførte vi i stedet en egen knapp,
  `EKKO_STORY_MODEL` (default `gpt-5.5` — den sterkeste standard-flaggskipmodellen; Pro-variantene er
  i overkant for korte avsnitt som leses høyt i bilen), og ruter HELE turen til den når (a) brukeren har en aktiv,
  ikke-avsluttet fortelling (sjekkes ved turstart), eller (b) et `story_*`-verktøy er brukt i turen
  (fanger «start en fortelling»-turen — agent-løkka bytter til forteller-modellen etter verktøy-
  kallet, så selve narrasjonen leveres på den sterke tieren). Story-turer får også mer rom
  (`max_tokens` 1500, for avsnitt + bibel-oppdateringer) og litt høyere temperatur (0.8). Knappen er
  en ren env-variabel, så bytte til Claude (Opus/Sonnet 4.x) senere er bare en annen modell-id —
  ingen endringer i board-skjema eller verktøy. Sett `EKKO_STORY_MODEL` for å bytte modell (f.eks.
  `gpt-5.5-pro` for enda mer dybde, eller en Claude-modell).
  - **Parameter-format per modell.** GPT-5/o-serien er reasoning-modeller med et annet format enn
    gpt-4o: de krever `max_completion_tokens` (ikke `max_tokens`) og bare default-temperatur. Feil
    her gir 400 fra OpenAI → 502 mot frontend. `completionTuning()` skiller derfor per modell
    (`isReasoningModel`), og story-token-taket er romslig (4000) fordi reasoning-tokens trekkes fra
    samme budsjett. Begge dekket av `model-tuning.test.ts`.
  - **Ruting-probe må aldri 502-e.** `hasActiveStory` kjøres på hver assistent-tur og er nå
    try/catch-et: feiler den (f.eks. før `story_sessions`-migrasjonen er kjørt i miljøet), faller
    turen tilbake til vanlig modell i stedet for å krasje hele assistenten.

## Verifisering

- `npm test` — 850 tester grønne (inkl. nye `story-logic.test.ts` og utvidet `registry.test.ts`).
- `npm run check` — 0 feil, 0 advarsler.
- Board-gating (story skjult til `ended`, opposite-variant nulling, choices tom når ended) dekket av
  enhetstester. DB-koblede verktøy følger quizens etablerte, allerede-verifiserte mønster.
