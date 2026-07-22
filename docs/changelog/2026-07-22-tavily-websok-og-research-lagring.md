# Tavily-websøk i chatten + research-lagring på tema

Dato: 2026-07-22
Status: ferdig

## Kontekst

Brukeren ønsket samme opplevelse som i ChatGPT: når man spør om noe som krever
ferske nettdata («hva kan jeg gjøre i Hornbæk»), skal chatten gå en runde på
nettet og slå opp info før den svarer. To behov:

1. **Kvalitet på websøk.** Chatten hadde allerede et `web_search`-verktøy, men
   det skrapte DuckDuckGos HTML med regex og returnerte kun tittel + snippet +
   URL — skjørt og tynt. Tavily (den gode pipelinen: søk → ekstraher
   sideinnhold → oppsummer med kilder) var kun tilgjengelig for de
   domene-spesifikke verktøyene `book_research`, `film_research` og
   `find_recipes`.
2. **Ta vare på funn.** Slike research-runder forsvant i chatlogg. Brukeren
   ville lagre dem som funn i en egen seksjon i Filer på tilhørende temaside.

## Faser

### Fase 1: Generell Tavily-pipeline
- Ny `src/lib/server/web/web-research.ts` med `runWebResearch(query, opts)` —
  samme pipeline som book/film-research, men uten domenebinding: Tavily-søk
  (advanced) → `fetchAndExtract` som fallback → GPT-oppsummering (`gpt-4o-mini`)
  → `{ findings, sources }`.
- Rene, testbare hjelpere eksportert: `trimSnippet`, `hostnameOf`,
  `buildResearchPrompt`. Enhetstester i `web-research.test.ts` (8 tester).
- `executeWebSearch` i `src/routes/api/chat/+server.ts` bygget om fra
  DuckDuckGo-skraping til `runWebResearch`. Verktøyresultatet returnerer nå
  `findings` + `sources` i stedet for rå trefflenker.

### Fase 2: Lagring av research som funn på tema
- Ny tabell `theme_research` (migrasjon `0045_theme_research.sql` + `schema.ts`):
  `themeId`, `userId`, `query`, `summary`, `sources` (jsonb), `createdAt`.
  NB: bevisst skilt fra den eksisterende `finds`-tabellen (global
  e-post-triage-innboks) — derfor navnet `theme_research` og UI-tittelen
  «Research», ikke «Funn».
- `theme-research-service.ts`: `saveThemeResearch`, `listThemeResearch`,
  `deleteThemeResearch` (alle eier-scopet på `userId`).
- `web_search`-verktøyet fikk parameteren `saveToTheme`. Når modellen setter
  den, lagres runden på samtalens tema (`conversation.themeId`, eller eksplisitt
  `themeId`). Modellen slipper å sende kildene tilbake — de persisteres
  server-side fra samme søkeresultat.
- API: `GET /api/tema/[id]/research` og
  `DELETE /api/tema/[id]/research/[researchId]`.

### Fase 3: UI i Filer
- `+page.server.ts` laster `themeResearch` parallelt og sender det gjennom
  `+page.svelte` → `ThemePage` → `ThemeFilesTab`.
- Ny «Research»-seksjon i `ThemeFilesTab`: sammenleggbare rader (spørsmål +
  dato), oppsummering og kilde-chips ved åpning, med slett-knapp per rad.
- `data-track`-attributter (`tema-research:apne|slett|kilde`) for brukslogging.

## Beslutninger

- **Kombinert søk + lagring i ett verktøy** framfor et eget
  `save_research_to_theme`-verktøy. Da unngår vi å sende kildelista gjennom
  modellen (tapsfritt) og holder det til ett Tavily-kall. Modellen trenger ikke
  kjenne `themeId` — det utledes fra samtalens tema.
- **`theme_research` som egen tabell** framfor å gjenbruke `theme_files`
  (`url` er NOT NULL der, og funn ≠ opplastede filer). Ryddigere skille.
- **Navnet «Research», ikke «Funn»**, for å unngå kollisjon med den
  eksisterende Funn-innboksen (`finds`).

## Verifisering

- `npm run check`: 0 errors, 0 warnings.
- `npm test`: 1652 tester grønne (inkl. 8 nye i `web-research.test.ts`).
- Uten `TAVILY_API_KEY` degraderer `web_search` til `success: false` med tom
  kildeliste (ingen krasj), og ingenting lagres.
