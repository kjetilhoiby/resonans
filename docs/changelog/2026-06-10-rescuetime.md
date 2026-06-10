# RescueTime-integrasjon (fase 1)

Dato: 2026-06-10
Status: ferdig (venter på API-nøkkel fra brukeren for aktivering)

## Kontekst

iOS Skjermtid dekker telefonen, men PC-skjermen var blind sone. Målet er ikke en «super-skjermtid», men innsikt i **kveldsjobbing** og **typer arbeidsoppgaver** på PC. RescueTime gir strukturerte data via API (i motsetning til skjermtid-skjermbildene som tolkes med vision).

Fase 1 skiller bevisst *ikke* jobb- og hobby-koding — verktøyene er de samme, så det krever vindustittel-klassifisering (`restrict_kind=document`, RescueTime premium). Det er tenkt som fase 2, etter mønster fra transaksjons-kategoriseringen (manuelle overrides → LLM-mappings → regler).

## Faser

### Fase 1: Sync + kategorier + kveldsjobbing-signal
- `src/lib/server/integrations/rescuetime-parser.ts` — ren parsing av API-svar (time-oppløste aktivitetsrader) til én struktur per dag: totaler, produktiv/distraherende tid (RescueTimes -2..2-skala), kategorier, topp-aktiviteter, timefordeling og kveldsvindu (fra kl. 17).
- `src/lib/server/integrations/rescuetime.ts` — sensor-oppretting (provider `rescuetime`), API-nøkkel i `sensors.credentials` (base64 JSON, samme mønster som Withings), sync med upsert per dag (`dataType: 'rescuetime_day'`, timestamp = lokal middag som screen_time) + `aggregatePeriodsFrom`.
- `POST /api/sensors/rescuetime/setup` — kobler til med API-nøkkel (fra rescuetime.com/anapi/manage), validerer mot API-et, backfiller 30 dager (konfigurerbart).
- `POST /api/sensors/rescuetime/sync` — manuell sync for innlogget bruker.
- `GET /api/cron/rescuetime-sync` — tre ganger daglig (04:40, 12:40, 20:40 UTC), siste 3 dager per bruker; delvise dager overskrives av neste sync. Registrert i `/api/cron/jobs` og `FRESHNESS_THRESHOLDS` (26 t).
- Signal `evening_screen_work_7d` i `signal-service.ts` (`produceEveningScreenWork7d`): antall kvelder med >15 min PC-aktivitet etter kl. 17 siste 7 dager, total kveldstid, toppkategorier og per-dag-fordeling i context. Severity: medium ved ≥4 kvelder og ≥4 t, low ved ≥2 kvelder. Returnerer null (hopper over) for brukere uten RescueTime-data.

## Beslutninger

- **API-nøkkel, ikke OAuth**: RescueTimes Analytic Data API bruker enkel nøkkel — ingen OAuth-flyt eller token-refresh nødvendig. Nøkkelen er per bruker i `sensors.credentials`, ingen nye env-variabler.
- **Én event per dag med timefordeling innbakt** fremfor én event per time: speiler `screen_time`-modellen, holder eventstrømmen kompakt, og kveldsvinduet beregnes i parseren slik at signalprodusenten slipper å kjenne timestrukturen.
- **Kveld = fra kl. 17** (RescueTime rapporterer i kontoens lokale tid, så ingen TZ-konvertering i parseren).
- **Ingen jobb/hobby-klassifisering i fase 1** — kveldssignalet og kategoriene gir verdi alene; klassifiseringen krever dokumentnivå-data og egen mapping-pipeline.

## Verifisering

- 7 enhetstester i `rescuetime-parser.test.ts` (gruppering per dag, kategorisummering, kveldsvindu, timefordeling, toppliste, ugyldige rader). `npm test`: 397 grønne.
- `npm run check`: 0 feil.
- Ende-til-ende-test krever API-nøkkel: `POST /api/sensors/rescuetime/setup` med `{"apiKey": "..."}`.

## Aktivering

1. Hent API-nøkkel på https://www.rescuetime.com/anapi/manage
2. Innlogget: `POST /api/sensors/rescuetime/setup` med body `{"apiKey": "<nøkkel>", "backfillDays": 30}`
3. Cron tar over derfra; signalet dukker opp i `domain_signals` etter neste `/api/cron/domain-signals`-kjøring (hvert time-kvarter).

## Fase 2 (ikke påbegynt)

Jobb/hobby-skille via vindustitler (`restrict_kind=document`, krever premium): mapping-tabell etter mønster fra merchant-kategoriseringen, med tidsheuristikk og følge-apper (Slack = jobb-markør, localhost:5174 = Resonans-utvikling) som prior. Husk filtrering av sensitive jobb-titler før lagring.
