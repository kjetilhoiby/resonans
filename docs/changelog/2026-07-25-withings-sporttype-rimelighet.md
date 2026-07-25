# Withings sporttype-rimelighet: gåtur feilstemplet som el-sykkel

Dato: 2026-07-25
Status: ferdig

## Kontekst

En bratt gåtur (3 km med ~700 høydemeter) registrert i Ekko dukket opp som **el-sykkel**
i tre systemer samtidig: Withings, Resonans' Treningsøkter, og treningsprogram-modulen i
Ekko («Registrert: El-sykkel 1 t 20 min»). Ekko selv hadde turen korrekt som gåtur.

Feilkjeden:

1. **Withings** kjenner igjen aktiviteter på egen hånd og ga turen **kategori 272/525
   (e-bike)**. Den lave luftlinjefarten (mye høydemeter → ~4 km/t i snitt) traff
   sykkel-heuristikken. Dette er rotfeilen — den oppstår før Resonans i det hele tatt ser
   dataen.
2. **Resonans importerte etiketten ukritisk**: `getSportType(272) → 'e_bike'` uten noen
   rimelighetssjekk (`withings-sync.ts`).
3. **Ingen kryss-kilde-forsoning**: aktivitetslaget klynger økter per sportsfamilie
   (`activity-layer.ts`). `walking` og `e_bike` er ulike familier (walking vs cycling), så
   Ekkos ekte gåtur og Withings' feil-e-sykkel ble aldri sett som samme aktivitet — Resonans
   trodde brukeren både gikk *og* syklet samtidig.
4. **El-sykkelen vant synligheten**: gåturer teller ikke som utholdenhet
   (`endurance-engine.ts`), men el-sykkel gjør det, så `describeEnduranceDay()` bygde navnet
   «Registrert: El-sykkel …». Systemet flagget til og med «−28,3 km/t vs snitt siste 12 uker
   (n=22)» — det *visste* at farten var umulig, men handlet ikke på det.

## Faser

### Fase 1: Rimelighetssjekk ved Withings-import

`src/lib/server/integrations/withings-sync.ts`:

- Ny ren, eksportert funksjon `plausibleSportType(sportType, distanceMeters, durationSeconds)`
  som korrigerer sykkel-familien (`cycling`/`e_bike`) → `walking` når snittfarten er under
  en troverdig grense for sykkel.
- `MIN_PLAUSIBLE_CYCLING_SPEED_MPS = 1.95` (~7 km/t) — godt under enhver ekte sykkeltur,
  klart over rask gange. En (el-)sykkel som «beveget seg» i gangtempo finnes ikke.
- Guardet: rører aldri ikke-sykkel-sporter, og lar sporten stå når grunnlaget mangler
  (distanse < 500 m eller manglende/null varighet) så ekte turer aldri berøres.
- Koblet inn i `parseWorkoutData` slik at korreksjonen skjer ved kilden. Dermed forplanter
  den seg gratis til klynging, canonical workouts, effort og treningsprogram — og den
  korrigerte gåturen havner nå i `walking`-familien, der den smelter sammen med Ekkos
  GPS-gåtur i stedet for å bli en falsk tvilling.

### Fase 2: Tester

`src/lib/server/integrations/withings-sport-plausibility.test.ts` (9 tester): det faktiske
IMG-caset (e_bike 4980 m / 4511 s → walking), bratt gåtur som vanlig sykkel, troverdige
turer som forblir urørt, ikke-sykkel-sporter urørt, manglende grunnlag, og terskel-oppførsel
rett under/over ~7 km/t.

### Fase 3: Data-migrering for allerede lagrede økter

Fiksen i Fase 1 gjelder kun *fremtidige* synkinger. Den allerede feilstemplede økta (23. juli)
og evt. tidligere lå fortsatt som el-sykkel i `sensor_events`. Lagt til en idempotent
`DATA_MIGRATIONS`-statement i `scripts/sync-db-schema.mjs` som etterlikner
`plausibleSportType()` på lagrede Withings-økter:

```sql
UPDATE sensor_events
SET data = jsonb_set(data, '{sportType}', '"walking"')
WHERE metadata->>'source' = 'withings_sync_workout'
  AND data->>'sportType' IN ('cycling', 'e_bike')
  AND jsonb_typeof(data->'distance') = 'number'
  AND jsonb_typeof(data->'duration') = 'number'
  AND (data->>'distance')::numeric >= 500
  AND (data->>'duration')::numeric > 0
  AND (data->>'distance')::numeric / (data->>'duration')::numeric < 1.95
```

Idempotent: etter kjøring er `sportType='walking'` og raden matcher ikke lenger. Kjøres på
deploy via `buildCommand` (`sync-db-schema.mjs`). `canonical_workouts`/`workout_daily_aggregates`
er avledede projeksjoner med soft/hard-stale på 2/15 min, så de rebygges automatisk fra de
korrigerte `sensor_events` ved neste lesing — den korrigerte økta havner da i walking-familien
og smelter sammen med Ekko-gåturen.

## Beslutninger

- **Fiks ved kilden, ikke i visningen.** Å korrigere sporttypen ved Withings-import er
  billigst: alt nedstrøms arver rettelsen, og familie-sammensmeltingen med Ekko-gåturen
  faller ut som en gratis bivirkning.
- **Kun nedgradering sykkel → gange.** Konservativt: vi hever aldri en sport, og terskelen
  (~7 km/t) ligger så lavt at reelle sykkelturer — også tunge grus/terreng-klatringer —
  aldri treffes.
- **Reklassifiserer til `walking`, ikke `hiking`.** Matcher Ekkos egen etikett og lander i
  samme `walking`-familie, som er det som får de to kildene til å smelte sammen. (`hiking`
  er også walking-familie, men gir ikke «Gåtur»-tittel nedstrøms.)

## Verifisering

- `npm test`: 1713 tester grønne (inkl. 9 nye).
- `svelte-check`: 0 feil / 0 advarsler.
