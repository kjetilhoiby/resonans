-- TMDB person-id for regissøren på en film.
--
-- Regissøren var bare et navn, og et navn er ingen nøkkel: trykket på det skal
-- åpne filmografien, og et navnesøk i TMDB kan treffe en navnebror. Id-en
-- skrives ved opprettelse og av kontekstjobben (som også fyller den for filmer
-- lagt til før kolonnen fantes, ved «Oppdater kontekst»).
ALTER TABLE films ADD COLUMN IF NOT EXISTS director_tmdb_id integer;
