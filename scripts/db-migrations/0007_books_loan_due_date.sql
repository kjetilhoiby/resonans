-- Bibliotekslån på bøker i bokhylla.
-- loan_due_date: innleveringsdato — satt = boka regnes som et lån.
-- loan_start_date: når lånet ble registrert, brukt til progressbar (hvor mye
-- av låneperioden som gjenstår).
ALTER TABLE books ADD COLUMN IF NOT EXISTS loan_due_date timestamp;
ALTER TABLE books ADD COLUMN IF NOT EXISTS loan_start_date timestamp;
