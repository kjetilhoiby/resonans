-- Rename recipes-tabellen til meals (måltid er byggeklossen i mat-universet).
-- Rename meal_plans.recipe_id til meal_id.
-- Drop meal_plans.custom_title (fri-tekst kobles nå alltid til en meals-rad).
--
-- Idempotent: bruker IF EXISTS-grener slik at re-kjøringer er trygge.

ALTER TABLE IF EXISTS recipes RENAME TO meals;
ALTER INDEX IF EXISTS recipes_user_idx RENAME TO meals_user_idx;

DO $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_name = 'meal_plans' AND column_name = 'recipe_id'
	) THEN
		ALTER TABLE meal_plans RENAME COLUMN recipe_id TO meal_id;
	END IF;
END $$;

ALTER TABLE IF EXISTS meal_plans DROP COLUMN IF EXISTS custom_title;
