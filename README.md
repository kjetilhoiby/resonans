# Resonans

Personlig AI-coach som kobler helsedata, økonomi og hverdagsplanlegging gjennom en norskspråklig chat-flate. SvelteKit 2 + TypeScript, OpenAI GPT-4o, PostgreSQL, deployet som Docker-container.

## Oppsett

```bash
npm install --force     # --force pga. Node v23
cp .env.example .env    # Fyll inn DATABASE_URL, OPENAI_API_KEY, AUTH_SECRET
npm run dev             # http://localhost:5174
```

## Kommandoer

```bash
# Utvikling
npm run dev             # Dev-server (port 5174)
npm run build           # Produksjons-build
npm run check           # TypeScript + Svelte typesjekk

# Testing
npm test                # Enhetstester (Vitest, ~320 tester, <1s)
npm run test:visual     # Visuell regresjon (Playwright, ~14s)
npm run test:visual:review  # LLM-drevet visuell review (~30s)

# Database
npm run db:push         # Push schema til DB (lokal utvikling)
npm run db:sql-migrate  # Kjør SQL-migrasjoner
npm run db:studio       # Drizzle Studio
```

## Arkitektur

Se [CLAUDE.md](CLAUDE.md) for detaljert arkitekturdokumentasjon, konvensjoner og agentinstruksjoner.

## Dokumentasjon

- `CLAUDE.md` — Agentinstruksjoner og arkitektur (autoritativ kilde)
- `docs/changelog/` — Prosjektdokumentasjon for større endringer
- `docs/archive/` — Historiske planer og specs

## Deploy

Docker-container via `adapter-node`. Imaget bygges på GitHub
(`.github/workflows/docker.yml` → `ghcr.io/kjetilhoiby/resonans:<sha>`) og
deployes av Coolify. `docker/entrypoint.sh` kjører SQL-migrasjonene mot
databasen appen faktisk skal snakke med, før serveren starter.

Cron-klokka er appens egen dispatcher (`ENABLE_CRON_DISPATCHER=true`),
overvåket utenfra av `.github/workflows/watchdog.yml`.

## Lisens

Privat
