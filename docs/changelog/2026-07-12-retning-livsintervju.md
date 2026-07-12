# Retning: Livsintervjuet og langsiktige mål

Dato: 2026-07-12
Status: ferdig (fase 1–3 implementert, ende-til-ende-verifisering gjenstår i dev)

## Kontekst

Resonans oppsto etter en lang ChatGPT-tråd der brukeren ble intervjuet om hvem han vil
være om ett, fem og ti år. Appen hadde mange elementer (dagbokchat, mål, drømmer,
Livskompass), men ingen ærlig, **brukerforfattet** langsiktig retning som resten av
systemet jobber i kontekst av:

- `dreams` hadde visjons-kinds (`vision_5year` osv.) som ble injisert i AI-konteksten
  som «LANGSIKTIG RETNING» — men de var LLM-foreslåtte, ikke brukerens egne ord.
- Verdier bodde på to frakoblede steder: Livskompasset (12 ACT-dimensjoner, ukentlig)
  og `memories` med `category: 'values'`.
- Retningen var ikke *nærværende*: den utfordret ikke brukeren i dagbokchatten,
  ukeplanen eller kvartalsplanen.

Avklart med brukeren: nytt dyptintervju (ingen import av gammel tråd), flate = utvid
`/drommer`, rytme = kvartalssamtale + årlig re-intervju, tone = **utfordrende**
(coachen skal påpeke gap mellom uttalt retning og observert hverdag).

## Faser

### Fase 1: Livsintervjuet + persistering + utfordrende kontekst

**Datamodell (ingen SQL-migrasjon):**
- `dream-service.ts`: ny kind `vision_10year` (`RELEVANCE_HOURS: null`, som 5-års),
  ny type `VisionHorizon`, og ny metode `saveAuthoredVision` — lagrer brukerens egne
  ord med `originKind: 'user_authored'`, `confidence: 'user_confirmed'`, `model: 'user'`,
  og superseder forrige visjon per horisont via eksisterende `persist`-kjede.
- `memory-service.ts`: `accept()` fikk valgfri `confidence` (før hardkodet `llm_inferred`).
- `reflections.ts`: nye kinds `livsintervju`, `livsintervju_chat`, `retningssamtale`,
  `retningsgap`.

**Flyten (`livsintervju` i `src/lib/flows/registry.ts`, mønster fra `birthday_interview`):**
Fem chat-steg med `buildPrompts` + `<status>`-blokker: `verdier` (forankret i
livskompass-dimensjonene som døråpnere) → `ti_aar` → `fem_aar` (tvinger konsistens
baklengs fra 10-årsbildet) → `ett_aar` (konkretisering) → `speil` (konfrontasjon:
påpeker selvmotsigelser og stiller ett ubehagelig spørsmål). `resumable: true`,
`chatModel: 'gpt-5.4'`. Rene hjelpere i `src/lib/flows/livsintervju.ts`
(markdown-format med stabile overskrifter, verdilinje-parsing, døråpner-tekst) med
tester i `livsintervju.test.ts`.

**API (`src/routes/api/retning/`):**
- `interview-context` (GET): eksisterende retning + verdier + forrige intervju +
  ferske synteser → `initialData` til flytene (gjør det årlige re-intervjuet til samme
  flyt: promptene siterer fjorårets svar).
- `livsintervju` (POST): visjonene → `saveAuthoredVision` × 3, verdilinjene →
  `MemoryService.accept` med `user_confirmed` (dedup/supersede), destillatet →
  reflection `livsintervju` (periodKey = årstall), transkriptene →
  `livsintervju_chat` («samtalen er data»), hendelseskort i dagboken via
  `addCanonicalEventMessage`.

**Utfordrende kontekst:**
- Ny ren funksjon `buildDirectionBlock` i
  `src/lib/server/services/direction-context.ts` (testet i `direction-context.test.ts`):
  rendrer visjonene (10 → 5 → 1 år → kvartal), verdiene og — kun når minst én visjon er
  brukerforfattet — en instruks om å påpeke gap eksplisitt, stille ett ubehagelig
  oppfølgingsspørsmål og bruke query-verktøyene for tall. LLM-visjoner merkes «AI-utkast».
- `ContextService.activeVision` bruker nå denne, inkluderer `vision_10year`, laster
  values-memories og siste `retningsgap`-reflection («KJENTE GAP»). Verdier utelates
  fra MEMORIES-blokken for å unngå dobbel oppføring. Dagbokchatten dekkes automatisk —
  den kanoniske samtalen går gjennom samme `ContextService.buildForChat`.

### Fase 2: /drommer ble Retning-siden

- `+page.server.ts`: splitter visjoner i `authored`/`proposed`, laster values-memories,
  skiller retningens revisjonshistorikk (`visionHistory`) fra øvrig historikk.
- `+page.svelte`: `PageHeader title="Retning"`. Øverst tre hero-kort (ti/fem/ett år,
  tomme kort inviterer til intervjuet) med inline-redigering; CTA «Start livsintervjuet»
  / «Oppdater retningen» (mounter `FlowSheet` direkte på siden). Deretter Verdier,
  Tilbakeblikk (uendret) og «AI-utkast» (de gamle envision-knappene, nedgradert fra
  «Retning» til utkast). `data-track`-labels: `retning:start-livsintervju`,
  `retning:rediger-visjon`, `retning:lagre-visjon`, `retning:visjon-tekst`.
- Ny rute `api/retning/vision` (POST): manuell revisjon per horisont →
  `saveAuthoredVision` (superseder aktiv) + hendelseskort.

### Fase 3: Rytme (kvartal + år)

- Ny flow `retning_kvartal` («Retningssamtalen», ett chat-steg, `gpt-5.4`): holder
  retningen opp mot ferske synteser («du sa X, perioden viser Y»), `<status>` = gap-notat,
  valgfri `<visjon>`-blokk = revidert kvartalsvisjon. `onComplete` → `api/retning/kvartal`:
  reflections `retningsgap` + `retningssamtale` (periodKey f.eks. `2026-Q3`), evt.
  `saveAuthoredVision('vision_quarterly')`, hendelseskort. Rene hjelpere
  (`quarterPeriodKey`, `isInQuarterWindow`, `parseVisionBlock`) i
  `src/lib/flows/retning-kvartal.ts` med tester.
- Action-producers (registrert i `PRODUCERS`):
  - `retning-kvartal.ts`: chip de første ~3 ukene av hvert kvartal, krever
    brukerforfattet retning, forsvinner når samtalen er levert for kvartalet.
  - `livsintervju.ts`: chip når intervjuet aldri er gjennomført («Sett retningen»)
    eller siste er >11 måneder gammelt («Årlig oppdatering»).
- HomeScreen/HomeOverlays: `open-flow`-intents og `FlowSheet`-mounts for begge flytene
  (kontekst hentes fra `interview-context`).

**Merk:** `planning_quarter_plan`/`planning_year_plan` i registry er ikke wiret noe sted
(ingen launcher/onComplete) — retningsrytmen ble bevisst bygget som egne, små flyter i
stedet for å bygge på dem.

## Beslutninger

- **Gjenbruk fremfor ny datamodell:** ingen SQL-migrasjon. `dreams.kind` er ren tekst,
  supersede-kjeden fantes allerede, `memories.category='values'` fantes allerede.
- **Brukerforfattet > LLM-foreslått:** `originKind: 'user_authored'` skiller retning fra
  utkast; konfrontasjons-instruksen aktiveres kun når retningen faktisk er brukerens egen.
- **Ingen nye AI-verktøy:** intervjuet og Retning-siden er skriveflatene. Unngår
  dobbeltregistrering i tools-arrayen + dispatch i chat-ruten.
- **Livskompass-kobling holdes myk:** dimensjonene brukes som døråpnere i verdi-steget,
  ingen schema-kobling — verdiene er brukerens egne formuleringer.
- **Google Chat-nudge utsatt:** chips på hjemskjermen dekker rytmen; nudge legges til
  hvis chipene ignoreres over tid.

## Verifisering

- `npm test`: 1325 tester grønne (23 nye: livsintervju-hjelpere, direction-context,
  retning-kvartal-hjelpere). `npm run check`: 0 feil.
- **Gjenstår i dev (krever DATABASE_URL/OPENAI_API_KEY):**
  1. Kjør livsintervjuet fra `/drommer` → sjekk tre `dreams`-rader
     (`user_authored`/`user_confirmed`), values-memories, `livsintervju`-reflection og
     dagbok-kort.
  2. Send en vanlig chatmelding → verifiser at «LANGSIKTIG RETNING»-blokken inneholder
     de forfattede visjonene + utfordrings-instruksen, og at coachen konfronterer.
  3. Rediger en visjon på Retning-siden → sjekk `supersededBy` + revisjonshistorikk.
  4. `VISUAL_REVIEW_CONTEXT="Restrukturert /drommer til Retning-side" npm run test:visual:review`
     (siden er ikke i 5-siders-suiten, men hjem-siden kan påvirkes av nye chips).
