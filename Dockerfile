# syntax=docker/dockerfile:1

# ---- avhengigheter -------------------------------------------------------
# node:22-slim, IKKE alpine. `@resvg/resvg-js` er en native binary som lastes
# ned prebuilt per plattform, og musl (alpine) mot glibc (slim) gir
# «Cannot find module '@resvg/resvg-js-linux-x64-musl'» — en feil som først
# dukker opp når noe faktisk rendrer et bilde, ikke ved bygg.
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --force

# ---- bygg ----------------------------------------------------------------
FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# DEPLOY_TARGET velger adapter-node (se svelte.config.js). Uten den ville
# `VERCEL` vært utsatt for hva byggemiljøet tilfeldigvis setter.
ENV DEPLOY_TARGET=node
RUN npm run build

# ---- avhengigheter uten dev ----------------------------------------------
FROM node:22-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --force --omit=dev

# ---- kjøretid ------------------------------------------------------------
FROM node:22-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
# adapter-node defaulter til 512 kB. `/api/apps/upload` tar imot GPX-spor og
# bilder fra Ekko på opptil 20 MB, og en 413 derfra ser i appen ut som at
# opplastingen «bare feilet».
ENV BODY_SIZE_LIMIT=25M
# Traefik terminerer TLS, så appen ser http. Uten disse tror SvelteKit at
# origin er http://<container> og avviser form actions med «Cross-site POST».
ENV PROTOCOL_HEADER=x-forwarded-proto
ENV HOST_HEADER=x-forwarded-host

# curl, og det er ikke valgfritt: Coolify kjører SIN EGEN healthcheck inne i
# containeren med `curl` eller `wget`, og ignorerer HEALTHCHECK-instruksjonen
# under. `node:22-slim` har ingen av delene, så containeren stemples unhealthy
# og deployen rulles tilbake — mens appens egen logg sier «Listening on
# http://0.0.0.0:3000». Målt på toduvel 30. august 2026.
#
# app-template slapp unna fordi den kjører alpine, der busybox har `wget`. Den
# forskjellen forsvant i det vi måtte over på slim for @resvg/resvg-js.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends curl \
	&& rm -rf /var/lib/apt/lists/*

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build     --chown=node:node /app/build        ./build
COPY --chown=node:node package.json ./

# Migreringene kjører i entrypointet, mot databasen deployet faktisk skal
# snakke med. `sync-db-schema.mjs` importerer bare `postgres` (prod-dep) og
# spawner `apply-sql-migrations.mjs`, som leser db-migrations/.
COPY --chown=node:node scripts/sync-db-schema.mjs      ./scripts/sync-db-schema.mjs
COPY --chown=node:node scripts/apply-sql-migrations.mjs ./scripts/apply-sql-migrations.mjs
COPY --chown=node:node scripts/db-migrations            ./scripts/db-migrations
COPY --chown=node:node docker/entrypoint.sh             ./docker/entrypoint.sh

USER node
EXPOSE 3000

# Healthchecken treffer appen på 127.0.0.1, ikke `localhost` — det siste kan
# resolve til ::1, og adapter-node lytter på 0.0.0.0. Da svarer den ikke, og
# deployet står som «unhealthy» mens loggen sier «Listening on 0.0.0.0:3000».
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./docker/entrypoint.sh"]
