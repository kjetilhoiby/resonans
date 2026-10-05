-- Hvor tida i svaret går: modellkall mot alt annet, og hva modellen brukte.
--
-- Etter 0069/0070 visste vi at første ord kom etter ~15 s med gpt-5.4, men
-- ikke HVORFOR: modellen som tenker, verktøyene, eller en stor prompt. Tre
-- forklaringer med tre ulike rettelser, og ingen av dem kan velges uten å
-- måle. Tokentallene kommer fra OpenAIs `usage` og er rene tall.
-- Se docs/changelog/2026-10-05-coachen-smart-og-rask.md, fase 4.
ALTER TABLE chat_perf_samples ADD COLUMN IF NOT EXISTS model_ms integer;
ALTER TABLE chat_perf_samples ADD COLUMN IF NOT EXISTS prompt_tokens integer;
ALTER TABLE chat_perf_samples ADD COLUMN IF NOT EXISTS completion_tokens integer;
ALTER TABLE chat_perf_samples ADD COLUMN IF NOT EXISTS reasoning_tokens integer;
