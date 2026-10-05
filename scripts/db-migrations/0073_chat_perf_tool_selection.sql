-- Verktøyutvalget per svar: hvilke grupper som ble valgt, av hvilket signal,
-- hvor mange verktøy det ga, hvilke modellen kalte og hvilke av dem som
-- MANGLET i utvalget. Går i skyggemodus først: alle verktøyene sendes, og
-- bom-andelen avgjør om kuttet kan skrus på (CHAT_TOOL_SELECTION=on).
-- Alle navn er maskinnavn fra en hviteliste (`parseToolSelection`), aldri
-- brukerinnhold. Se docs/changelog/2026-10-05-coachen-smart-og-rask.md, fase 6.
ALTER TABLE chat_perf_samples ADD COLUMN IF NOT EXISTS tool_selection jsonb;
