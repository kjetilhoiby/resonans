-- Hva prompten består av, og hvor mye av den OpenAI hentet fra cachen.
--
-- Etter 0071: median 34 200 prompt-tokens per kall og 0 tenketokens, så
-- prompten er den store posten. Lokalt målt er verktøylista alene 67
-- verktøy og ~89 000 tegn (~22–25 000 tokens). Om det koster TID avhenger av
-- om OpenAIs prompt-cache treffer: et cachet prefiks er raskere og billigere.
-- `prompt_parts` er [{ "name": "tools", "chars": 89261 }, …] — navnene er
-- kode-literaler fra en hviteliste, tallene er lengder, aldri innhold.
-- Se docs/changelog/2026-10-05-coachen-smart-og-rask.md, fase 5.
ALTER TABLE chat_perf_samples ADD COLUMN IF NOT EXISTS prompt_tokens_total integer;
ALTER TABLE chat_perf_samples ADD COLUMN IF NOT EXISTS cached_tokens integer;
ALTER TABLE chat_perf_samples ADD COLUMN IF NOT EXISTS prompt_parts jsonb;
