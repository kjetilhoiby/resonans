# Robust cron-dispatch + retting av falske helsesjekk-varsler

Dato: 2026-06-24
Status: ferdig

## Kontekst

Den kveldlige helsesjekken (`/api/cron/monitoring`, 19:30 Oslo) sendte et
Google Chat-varsel med fire «Cron mangler», men varselets egen
`CRON EXECUTIONS (24t)`-liste viste at tre av jobbene kjørte helt fint:

| Jobb | Flagget som | Faktisk siste 24t |
|------|-------------|-------------------|
| withings-sync | ❌ mangler (sist 18:54) | 21 kjøringer, 21 OK |
| background-jobs | ❌ mangler (sist 18:54) | 28 kjøringer, 28 OK |
| dropbox-sync | ❌ mangler (sist 18:54) | 29 kjøringer, 29 OK |
| aggregate | ❌ mangler (sist 8. juni) | (kjørte ikke — ekte feil) |

To separate rotårsaker:

1. **Falske varsler fra for stramme terskler.** `checkCronExecutionHealth`
   i `monitoring-service.ts` hadde hardkodede terskler som hadde drevet fra
   de faktiske schedulene. De tre 5-minutters-jobbene hadde 30-min terskel —
   en helt vanlig GitHub Actions-forsinkelse (de stoppet 18:54, sjekken kjørte
   19:33 = 39 min) trigget alarm. Verre: `aggregate` kjører daglig (24t), men
   hadde 12t terskel — den ble flagget *hver eneste dag* uansett, fordi den
   ved sjekketidspunktet alltid er >12t gammel.

2. **`aggregate` ble faktisk hoppet over.** Schedulet `0 0 * * *` matcher kun
   ett enkelt minutt (midnatt UTC — det mest overbelastede cron-slotet på
   GitHub). Dispatcheren lette bare 8 minutter bakover etter et matchende slot,
   så når GitHub Actions var forsinket mer enn det, ble jobben hoppet helt over.
   `*/5`-jobber treffer alltid innenfor vinduet; enkeltminutt-jobber er sårbare.
   Resultat: aggregate hadde ikke kjørt siden 8. juni.

## Faser

### Fase 1: Delt, testbar cron-logikk

Ny modul `src/lib/server/cron-schedule.ts` med ren logikk:
- `cronMatches(expr, date)` — 5-felt cron-matching (UTC)
- `mostRecentMatch(expr, now, lookbackMs)` — nyeste matchende slot i vinduet
- `isDue(expr, now, lastRunAt, lookbackMs)` — due hvis et slot i vinduet ikke
  allerede er kjørt (dedup mot siste faktiske kjøring)
- `DISPATCH_LOOKBACK_MS = 60 min`

12 enhetstester i `cron-schedule.test.ts` dekker tidsvindu, forsinket dispatch
og dedup (ingen dobbeltkjøring av `*/5`, ingen tapt daglig jobb).

### Fase 2: Server-side due-beregning

`/api/cron/jobs?due=1` beregner nå hvilke jobber som skal kjøre, mot
`cron_executions` for dedup. Et romslig 60-min oppslagsvindu sørger for at en
forsinket dispatch fortsatt fanger daglige jobber, mens dedup hindrer at
høyfrekvente jobber kjøres flere ganger for samme slot. Uten parameter
returnerer endepunktet fortsatt hele jobblisten (uendret).

`aggregate` flyttet fra `0 0 * * *` → `0 3 * * *` (05:00 Oslo) for å komme
unna det overbelastede midnatt-UTC-slotet — belte-og-bukseseler sammen med det
bredere vinduet.

### Fase 3: Forenklet dispatcher

`.github/workflows/cron.yml` henter nå bare due-jobbene fra
`/api/cron/jobs?due=1` og kjører dem. All cron-parsing er fjernet fra
workflow-scriptet — logikken er enkilde-sannhet i `cron-schedule.ts` og
dekkes av enhetstester (workflow-scriptet kan ikke testes av vitest).

### Fase 4: Rettede monitorerings-terskler

`checkCronExecutionHealth` har nå terskler med romslig buffer over faktisk
kadens: 5-min-jobber → 60 min, sparebank1 (6t) → 14t, aggregate (daglig) →
28t. Kommentar forklarer at terskelen alltid må være større enn kadensen.

## Beslutninger

- **Server-side due-beregning fremfor duplisert logikk i YAML.** Workflow-scriptet
  er innebygd i YAML og kan ikke importere/teste repo-kode. Ved å flytte
  beslutningen til appen får vi én testbar kilde til sannhet.
- **Dedup mot `cron_executions` (uavhengig av status).** En allerede-kjørt eller
  nettopp-feilet jobb trigges ikke på nytt før neste slot — unngår hamring ved
  feil, og dobbeltkjøring ved bredt oppslagsvindu.
- **Terskel > kadens som invariant.** Den opprinnelige buggen var at terskelen
  var mindre enn kadensen. Kommentarene gjør kravet eksplisitt.

## Verifisering

- `npm test` — 738 tester grønt (inkl. 12 nye i `cron-schedule.test.ts`).
- `npm run check` — 0 feil, 0 advarsler.
- Manuell gjennomgang av dispatch-scenarier: forsinket midnatt-dispatch fanger
  fortsatt daglig jobb; `*/5`-jobb kjøres én gang per slot uten duplikat.
