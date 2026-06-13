# Ukedag-aware periode-slots (helg/helligdag)

Dato: 2026-06-13
Status: ferdig

## Kontekst

«Hvordan gikk …?»-sjekkinnene (periode-slots) brukte ett fast tidsskjema for
alle dager. En bruker fikk derfor spørsmålet **«Hvordan gikk arbeidsdagen?»** kl.
16:46 på en lørdag — meningsløst på en fridag.

To ting trengtes:

1. Skjemaet må være ukedag-aware: arbeidsdag-begrepet hører til hverdager, og
   helger/norske helligdager skal ha en roligere rytme med ett generelt
   «dag»-spørsmål. Helligdager fanges via den samme `date-holidays`-modulen som
   lønnsprofilen allerede bruker for å flytte lønn til virkedager.
2. Tidene på fridager ligger senere på døgnet (man sover lenger, kvelden er
   kortere).

## Faser

### Fase 1: Delt helgedagsmodul

`src/lib/server/norwegian-holidays.ts` (ny): samler `isNorwegianHoliday`,
`isWeekend`, `isNonWorkingDay` og `isNonWorkingIsoDay` på ett sted, bygget på
`date-holidays` (`'NO'`, kun `type === 'public'`).

`salary-profile.ts` brukte tidligere sin egen private `isNorwegianHoliday`. Den
er nå fjernet derfra og importeres fra den delte modulen (DRY). Lønnslogikkens
egne UTC-baserte `isWeekend`/`isNonWorkingDay` beholdes uendret — paydays regnes
mot UTC-datoer.

### Fase 2: To slot-skjemaer

`src/lib/domains/egenfrekvens/period-slots.ts` deler nå slottene i to skjemaer:

| Skjema | Slots og vinduer |
|--------|------------------|
| `WORKDAY_SLOTS` (hverdag) | natt 05–07:30 · morgen 07:30–12 · (lunsj-hull) · arbeidsdag 14–18 · ettermiddag 18–20 · kveld 20–24 |
| `WEEKEND_SLOTS` (helg/helligdag) | natt 05–07 · morgen 07–10 · dag 10–19 · kveld 19–23 |

Nytt slot `dag` («Hvordan gikk dagen?») erstatter arbeidsdag+ettermiddag på
fridager. `PeriodSlotId` utvidet med `'dag'`; metadata samlet i én `SLOT_META`,
og `PERIOD_SLOTS` er nå en visningskatalog (alle 6 slots i kronologisk
rekkefølge) brukt av dashboards.

`getActivePeriodSlot(now, nonWorkingDay?)` tar nå et valgfritt
`nonWorkingDay`-flagg. Utelates det, utledes helg fra ukedag klientside
(`isWeekendDay`) — nok til den synkrone gate-dekkingen før serveren svarer.

### Fase 3: Holiday-aware klientvalg

`GET /api/egenfrekvens/checkin` returnerer nå `isNonWorkingDay` for den
forespurte dagen (via `isNonWorkingIsoDay`). `HomeScreen.svelte` henter status
*før* slottet beregnes, og sender flagget inn i `getActivePeriodSlot` — slik at
helligdager på hverdager også får helg-skjemaet.

### Fase 4: Dashboard

`EgenfrekvensDashboard.svelte` viser nå 6 slot-kolonner (inkl. `dag`).
Kolonneantallet er gjort dynamisk via CSS-variabelen `--ef-slot-count` (satt fra
`PERIOD_SLOTS.length`) i stedet for hardkodet `repeat(5, …)`.

## Beslutninger

- **Gjenbruk `date-holidays`** framfor en egen helligdag-kalkulator — brukeren
  ba eksplisitt om «den helgedagsmodulen vi dro inn».
- **`isNonWorkingDay` avgjøres serverside** og sendes til klienten, fordi
  `date-holidays` er en server-pakke vi ikke vil bunte inn i klienten. Den
  synkrone gate-dekkingen bruker en billig helg-sjekk klientside; på en
  helligdag-hverdag kan gaten kort vise logoen før riktig slot avgjøres etter
  fetch (kun ved første åpning, akseptert).
- **Eget `dag`-slot** framfor å gjenbruke `arbeidsdag` med annen tekst — holder
  historikk/dashboard rene (arbeidsdag = hverdag, dag = fridag).

## Verifisering

- `npm test`: 531 tester passerer. Oppdatert `period-slots.test.ts` (hverdag- vs
  helg-skjema, eksplisitt `nonWorkingDay`, `isWeekendDay`) og ny
  `norwegian-holidays.test.ts` (17. mai, helg, ISO-parsing).
- `npm run check`: 0 feil, 0 advarsler.
- Visuell regresjon (`test:visual`) ikke kjørt: krever dev-server med
  `DATABASE_URL`, som ikke var tilgjengelig i utviklingsmiljøet. Dashboard-griden
  bør få oppdatert baseline ved neste kjøring (5 → 6 kolonner).
