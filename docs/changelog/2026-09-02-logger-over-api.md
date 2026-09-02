# Loggene kan leses over API

Dato: 2026-09-02
Status: ferdig

## Kontekst

`[chat-perf]`, `[cron-dispatch]`, `[job-worker]` og `[500]`-linjene bor i
containerens stdout — altså bare i Coolify. Alt annet diagnoseverktøy i appen
er selvbetjent over API (`/api/health?debug`, dispatcher-kortet, Google
Chat-varsler «med kopierbar feilbeskrivelse for Claude-debugging»); loggene
var det ene som krevde Coolify-innlogging. Konkret utløser: en Claude-økt
skulle lese `[chat-perf]`-tallene etter parallelliseringen og kunne ikke.

## Hva

- **`$lib/server/log-buffer.ts`**: console.log/info/warn/error wrappes ved
  oppstart (globalThis-vakt mot dobbel-wrapping under vite-dev), linjene
  legges i en ringbuffer på 2000 (O(1) push, linjer kuttet på 4000 tegn,
  Error → stack, sirkulære objekter overlever). Ren logikk (format + ring)
  testet.
- **`GET /api/admin/logs?grep=&level=&limit=`**: admin-gatet (logglinjer kan
  inneholde hva som helst). Virker med session, `x-resonans-user-id` +
  `x-resonans-secret`, og API-secret (`Authorization: Bearer rsn_…`) — det
  siste er veien for maskintilgang, jf. CLAUDE.md om `user_api_secrets`.
- Installeres først i hook-kroppen: dispatcher/worker-oppstarten fanges;
  linjer fra selve import-fasen (`[db] driver=…`) gjør ikke.

## Egenskaper sagt høyt

- **Per instans.** Ved rullende oppdatering svarer instansen Traefik ruter
  til; `instanceStartedAt` i svaret sier hvem.
- **Flyktig.** Restart tømmer bufferet — et vindu, ikke et arkiv. Historikk
  med krav på seg bor i `cron_executions`/`usage_events`.

## Verifisering

`npm test` (4 084, +6) og `npm run check` grønne. Dev-røyk mot ekte
PostgreSQL 16: `?grep=cron-dispatch` returnerte `[cron-dispatch] startet: 26
jobber …`-linja med `installed: true` og korrekt `instanceStartedAt`.

## Bruk (Claude-økter)

```
curl -H "Authorization: Bearer $RESONANS_API_SECRET" \
  "https://resonans.apps.hoi.by/api/admin/logs?grep=chat-perf&limit=50"
```

Hemmeligheten opprettes i `/settings/external-apps` og legges som
miljøvariabel i Claude Code-miljøet (claude.ai/code → miljøinnstillinger), så
enhver økt kan lese uten at den limes i chat.
