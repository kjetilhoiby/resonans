# cron.yml slettet, vakthund inn (Fase 3, del 3 — opprydding)

Dato: 2026-09-02
Status: ferdig

## Kontekst

Etter ett døgn i drift hadde den interne dispatcheren tatt **alle 630 slots**
(0 til GitHub Actions) — sikkerhetsnettet gjorde ingenting lenger, og brukte
~290 workflow-kjøringer i døgnet på å finne «0 due».

Men `cron.yml` hadde én egenskap som ikke kunne slettes uten erstatning: den
sto UTENFOR systemet. Monitoreringen (`/api/cron/monitoring` → Google Chat)
dispatches av den samme klokka den overvåker — dør dispatcheren, dør også
varselet om at den døde. Stillhet fra et dødt system er ikke til å skille fra
stillhet fra et friskt.

## Faser

### Fase 1: Klokkepulsen i /api/health

`classifyClockPulse` (ren, i `cron-dispatch-verdict.ts`): siste rad i
`cron_executions`, død når eldre enn `CLOCK_PULSE_STALE_MINUTES` (20). Fire
jobber går hvert 5. minutt døgnet rundt, så tre bomma slots på rad er en død
klokke, ikke jitter. En tom base klassifiseres som **død, ikke ukjent** —
vakthunden skal si fra, ikke vente på en første kjøring som aldri kommer.

Pulsen ligger i `HealthCheckResult.clock` og — med vilje — i den
**uautentiserte** delen av `/api/health`-svaret: vakthunden har ingen
hemmelighet, og «en cron-kjøring skjedde nylig» lekker ingenting.

### Fase 2: watchdog.yml

Hvert 30. minutt: `GET /api/health`, rød workflow (→ GitHub-varsel på e-post)
hvis appen er nede eller `clock.alive` er false. Ingen dispatching, ingen
`CRON_SECRET`. `APP_URL` som variabel, ikke hemmelighet — samme lærdom som i
gamle cron.yml (maskert domene gjorde feilsøkingen blind).

### Fase 3: cron.yml slettet

Dispatch-mekanikken i appen er uendret: `?due=1`-endepunktet og kravtabellen
består, så en gjenopprettet cron.yml (git revert) kan settes rett i drift
igjen — det er fallback-veien om appen må tilbake til Vercel, som ikke har
noen intern dispatcher.

## Beslutninger

- **Vakthunden sjekker BARE pulsen**, ikke `status` — sensor-ferskhet og
  jobbhelse er monitoreringens jobb (Google Chat, dedupede varsler), og den
  virker så lenge klokka lever. Å duplisere det i GitHub ville gitt to
  varslingskanaler for samme funn.
- **20-minuttersterskelen** er tre bomma 5-minutters-slots — GH-jitter på
  vakthunden selv (den kan komme minutter for sent) påvirker ikke målingen,
  siden den måler basens tidsstempler, ikke sin egen kadens.

## Verifisering

`npm test` (+3 tester på `classifyClockPulse`) og `npm run check` grønne.
Vakthund-logikken er samme fetch-mønster som cron.yml brukte i drift i to år;
`clock`-feltet verifisert i dev: `{"alive":true,"minutesAgo":0}` med fersk
kjøring, `alive:false` mot tom base.

## Konsekvenser å huske

- **Ved fallback til Vercel: gjenopprett cron.yml** (git revert av slettingen).
  Vakthunden vil korrekt stå rød til klokka er tilbake.
- GitHub Actions-forbruket faller fra ~290 til ~48 kjøringer i døgnet.
