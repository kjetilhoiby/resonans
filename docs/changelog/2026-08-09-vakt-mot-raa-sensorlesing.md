# Vakt mot rå lesing av sensor_events

Dato: 2026-08-09
Status: ferdig

## Kontekst

Tredje runde etter `2026-08-08-widget-loepedistanse-dobbelttelling.md` og
`2026-08-08-ivrig-autohaking.md`. Spørsmålet som utløste den:

> «Vi har ofte trøbbel med at ikke alt går gjennom canonical. Er det for mye jobb
> å bygge ut et helt lag som er spørrelaget for alt?»

Måling av kodebasen først:

- 130 filer rører `sensor_events`, fordelt på 38 `data_type`-verdier.
- Variansen er konsentrert: **workout, weight, sleep, bank_transaction** står for
  ~72 av lesestedene. De øvrige 34 typene har stort sett én skriver og én leser.
- **17 filer leser vekt-events. 2 av dem bruker `normalizeBodyComposition`** —
  regelen CLAUDE.md beskriver som «les alltid gjennom».

Det siste er diagnosen. Laget mangler ikke: `activity-layer`,
`normalizeBodyComposition`, `nightKeyForTime`/`isNapSleepEvent` og
`categorized_events` finnes alle og er gjennomtenkte. 2 av 17 er ikke et
designproblem, det er et håndhevingsproblem — og et nytt lag på toppen ville
arvet samme etterlevelse.

Derfor: ingen ny abstraksjon. En vakt.

## Faser

### Fase 1: Ren matcher

`src/lib/server/sensor-event-access.ts`:

- `readsRawDataType(source, dataType)` finner både rå SQL (`data_type = '…'`,
  `data_type IN (…)`) og query-builderen (`eq(sensorEvents.dataType, '…')`,
  `inArray(sensorEvents.dataType, […])`).
- **Skriving treffes ikke.** `dataType: 'workout'` bruker kolon, og en sensor som
  skriver sin egen rad har ingen sammenslåing å gjøre.

### Fase 2: Skrallen

`GUARDED_DATA_TYPES` med `workout`, `weight` og `sleep`. Hver bærer `use` (hva en
ny leser skal bruke), `why` (hvorfor rå lesing er farlig for akkurat den typen)
og `knownRawReaders` — dagens lesere, frosset.

`sensor-event-access.test.ts` går over `src/` og feiler på to ting:

1. **En fil som ikke står på lista leser rått.** Feilmeldingen navngir fila, sier
   hvilken leser den skal bruke, hvorfor, og hvordan man legger seg til på lista
   hvis rå lesing faktisk er riktig.
2. **En fil står på lista uten å lese rått lenger.** Skrallen skal krympe: ryddes
   en fil opp eller slettes, må den ut av lista.

## Beslutninger

- **Skralle, ikke opprydding.** Lista er dagens 42 lesere, ikke et krav om at de
  fikses nå. Den fryser gjelden og blokkerer vekst — og gjør gjelden lesbar:
  hver oppføring har en kommentar som sier om den er legitim (én rad hentet på
  id, en skrivesti, en per-kilde-visning) eller gjeld.
- **Ikke et universelt spørrelag.** For 34 av 38 typer ville det blitt rene
  gjennomstikk, og et lag som er 80 % seremoni lærer folk at det er valgfritt —
  som er nøyaktig hvordan man går utenom det på de 20 % som betyr noe. Man ender
  med en dårligere Drizzle med svakere typer.
- **Vakten peker på lesere, ikke på projeksjonstabeller.** `canonical_workouts`
  er grunnen til at widgeten leser live: projeksjonen dekker bare perioder en
  jobb har rukket, og sweeperen kjører bare for brukere med et aktivt løpemål.
  En funksjon som regner live er alltid riktig og krever ingen jobb.
- **`bank_transaction` er ikke med ennå.** 29 lesesteder og en egen
  `categorized_events`-sti gjør den til en større vurdering enn de tre andre;
  den fortjener sin egen runde framfor en allowlist skrevet i blinde.

## Funn underveis

`lib/server/nutrition/expenditure.ts` summerer Withings' egne økt-kalorier over
rå rader. Det dobbeltteller ikke i dag — bare Withings-radene har feltet — men
det gjør det den dagen en annen kilde begynner å sende `calories`. Notert i
allowlisten framfor å endres nå.

## Verifisering

- 10 tester: 4 på matcheren (rå SQL, query-builder, at skriving ikke treffes,
  at datatypene skilles) og 2 per vaktet type.
- Skrallen er **prøvd med en ekte overtredelse**: en midlertidig fil som leste
  `dataType, 'workout'` fikk testen til å feile med filnavn og anvisning, og
  grønn igjen da fila ble slettet. En vakt som ikke kan feile er pynt.
- `npm test`: 2852 tester grønne (216 filer). `npm run check`: 0 feil.
