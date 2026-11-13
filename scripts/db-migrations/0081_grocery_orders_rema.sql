-- Rema 1000-kvitteringer i grocery_orders (docs/changelog/2026-11-13-rema-kvitteringer.md).
--
-- Tabellene ble laget for Oda-ordrer fra e-post. Rema-kvitteringene hentes fra
-- Æ-appens API og lander i de samme radene (provider = 'rema1000',
-- order_ref = Remas transaksjons-id), så kvitteringskortet, «Legg i lager» og
-- plan-mot-kjøp virker uten en tredje modell. Feltene under har Oda aldri hatt:
-- en butikk er ikke en leveranse, og en kvitteringslinje bærer strekkoden.
ALTER TABLE grocery_orders ADD COLUMN IF NOT EXISTS store_name text;
ALTER TABLE grocery_orders ADD COLUMN IF NOT EXISTS purchased_at timestamp;

-- EAN er den stabile produktidentiteten: «NORVEGIA 1KG» og «Norvegia 26% 1kg»
-- er samme vare, og navnet på kvitteringen er forkortet.
ALTER TABLE grocery_order_lines ADD COLUMN IF NOT EXISTS ean text;
-- Rabatt i kroner. total_price er linjebeløpet FØR rabatten, slik Rema oppgir det.
ALTER TABLE grocery_order_lines ADD COLUMN IF NOT EXISTS discount decimal;
ALTER TABLE grocery_order_lines ADD COLUMN IF NOT EXISTS product_group text;

CREATE INDEX IF NOT EXISTS grocery_order_lines_user_ean_idx
	ON grocery_order_lines (user_id, ean) WHERE ean IS NOT NULL;
