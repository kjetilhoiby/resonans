-- Innleveringsdato for bibliotekslån på bøker i bokhylla.
-- Når kolonnen er satt, regnes boka som et lån og vises i "Lån"-seksjonen.
ALTER TABLE books ADD COLUMN IF NOT EXISTS loan_due_date timestamp;
