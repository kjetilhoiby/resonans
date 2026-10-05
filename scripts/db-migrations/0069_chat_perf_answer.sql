-- Selve svaret i chat-målingen, ikke bare konteksten fram til første modellkall.
--
-- Fram til oktober 2026 stoppet `chat_perf_samples` ved første modellkall. Da
-- standardmodellen ble byttet (gpt-4o-mini → gpt-5.4) og svaret begynte å
-- strømme, kunne «raskere» ikke etterprøves: modelltiden var ikke målt, og
-- hvilken modell som faktisk svarte — reserven inkludert — sto bare i loggen.
-- Se docs/changelog/2026-10-05-coachen-smart-og-rask.md, fase 2.
--
-- Alle kolonnene er NULL-bare: rader fra før finnes, og en melding som feilet
-- før svaret har ingen svartid.
ALTER TABLE chat_perf_samples ADD COLUMN IF NOT EXISTS model text;
ALTER TABLE chat_perf_samples ADD COLUMN IF NOT EXISTS first_token_ms integer;
ALTER TABLE chat_perf_samples ADD COLUMN IF NOT EXISTS total_ms integer;
ALTER TABLE chat_perf_samples ADD COLUMN IF NOT EXISTS tool_rounds integer;
ALTER TABLE chat_perf_samples ADD COLUMN IF NOT EXISTS fallback boolean;
ALTER TABLE chat_perf_samples ADD COLUMN IF NOT EXISTS streamed boolean;
