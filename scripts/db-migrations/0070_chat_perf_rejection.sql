-- Hva OpenAI avviste, når noe ble avvist: `400:unsupported_parameter:verbosity`.
--
-- Første svarmåling i prod (5. oktober 2026) sa at reserven svarte, men ikke
-- hvorfor — årsaken sto bare i loggen bak admin-tilgang. Verdien er bygd av
-- OpenAIs STRUKTURERTE feilfelt (status, code, param), aldri av
-- meldingsteksten, og ligger derfor trygt på det åpne `/api/diagnostikk`.
-- Se docs/changelog/2026-10-05-coachen-smart-og-rask.md, fase 3.
ALTER TABLE chat_perf_samples ADD COLUMN IF NOT EXISTS rejection text;
