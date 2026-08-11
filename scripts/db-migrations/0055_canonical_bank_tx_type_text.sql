-- Bær SB1s typeText med på canonical_bank_transactions.
--
-- Rå-tabellen (raw_bank_transaction_versions) har type_text, canonical hadde det ikke.
-- Konsekvensen var at alle canonical-lesere kalte categorizeTransaction(desc, null, …),
-- så SB1s egen typeText-fallback ("MAT OG DRIKKE" → dagligvarer) var død på nettopp den
-- stien tema-dashboardet og chatten bruker. Kategoriseringen var derfor dårligere der enn
-- i categorized_events-projeksjonen, som leser feltet.
--
-- Se docs/changelog/2026-08-11-okonomi-tillitsgjennomgang.md, fase 1.

ALTER TABLE canonical_bank_transactions
	ADD COLUMN IF NOT EXISTS type_text text;

-- Backfill fra rå-versjonene: høyeste status_rank vinner, og ved likhet den ferskeste.
-- Bøttenøkkelen er den samme som upserten bruker, så koblingen er entydig.
UPDATE canonical_bank_transactions c
SET type_text = r.type_text
FROM (
	SELECT DISTINCT ON (sensor_id, account_id, transaction_date, amount, merchant_key)
		sensor_id, account_id, transaction_date, amount, merchant_key, type_text
	FROM raw_bank_transaction_versions
	WHERE type_text IS NOT NULL AND type_text <> ''
	ORDER BY sensor_id, account_id, transaction_date, amount, merchant_key,
	         status_rank DESC, last_seen_at DESC
) r
WHERE c.sensor_id = r.sensor_id
  AND c.account_id = r.account_id
  AND c.canonical_date = r.transaction_date
  AND c.amount = r.amount
  AND c.merchant_key = r.merchant_key
  AND c.type_text IS NULL;
