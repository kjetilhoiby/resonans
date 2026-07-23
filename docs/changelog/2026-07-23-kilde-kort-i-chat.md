# Kilde-kort i chatten (bilder + kart)

Dato: 2026-07-23
Status: ferdig

## Kontekst

Etter at `web_search` ble Tavily-drevet (#258/#260), ble kildene kun matet til
modellen og forkastet — brukeren så bare tekstsvaret. Ønsket: et «bunnpanel»
under svaret à la ChatGPT, med kilder, bilder, og et kart for steds-/reisesvar.

Chatten hadde allerede et modent mønster for rike kort (vær-kort, fotoanalyse,
widget-forslag, dagbok-kort): server-variabel → `complete`-payload →
`assistantMetadata`/`metadata` → `ChatState`-mapping → felt på `ChatMessage` →
`{#if}` i `ChatMessages.svelte`. Kilde-kortet følger nøyaktig samme vei.

## Faser

### Fase 1: Kilde-kort med bilder
- Delt type + ren bygger: `src/lib/chat/research-card.ts` (`ResearchCard`,
  `buildResearchCard`, `faviconUrl`). Capper kilder (6) og bilder (4), legger på
  favicon, filtrerer bort ikke-http-URL-er og duplikater.
- Bilder fra Tavily: `tavily.ts` fikk `includeImages` + `tavilySearchDetailed`
  (returnerer `{ hits, images }`). `tavilySearch` beholdt som treff-bare-wrapper
  (bok/film/kritiker-research uendret). `web-research.ts` samler og returnerer
  `images`.
- `chat/+server.ts`: `web_search`-resultatet bygger nå et `researchCard` som
  legges på `assistantMetadata` + returpayload (samme spor som `statusWidget`).
- Klient: nytt `researchCard`-felt på `ChatMessage` + mapping i
  `chat-state.svelte.ts`. Ny `ChatResearchCard.svelte` (bildestripe + kilde-rader
  med favicon/snippet) rendret i `ChatMessages.svelte`.

### Fase 2: Mini-kart for reise-treff
- `ChatMapCard.svelte`: lettvekts MapLibre-kart med én nål, gjenbruker den delte
  mørke basiskart-stilen (`mapStyle.ts`). `maplibre-gl` lastes lazy i `onMount`,
  scroll-zoom av så det ikke stjeler scroll i tråden.
- `resolveThemeMap` i `chat/+server.ts`: for `travel`-treff knyttet til et
  reise-tema brukes lagrede `tripProfile.lat/lng`; ellers geokodes destinasjonen
  (`geocodePlace`, Nominatim, best-effort). Kartet legges på kortet.

### Fase 3: Persistering
- `researchCard` leses fra `message.metadata` i `/samtaler`-loaderne
  (`+page.server.ts`, `+page.svelte`) og i `conversations/[id]/messages`-API-et,
  så kortet overlever reload i samtalevisningen.

## Beslutninger

- **Ett kort-objekt, samme mønster som vær-kortet** — ingen ny SSE-hendelse.
  Kortet dukker opp i `complete`-payloaden. Progressiv visning (før tekstsvaret)
  kan legges til senere med en egen `sources`-SSE-hendelse hvis ønskelig.
- **Kart kun for reise-treff med kjent/geokodbar destinasjon** — matcher
  «av og til får jeg kart», og unngår Nominatim-kall når temaet alt har koordinater.
- **Favicon via DuckDuckGos ikon-tjeneste**, bilder direkte fra Tavily; begge med
  `onerror`-skjuling så døde URL-er ikke etterlater blanke ruter.

## Verifisering

- `npm run check`: 0 errors, 0 warnings.
- `npm test`: 1690 tester grønne (7 nye i `research-card.test.ts` — favicon,
  capping, http-filtrering, kart-passthrough).
- Uten `TAVILY_API_KEY`: `web_search` gir tomt resultat → intet kort bygges.
