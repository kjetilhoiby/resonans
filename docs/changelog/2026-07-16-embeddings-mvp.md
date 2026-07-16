# Embeddings-MVP: pgvector og semantisk memory-dedup

Dato: 2026-07-16
Status: ferdig (backfill kjøres manuelt i prod, se Verifisering)

## Kontekst

`MemoryService.findSimilar` brukte ILIKE-token-overlapp for dedup/supersede av memories —
omformuleringer av samme verdi («Nærvær med barna» vs. «Være til stede for ungene») ble to
separate rader. Med livsintervjuet som skriver bekreftede verdier ved hvert (re-)intervju
ville dette gradvis forsøplet både memories-tabellen og VERDIER-blokken i chat-konteksten.
Stacken hadde alt som trengtes: Neon støtter pgvector, drizzle-orm 0.44 har `vector`-type
og `cosineDistance`, OpenAI-nøkkelen finnes.

## Faser

### MVP (denne leveransen)
- **Migrasjon `0037_pgvector_embeddings.sql`**: `CREATE EXTENSION IF NOT EXISTS vector` +
  `embedding vector(1536)` på `memories` og `reflections` (sistnevnte ligger klar for
  steg 2, fylles ikke ennå). Ingen indeks — tabellene er små nok for sekvensiell skanning;
  HNSW (`vector_cosine_ops`) legges til når radantall krever det. Schema.ts matcher.
- **`embedding-service.ts`**: tynn wrapper rundt `openai.embeddings.create`
  (`text-embedding-3-small`, 1536 dim, input kuttes ved 8000 tegn). Berikelse, aldri
  blokkerende: null ved feil, kalleren fortsetter.
- **`createMemory`** genererer embedding ved skriving.
- **`findSimilar`**: primært cosine-likhet (terskel 0.6, kun ikke-superseded rader — å
  matche en supersedert rad ville brutt kjeden dens ved re-supersede); ILIKE-fallback kun
  når embedding ikke kan genereres. Fantes embedding men ingen match over terskelen,
  returneres null (ikke løsere ILIKE — da er det faktisk en ny memory).
- **Backfill**: `npm run db:backfill-embeddings` (`scripts/backfill-embeddings.mjs`) —
  idempotent, batcher 50 om gangen, kun `embedding IS NULL`. Kjøres manuelt (kaller
  OpenAI, hører ikke hjemme i deploy-pipelinen).

### Steg 2 (senere)
Semantisk søk i `query_reflections`: embed spørring → nærmeste refleksjoner på tvers av
kinds («hva har jeg sagt om X» uten å vite om det bor i livsintervju, retningssamtale
eller dagbok). Krever embedding-generering i `createReflection` + backfill av reflections.

## Beslutninger
- **Terskel 0.6** for «samme sak» på korte norske setninger — omformuleringer lander
  typisk 0.6–0.8, urelaterte under 0.4. Justeres empirisk om dedup blir for grådig/slapp.
- **Embeddings er berikelse, aldri krav**: alle skrivestier fungerer uten (null-embedding
  lagres, ILIKE-fallback), så en OpenAI-glipp aldri blokkerer et intervju.
- **Reflections-kolonnen legges nå men fylles ikke** — sparer en migrasjon når steg 2
  kommer, uten å binde design.

## Verifisering
- `npm test` + `npm run check` grønne.
- Deploy kjører migrasjonen automatisk (SQL først, så ser drizzle push matchende state).
- **Manuelt etter deploy:** `DATABASE_URL=... OPENAI_API_KEY=... npm run db:backfill-embeddings`
  → sjekk `SELECT count(*) FROM memories WHERE embedding IS NULL` → 0.
- Reell test: lever et (re-)intervju med en omformulert verdi → sjekk at den superseder
  den gamle formuleringen i stedet for å bli en duplikat-rad.
