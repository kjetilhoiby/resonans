# Skill ut en økt som ble slått sammen med en annen

Dato: 2026-09-27
Status: ferdig

## Kontekst

Aktivitetslaget slår sammen alt i samme idrettsfamilie som starter innen to timer
(`CLUSTER_WINDOW_MS`). Det er riktig slingringsmonn for samme tur fra klokke, fil og app.
Det er feil for to turer samme ettermiddag.

27. september løp Kjetil på mølla kl. 17.17 (Ekko, 3,01 km) og ute kl. 17.55 (Ekko, 2,29 km).
Begge havnet i én klynge. `latestPerSensor` beholder den nyeste raden per sensor – den skal
la en rettet økt erstatte originalen – og tok uteturen. Mølleturen forsvant fra
`canonical_workouts`, og den gjenværende økta fikk mølleturens starttid med uteturens tall.

## Hva som er gjort

- **Utskilling er et flagg.** `POST /api/workouts/[id]/split` setter `metadata.clusterGroup`
  på raden, og på andre versjoner av samme opptak (samme sensor og `sessionId`).
  `DELETE` slår gruppa sammen igjen. Logikken bor i `$lib/server/workouts/split-workout`.
- **`clusterWorkoutEvents`** er trukket ut av `buildUnifiedWorkoutActivitiesPage` som en ren
  funksjon: en rad med gruppe klynges bare med sin gruppe, og rader uten gruppe aldri med den.
  Testet med ettermiddagen over (`activity-layer-clustering.test.ts`).
- **Sporvalget følger samme regel.** `readClusterTrackPoints` låner ikke spor på tvers av
  grupper – ellers fikk mølleturen kartet fra uteturen.
- **Skjulte versjoner vises.** `UnifiedWorkoutActivity.superseded` er radene `latestPerSensor`
  la til side. De vises som stiplede chips under «Kilder og avvik», med «Skill ut som egen økt»
  i kildepanelet. Uten dem fantes ingenting å skille ut.
- **Starttida kommer fra radene som gjelder**, ikke fra klynga – en forkastet rad med tidligere
  start ga økta feil klokkeslett.
- `clusterGroup` står i `USER_OWNED_METADATA_KEYS`, så valget overlever at kilden synker raden.

## Beslutninger

- Regelen på to timer beholdes. Splitting er utveien når den bommer.
