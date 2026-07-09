-- «Sagbare kutt (guillotine)» som av/på per kappliste. Når på pakkes plater slik
-- at hvert kutt går kant-til-kant (kan sages med rette gjennomgående snitt),
-- på bekostning av litt løsere pakking. Default av — opt-in via knapp i UI, så
-- eksisterende lister beholder tettest pakking (MaxRects) og samme kostnad.

ALTER TABLE cut_lists ADD COLUMN IF NOT EXISTS guillotine boolean NOT NULL DEFAULT false;
