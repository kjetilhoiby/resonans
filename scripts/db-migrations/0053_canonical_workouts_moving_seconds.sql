-- Bevegelsestid på kanoniske økter.
--
-- `duration_seconds` er elapsed («siste sporpunkt − første»), altså hvor lenge
-- opptaket varte. Glemmer man å avslutte sporingen, teller den døde halen fullt
-- ut — og MET-stien i effort-modellen er rent lineær i varighet. En el-sykkeltur
-- på 9,07 km sto som 2 t 20 min og fikk effort 114 der svaret var ~20.
--
-- `moving_seconds` er utledet av sporet (se $lib/domain/health/moving-time.ts) og
-- er det skåringen bruker når den finnes. NULL betyr «vet ikke» — ikke «sto stille».

ALTER TABLE canonical_workouts
	ADD COLUMN IF NOT EXISTS moving_seconds numeric;
