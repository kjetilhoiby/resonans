-- pgvector: semantisk likhet for memories (dedup/supersede av verdier) og
-- reflections (fremtidig semantisk søk). text-embedding-3-small = 1536 dim.
-- Ingen indeks ennå — tabellene er små nok for sekvensiell skanning; legg til
-- HNSW (USING hnsw (embedding vector_cosine_ops)) når radantallet krever det.
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE memories ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE reflections ADD COLUMN IF NOT EXISTS embedding vector(1536);
