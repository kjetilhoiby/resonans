# Knute-signalet: floker uten bevegelse

Dato: 2026-07-18
Status: ferdig (dev-verifisering gjenstår)

## Kontekst

Fullfører begrepsfamilien fra VISION («Løkker, floker og knuter»): åpne løkker og
floker fikk operative motparter i hodedump-arbeidet, men knute-nivået manglet — en
floke som blir liggende uten bevegelse er på vei til å bli knute, og det skal fanges
*før* den strammes.

## Faser

### Fase 1: Ren logikk (`src/lib/domain/observed-behavior.ts`)

- `classifyFlokeStagnation(daysSinceMovement)`: <14 dager → i_bevegelse, ≥14 →
  stillestående, ≥28 → knute_risiko (testet).
- `classifyFlokeLoad(floker)`: signal-severity styres av verste floke (testet).
- OBSERVERT ATFERD-linjen for floker utvidet: verste stillestående floke trekkes frem
  — «"Forsikringssaken" har ligget 31 dager uten bevegelse — på vei til å bli knute.»

### Fase 2: Innsamling + signal

- `collectFlokeStatus(userId)` i observed-behavior-service: hodedump-prosjekter
  (planning/active) med siste bevegelse = GREATEST(opprettet, siste steg hakket av,
  siste steg lagt til) via LEFT JOIN checklist_items på project_id.
- Ny produsent `floke_stagnation` (home): valueNumber = antall stillestående,
  valueText = verste floke, valueBool = alle i bevegelse. Null uten åpne floker.
- `collectObservedBehaviorInputs` bruker samme leser — chat-blokken og
  egenfrekvens-speilingen får stillstands-info gratis.

### Fase 3: Opprydding — `earlyWake`-stubben fjernet

`calculateEarlyWake` i aggregation.ts har alltid returnert undefined (TODO-stub) —
`metrics.earlyWake` ble aldri skrevet. Funksjonen og kallstedet er fjernet;
waketime-søvnmålet (PR #236) måler oppvåkning ordentlig fra events. Schema-feltet
og `sleep_lag`-aliaset står (harmløse).

## Beslutninger

- **Terskler 14/28 dager** — to nivåer gir coachen både et varsel («stillestående»)
  og en eskalering («på vei til å bli knute») uten å mase fra dag én.
- **Bevegelse = steg hakket av ELLER steg lagt til** — å bryte ned mer er også å
  løse rolig; kun avhaking ville straffet planlegging.
- **Kun verste floke i prompten** — én linje, ikke en liste; signalet bærer full
  kontekst for dashboards.

## Verifisering

- `npm test`: 1499 grønne (nye: classifyFlokeStagnation, classifyFlokeLoad,
  stillstands-linjen). `npm run check`: 0 feil.
- Dev: etter cron har en bruker med gammel hodedump-floke en `floke_stagnation`-rad;
  chat-blokken viser stillstands-linjen når en floke har ligget ≥14 dager.
