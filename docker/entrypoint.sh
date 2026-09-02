#!/bin/sh
# Containerens oppstart: migrer, så start serveren.
#
# `set -e` er hele poenget med at dette er et eget skript. Før flyttingen lå
# migreringen i byggeplattformens `buildCommand`, altså i BYGGET — mot den
# databasen byggemiljøet tilfeldigvis pekte på, og med et resultat som ikke
# kunne stoppe deployet.
# Her kjører den i containeren, mot databasen appen faktisk skal snakke med, og
# en feilet migrering betyr at prosessen dør: healthchecken svarer aldri,
# deployet feiler, og forrige container står. Alternativet — å starte mot et
# halvmigrert skjema — er den feilen man bruker en kveld på å forstå.
set -eu

echo "[entrypoint] Migrerer databasen …"
# Migreringene kjører som EIER-rollen, serveren som runtime-rollen.
#
# `apply-sql-migrations.mjs` leser `DATABASE_URL`, og den peker på
# `<app>_runtime` — en rolle uten DDL, med vilje (se provision-app-db.sh:
# det er dét som gjør at Row Level Security faktisk gjelder for den). En
# migrasjon med `create table` ville derfor feilet på «permission denied»
# ved containerstart, og først når noen la til en migrasjon — altså lenge
# etter at oppsettet så ferdig ut.
#
# Vi overstyrer derfor variabelen for MIGRERINGSSTEGET alene. Uten
# `MIGRATION_DATABASE_URL` faller den tilbake på `DATABASE_URL`, slik at et
# oppsett uten rolleskille (lokalt, eller mot Neon) virker som før.
#
# drizzle-kit er en devDependency og finnes ikke i runtime-imaget; SQL-
# migrasjonene er uansett autoritative. Se kommentaren i sync-db-schema.mjs.
DATABASE_URL="${MIGRATION_DATABASE_URL:-$DATABASE_URL}" \
	SKIP_DRIZZLE_PUSH=1 node scripts/sync-db-schema.mjs

echo "[entrypoint] Starter serveren …"
# `exec` gjør node til PID 1, slik at SIGTERM fra Docker når prosessen. Uten
# det ville shellet fått signalet og noden blitt drept hardt etter timeout —
# og da lukkes aldri databasepoolen (se src/lib/db/index.ts).
exec node build/index.js
