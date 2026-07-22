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

### Fase 4: Pålitelig utløsing + kilde-styring (oppfølging)

Etter fase 1–3 skjedde research kun når modellen selv valgte å kalle
`web_search`. Denne fasen gjør at research faktisk *blir* utført, og fra kilder
vi stoler på.

**Utløsing:**
- `chat-router.ts` fikk `forceWebSearch` + `classifyResearchTopic`-basert
  deteksjon. Reise/steds-spørsmål og ferske/tidsavhengige spørsmål tvinger nå
  `tool_choice: web_search` på første modellkall (i `chat/+server.ts`), også i
  conversational-modus.
- `base.ts`-systemprompten styrket: eksplisitt om steds-/reisespørsmål,
  `deep=true` ved planlegging og `saveToTheme=true` når det hører til temaet.

**Kilde-styring (foretrukne + LLM-vennlige):**
- Ny `research-domains.ts`: kuraterte sett (`TRAVEL_DOMAINS`, `NEWS_DOMAINS`),
  støyfilter (`LOW_QUALITY_DOMAINS` — pinterest/quora/sosiale medier),
  `classifyResearchTopic` og ren `resolveResearchScope` som fletter kuraterte
  domener med temaets egne preferanser og velger Tavily-topic/tidsvindu.
- Per-tema kilder: ny kolonne `themes.research_domains` (migrasjon `0046`),
  service-getter/setter, API `GET/PUT /api/tema/[id]/research-domains`, og en
  «Foretrukne kilder»-editor i `ThemeFilesTab`.
- Tavily-wrapperen støtter nå `topic` + `days`.

**Dyp research:**
- `runWebResearch` fikk `deep`-modus: `expandResearchQueries` gir flere
  vinkel-søk (severdigheter / mat / praktisk for reise) som flettes og dedupes
  på URL før oppsummering. `web_search` fikk `deep`-parameter.

**Proaktiv research:**
- `proactive-research-service.ts` + cron `/api/cron/theme-research` (daglig
  04:20 UTC): forhåndshenter dypt reise-søk for reise-temaer med destinasjon og
  startdato innen 45 dager som ennå ikke har funn. Instrumentert med
  `withCronTracking`, registrert i cron-jobbregisteret.

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
- `npm test`: 1676 tester grønne. Nye rene enhetstester dekker `web-research`,
  `research-domains` (topic-klassifisering + scope-fletting), ruter-tvangen
  (`forceWebSearch`) og reise-vinduet i proaktiv research.
- Uten `TAVILY_API_KEY` degraderer `web_search` til `success: false` med tom
  kildeliste (ingen krasj), og ingenting lagres — også i proaktiv cron.
