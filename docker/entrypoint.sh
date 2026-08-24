#!/bin/sh
# Containerens oppstart: migrer, så start serveren.
#
# `set -e` er hele poenget med at dette er et eget skript. På Vercel lå
# migreringen i `buildCommand`, altså i BYGGET — mot den databasen byggemiljøet
# tilfeldigvis pekte på, og med et resultat som ikke kunne stoppe deployet.
# Her kjører den i containeren, mot databasen appen faktisk skal snakke med, og
# en feilet migrering betyr at prosessen dør: healthchecken svarer aldri,
# deployet feiler, og forrige container står. Alternativet — å starte mot et
# halvmigrert skjema — er den feilen man bruker en kveld på å forstå.
set -eu

echo "[entrypoint] Migrerer databasen …"
# drizzle-kit er en devDependency og finnes ikke i runtime-imaget; SQL-
# migrasjonene er uansett autoritative. Se kommentaren i sync-db-schema.mjs.
SKIP_DRIZZLE_PUSH=1 node scripts/sync-db-schema.mjs

echo "[entrypoint] Starter serveren …"
# `exec` gjør node til PID 1, slik at SIGTERM fra Docker når prosessen. Uten
# det ville shellet fått signalet og noden blitt drept hardt etter timeout —
# og da lukkes aldri databasepoolen (se src/lib/db/index.ts).
exec node build/index.js
