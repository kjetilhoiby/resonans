-- Plan mot historikk på meal_plans (docs/changelog/2026-11-02-middagsplan-og-historikk.md).
--
-- En rad var fram til nå bare en plan; ingenting sa om middagen ble spist.
-- `status` er 'planned' | 'eaten' | 'skipped'. Avkrysset «middag: X» i
-- ukeplanen ER registreringen av at middagen ble spist, så speilingen mellom
-- dem går begge veier (meal-plan-sync.ts).
ALTER TABLE meal_plans ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'planned';

-- Dag-punkter som alt er hakket av: middagen ble spist.
UPDATE meal_plans mp
SET status = 'eaten'
FROM checklist_items ci
WHERE ci.metadata ->> 'linkedMealPlanId' = mp.id::text
	AND ci.checked = true
	AND mp.status = 'planned';

-- Dag-punkter som er hoppet over (og ikke utsatt): planen ble droppet.
UPDATE meal_plans mp
SET status = 'skipped'
FROM checklist_items ci
WHERE ci.metadata ->> 'linkedMealPlanId' = mp.id::text
	AND ci.skipped_at IS NOT NULL
	AND ci.snoozed_to_date IS NULL
	AND ci.checked = false
	AND mp.status = 'planned';

-- MCP-klientens nødløsning før feltet fantes: «Spist» i notatfeltet. Bare
-- datoer som har vært, og notatet ryddes bare når det var «Spist» og ingenting
-- annet OG raden har en rett — uten mealId er notatet tittelen dag-punktet leser.
UPDATE meal_plans
SET status = 'eaten'
WHERE status = 'planned'
	AND date <= (now() AT TIME ZONE 'Europe/Oslo')::date
	AND notes ~* '^\s*spist\y';  -- \y er ordgrense i Postgres; \b er backspace

UPDATE meal_plans
SET notes = NULL
WHERE status = 'eaten'
	AND meal_id IS NOT NULL
	AND notes ~* '^\s*spist\s*\.?\s*$';

-- Speilet skal stå likt: et dag-punkt for en rad som nå er spist, hakes av.
UPDATE checklist_items ci
SET checked = true, checked_at = coalesce(ci.checked_at, now()), skipped_at = NULL
FROM meal_plans mp
WHERE ci.metadata ->> 'linkedMealPlanId' = mp.id::text
	AND mp.status = 'eaten'
	AND ci.checked = false;

CREATE INDEX IF NOT EXISTS meal_plans_user_status_date_idx ON meal_plans (user_id, status, date);
