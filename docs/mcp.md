# MCP-serveren: Resonans i Claude og ChatGPT

Resonans er en MCP-server (Model Context Protocol) på **`<ORIGIN>/mcp`**. Den legges til
som en egendefinert connector i Claude eller ChatGPT, og brukeren logger inn med den
vanlige Google-innloggingen — ingen hemmelighet å lime inn.

## Legge den til

- **Claude** (claude.ai, Desktop, mobil): Innstillinger → Connectors → *Legg til
  egendefinert connector* → adressen over. Claude Code: `claude mcp add --transport http
  resonans <ORIGIN>/mcp`.
- **ChatGPT**: Innstillinger → Apps og connectors → *Opprett* (krever utviklermodus) →
  adressen over, autentisering OAuth.

Adressen og tilkoblede klienter står på `/settings/external-apps`, der hver tilkobling
kan kobles fra.

## Flyten

```
klient ──POST /mcp──────────────────────────────▶ 401 + WWW-Authenticate: resource_metadata=…
klient ──GET /.well-known/oauth-protected-resource/mcp ─▶ { authorization_servers: [ORIGIN] }
klient ──GET /.well-known/oauth-authorization-server ──▶ endepunktene
klient ──POST /oauth/register (RFC 7591) ──────────▶ client_id
nettleser ─▶ /oauth/authorize?…&code_challenge=… ─▶ /auth (Google) ─▶ samtykke ─▶ redirect med code
klient ──POST /oauth/token (code + code_verifier) ─▶ rsm_at_… (1 t) + rsm_rt_… (90 d, roteres)
klient ──POST /mcp, Authorization: Bearer rsm_at_… ─▶ verktøyene, som brukeren
```

| Fil | Eier |
|-----|------|
| `$lib/server/oauth/oauth-logic.ts` | ren logikk: PKCE, redirect-URI-er, registrering, metadata (testet) |
| `$lib/server/oauth/oauth-store.ts` | klienter, engangskoder, tilkoblinger (`oauth_*`-tabellene) |
| `routes/.well-known/*`, `routes/oauth/*` | oppdagelse, registrering, samtykke, token, revokering |
| `$lib/server/mcp/mcp-tools.ts` | hvilke verktøy, og hintene (read-only/destruktiv) |
| `$lib/server/mcp/mcp-server.ts` + `routes/mcp` | Streamable HTTP, tilstandsløs, JSON-svar |
| `$lib/server/csrf.ts` | CSRF-sjekken, med unntak for token/revoke |

## Regler

- **Verktøyene er assistentens** (`ASSISTANT_TOOLS`, samme sett som Ekko), minus quiz og
  forteller. Beskrivelser og skjemaer gjenbrukes fra verktøymodulene — skriv aldri et
  MCP-skjema ved siden av. Et nytt verktøy i `shared-tools.ts` dukker opp i MCP av seg selv.
- **`userId` kommer fra tokenet.** `adaptSharedTool` setter det ETTER modellens argumenter;
  fram til oktober 2026 sto det før, så et `userId`-argument ville vunnet.
- **Tokenene gjelder bare `/mcp`.** `rsm_`-prefikset skiller dem fra `rsn_`-hemmelighetene,
  som slipper inn i hele `/api`. `/mcp` godtar ikke `rsn_`, og `/api` godtar ikke `rsm_`.
- **Alt lagres som sha256-hash** med `EXTERNAL_API_SECRET_PEPPER`. Koder er engangs og
  slettes FØR de sjekkes, så en feilet verifier ikke kan prøves på nytt.
- **Bare autorisasjonskode + PKCE S256.** Redirect-URI-er: https, eller http mot loopback,
  eksakt match. Egendefinerte skjema avvises.
- **Registreringen er åpen; samtykket er grensa.** Klientnavnet er selvoppgitt, så
  samtykkesiden viser redirect-HOSTEN og ber brukeren avslå hvis den ikke er claude.ai,
  chatgpt.com eller noe de selv startet. Siden kan ikke rammes inn (`frame-ancestors 'none'`).
- **Samtykkesiden leser brukeren fra økta**, aldri via `resolveRequestUserId` — samme regel
  som `/api/apps/callback`. Den står i `public-paths.ts` fordi hooks sender uinnloggede til
  `/auth?next=<sti>` UTEN spørrestrengen, og hele forespørselen står der.
- **CSRF: token og revoke er unntatt, alt annet er som før.** SvelteKit avviser i drift
  enhver skjema-POST uten `Origin`, og OAuth-token-forespørselen er nettopp det (RFC 6749
  krever `x-www-form-urlencoded`, og den kommer fra Claude/ChatGPT sine servere). Sjekken
  kan ikke unntas per rute, så `csrf.checkOrigin` er av og sjekken gjenskapt i
  `csrfHandle`. **Feilen syntes ikke i dev** — SvelteKit sjekker bare utenfor dev — så
  testen må kjøres mot `npm run build`. (Ekko kom forbi ved å sette `Origin` selv.)
  Build-loggen sier at `checkOrigin` er deprecated; det finnes ingen erstatning som kan
  unnta forespørsler uten `Origin`.
- **Ingen «samme tur» på serveren.** Ekko nekter å slette en vektmåling funnet i samme tur
  (`AssistantTurnState`). Et MCP-kall er ett verktøykall, så `manage_*` merkes
  `destructiveHint` og klienten ber brukeren bekrefte.
- **Tilstandsløs**: én `Server` og transport per forespørsel, `enableJsonResponse`, ingen
  økt-id. GET og DELETE på `/mcp` gir 405. To containere kan svare annenhver gang.
- Logglinjer: `[oauth]` (registrering, ny tilkobling) og `[mcp] <verktøy> klient=… ok|feil
  <ms>` — lesbare over `GET /api/admin/logs?grep=[mcp]`.

## Teste lokalt

Token-endepunktet må testes mot en PROD-build (CSRF-sjekken). Mot podman-basen:

```bash
npm run build
DATABASE_URL=postgres://resonans:$PW@127.0.0.1:55432/resonans ORIGIN=http://127.0.0.1:5175 \
  PORT=5175 CRON_SECRET=lokal ENABLE_CRON_DISPATCHER=false ENABLE_JOB_WORKER=false \
  node --env-file=.env build
```

`--env-file` overstyrer ikke variabler som alt er satt. Samtykket krever en økt; en
gyldig `authjs.session-token` kan lages med `encode` fra `@auth/core/jwt` og `AUTH_SECRET`
(`{ userId: 'local-test-user' }`). MCP Inspector (`npx @modelcontextprotocol/inspector`)
gjør hele flyten i nettleseren.

## Kjent rest

- Ingen scope-inndeling: en tilkobling får alle verktøyene, lesing og skriving.
- Client ID Metadata Documents (CIMD) støttes ikke; klientene faller tilbake på DCR.
- Ingen rydding av klienter som aldri fikk en tilkobling (én rad per forlatt registrering).
