-- Matplan: familie-default for porsjoner er 5 (2 voksne + 3 barn), ikke 2.
-- Backfiller også eksisterende middagsplaner som lå på gammel default —
-- FoodDashboard og handleliste-skaleringen regner 5 som nøytralt.

ALTER TABLE meal_plans ALTER COLUMN servings SET DEFAULT 5;

UPDATE meal_plans SET servings = 5 WHERE servings = 2;
