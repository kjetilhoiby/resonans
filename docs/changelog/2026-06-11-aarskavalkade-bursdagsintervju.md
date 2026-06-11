# Årskavalkade og bursdagsintervju

Dato: 2026-06-11
Status: ferdig

## Kontekst

Brukeren har bursdag om en uke og ønsket seg to ting: en **årskavalkade** (året i tall — løpt, gått, lest osv.) og et **«hvem er du i år, hvem var du i fjor»-intervju** med spørsmål som «hva har endret seg», «hva har du begynt/sluttet med», «hva husker du best» og årets beste konsert/bok/film/teaterstykke.

Poenget med intervjuet er akkumulering: svarene lagres per år, slik at neste års intervju og kavalkade kan holde årets svar opp mot fjorårets.

## Faser

### Fase 1: Bursdagsintervju-flow

- `src/lib/flows/birthday-interview.ts` (ny): Spørsmålsdefinisjoner (`INTERVIEW_SECTIONS`) og markdown-formatet svarene lagres i. `buildInterviewMarkdown`/`parseInterviewMarkdown` gir tapsfri tur-retur via stabile `## `-overskrifter — det er sånn neste års intervju leser fjorårets svar. Rene funksjoner med tester i `birthday-interview.test.ts`.
- `src/lib/flows/types.ts` + `registry.ts`: Ny flow `birthday_interview` (🎂, domain `self`, fokusmodus). Fire skjemasteg (hvem er du i år / siden i fjor / hva husker du best / årets beste) og et avsluttende chat-steg («Året i speilet») der AI-en speiler årets svar mot fjorårets og kavalkade-tallene. Fjorårskontekst mates inn via `context.initialData` (`_lastYearAnswers`, `_kavalkadeSummary`) som `buildPrompts` leser fra flowData.
- `src/routes/api/reflections/birthday/+server.ts` (ny): Lagrer intervjuet med `upsertReflectionForPeriod` — kind `birthday_interview`, periodKey = årstall. Upsert gjør at intervjuet kan tas på nytt samme år. AI-ens speiling lagres som egen seksjon (`mirror`).
- `src/lib/server/reflections.ts`: `birthday_interview` lagt til i `ReflectionKind`.

### Fase 2: Årskavalkade

- `src/lib/server/kavalkade.ts` (ny): Rene beregningsfunksjoner. `getBirthdayWindows` regner bursdagsår (forrige bursdag → neste, fra self-personens `birthDate`; fallback siste 365 dager). `summarizeYear` aggregerer treningsøkter per sport (fra `workout_daily_aggregates`), skritt/søvn/vekt/skjermtid (fra månedsraden i `sensor_aggregates`) og ferdigleste bøker (`books.finishedAt`). `formatKavalkadeForPrompt` lager AI-kontekst. Tester i `kavalkade.test.ts`.
- `src/routes/kavalkade/` (ny side): «Året i tall» med i-år-vs-i-fjor per metrikk, bokliste, årets intervjusvar, fjorårets svar («Hvem var du i fjor?») og start-knapp for intervjuet via `FlowSheet`. Bygget på `SectionCard`/`SectionLabel` og AppPage-tokens.

### Fase 3: «Tenk stort» — ordsky, tidslinje og AI-magi

- `src/lib/server/ordsky.ts` (ny): Ren ordfrekvens-beregning med norsk tokenisering og grammatisk stoppordliste (innholdsverb som «rydde»/«kjøpe» beholdes med vilje). Mates med årets sjekkliste-oppgaver (`checklist_items`) og rendres som vektet ordsky på siden. Tester i `ordsky.test.ts`.
- `buildMonthTimeline` i `kavalkade.ts`: Måned-for-måned-tidslinje for bursdagsåret — toppsport, antall økter, skritt, bøker fullført den måneden og månedens overskrift fra `plan_artifacts` (kind `month`). Grensemåneder telles bare i snittet måned ∩ vindu. Tester lagt til.
- `src/lib/kavalkade-magi.ts` (ny, delt klient/server): Markdown-format for bursdagshilsner (`## Karakter — Bok`), tapsfri tur-retur. Tester i `kavalkade-magi.test.ts`.
- `src/routes/api/kavalkade/magi/+server.ts` (ny): To GPT-4o-genererte innslag, lagret som refleksjoner (kind `birthday_prophecy` / `birthday_greetings`, periodKey = år, upsert ved regenerering):
  - **Spådommen**: spåkone-tekst om året som kommer, basert på kavalkade-tall, tidslinje, ordsky-toppord og intervjusvar (i år + i fjor).
  - **Hilsner fra bokhylla**: bursdagshilsner fra sentrale romankarakterer i årets ferdigleste bøker (fallback fjorårets), i karakterens egen stemme.
- `src/lib/server/kavalkade-data.ts` (ny): Felles datalaster for siden og magi-endepunktet — page-serveren ble en tynn wrapper.

### Fase 4: Komponentuttrekk og /design-demo

- De visuelle blokkene ble trukket ut av siden til props-drevne komponenter i `src/lib/components/domain/kavalkade/`: `KavalkadeStats`, `Ordsky`, `MonthTimeline`, `GreetingsList`, `InterviewAnswerList` (+ delte UI-typer i `types.ts`). `/kavalkade`-siden komponerer nå disse.
- Ny `/design`-seksjon «Kavalkade» (mellom Ukeplan og Sheets) demoer alle fem med deterministiske fixtures i `design/mocks.ts`. Seksjons-id lagt til i `tests/visual/pages.spec.ts`, og baseline `design-kavalkade.png` generert.
- `playwright.config.ts`: readiness-URL endret til `/design` (public path) — rot-siden krever DB og ga 500 i miljøer uten, slik at webServer-sjekken aldri ble grønn.

### Fase 5: Fullskjerm-show («Spotify Wrapped»)

- `show-slides.ts` (domain/kavalkade): `buildShowSlides` — ren funksjon som bygger slide-sekvensen fra årsdataene: intro → sport-tall (maks 3) → økter → skritt → bøker → ordsky → månedshøydepunkter → minnet → årets beste → hilsner fra bokhylla → spådoms-teaser → outro. Tomme datakilder hoppes over; hver slide får hue fra et fargehjul og egen varighet. Tester i `show-slides.test.ts`.
- `ShowSlide.svelte`: én fullskjerm-slide — ord-for-ord-typografi-reveal, count-up-tall (rAF med ease-out), drivende gradient-blobs (transform-animert, kompositor-vennlig). `animate={false}` fryser slutt-tilstand (for /design og visuell regresjon); `prefers-reduced-motion` respekteres. Display-typografi bruker `clamp()` med vilje — plakat-tekst, ikke kort-innhold.
- `KavalkadeShow.svelte`: story-spiller — segmentert progresjonsbar, tap-soner (venstre/høyre), piltaster + Escape, auto-fremdrift per slides varighet, crossfade mellom slides. Stopper på outro.
- Rute `/kavalkade/show` (samme datalaster) + «▶ Spill av året»-knapp øverst på `/kavalkade`.
- `/design`: tre frosne ShowSlide-demoer i kavalkade-seksjonen (baseline regenerert) + live-demo med full animasjon på `/design/kavalkade-show` (public path, mock-data, ikke i visuell regresjon).

### Fase 6: Oppdagbarhet

- `src/lib/server/chat-router.ts`: `bursdag|fødselsdag|kavalkade` ruter til self-domenet med hint om `/kavalkade`. Test lagt til i `chat-router.test.ts`.

## Beslutninger

- **Lagring i `reflections`, ikke ny tabell.** Intervjuet er én refleksjon per år med strukturert markdown — ingen schema-endring eller migrasjon nødvendig. Parsing skjer mot de stabile overskriftene i `INTERVIEW_SECTIONS`.
- **Bursdagsår, ikke kalenderår.** Kavalkaden går fra forrige til neste bursdag (self-personens `birthDate` i `persons`). Uten fødselsdato: siste 365 dager.
- **Månedsaggregater telles i året de starter i.** Grensemåneden rundt bursdagen havner helt i ett av årene — enkel og forutsigbar avgrensning fremfor dag-presis splitting.
- **Vektendring krever minst to måneder med data**, ellers vises bare nivået.
- **Kavalkade-modulen ligger i `$lib/server`** (brukes kun server-side); norske sport-etiketter («løpt», «gått») mappes derfor på i page-serverens load i stedet for å importeres i klienten.

- **AI-innslagene genereres på forespørsel, ikke ved sidelast.** Spådom og hilsner koster et LLM-kall; knapp + lagret refleksjon gjør siden rask og resultatet stabilt til brukeren ber om nytt.

## Verifisering

- `npm test`: 461 tester grønne (38 nye: intervju-format, kavalkade-beregning, tidslinje, ordsky, hilsen-format, show-slides, router-trigger).
- Showet verifisert live i headless Chromium mot `/design/kavalkade-show`: intro-typografi, count-up midt i animasjon, skritt-/bok-slides og progresjonsbar fanget i screenshots.
- `/design`-seksjonen verifisert med Playwright i dev-server (dummy-env): alle fem demoer rendrer, baseline `design-kavalkade.png` sjekket inn. NB: eksisterende design-baselines viser små font-renderingsdiffs (0.04–0.09) i agent-containeren — uavhengig av denne endringen; den nye baselinen bør re-genereres lokalt ved neste `test:visual:update` hvis den diffes.
- `npm run check`: 0 feil, 0 advarsler.
- Visuelle tester ikke berørt — ingen av de 5 baseline-sidene er endret; `/kavalkade` er ny side utenfor baseline-settet.
