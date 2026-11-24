-- Lageret får en dato for når beholdningen sist ble bekreftet, og en ønsket
-- buffer for basisvarer (docs/changelog/2026-11-24-middagsplanen-som-fasit.md).
--
-- `confirmed_at`: sist noen sa «dette stemmer» — ved registrering, ved endret
-- mengde, ved en kvittering som la varen inn, eller med «✓ Stemmer». Handlelista
-- stoler ikke på et tall som er eldre enn PANTRY_STALE_DAYS.
-- `target_quantity`: hvor mye av en fast vare som skal finnes hjemme («ett brød
-- i fryseren»). Handlelista fyller opp til den.
ALTER TABLE pantry_items ADD COLUMN IF NOT EXISTS confirmed_at timestamp;
ALTER TABLE pantry_items ADD COLUMN IF NOT EXISTS target_quantity numeric;

-- Eksisterende rader: den beste datoen vi har er da varen sist ble lagt inn.
-- Det er en øvre grense for hvor fersk beholdningen er, aldri en overdrivelse.
UPDATE pantry_items SET confirmed_at = added_at WHERE confirmed_at IS NULL;

-- Standardverdien settes ETTER utfyllingen: en DEFAULT på ADD COLUMN ville gitt
-- alle gamle rader «bekreftet i dag», altså påstått at hele lageret var sjekket.
ALTER TABLE pantry_items ALTER COLUMN confirmed_at SET DEFAULT now();
