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

### Fase 3: Oppdagbarhet

- `src/lib/server/chat-router.ts`: `bursdag|fødselsdag|kavalkade` ruter til self-domenet med hint om `/kavalkade`. Test lagt til i `chat-router.test.ts`.

## Beslutninger

- **Lagring i `reflections`, ikke ny tabell.** Intervjuet er én refleksjon per år med strukturert markdown — ingen schema-endring eller migrasjon nødvendig. Parsing skjer mot de stabile overskriftene i `INTERVIEW_SECTIONS`.
- **Bursdagsår, ikke kalenderår.** Kavalkaden går fra forrige til neste bursdag (self-personens `birthDate` i `persons`). Uten fødselsdato: siste 365 dager.
- **Månedsaggregater telles i året de starter i.** Grensemåneden rundt bursdagen havner helt i ett av årene — enkel og forutsigbar avgrensning fremfor dag-presis splitting.
- **Vektendring krever minst to måneder med data**, ellers vises bare nivået.
- **Kavalkade-modulen ligger i `$lib/server`** (brukes kun server-side); norske sport-etiketter («løpt», «gått») mappes derfor på i page-serverens load i stedet for å importeres i klienten.

## Verifisering

- `npm test`: 441 tester grønne (18 nye for intervju-format og kavalkade-beregning, 1 ny router-test).
- `npm run check`: 0 feil, 0 advarsler.
- Visuelle tester ikke berørt — ingen av de 5 baseline-sidene er endret; `/kavalkade` er ny side utenfor baseline-settet.
