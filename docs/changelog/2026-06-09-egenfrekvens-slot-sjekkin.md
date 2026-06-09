# Egenfrekvens slot-sjekkin: «Hvordan gikk …?» ved app-åpning

Dato: 2026-06-09
Status: ferdig

## Kontekst

Egenfrekvens-registrering trengte lavere terskel (jf. brukeraudit juni 2026: økonomi/egenfrekvens
trenger aktivering, ikke flere features). Nytt konsept: i stedet for et prompt-banner på hjemskjermen
får brukeren et fullskjerm-spørsmål direkte når appen åpnes, knyttet til tid på døgnet:

| Vindu | Slot | Spørsmål |
|-------|------|----------|
| 05:00–07:30 | `natt` | Hvordan gikk natta? |
| 07:30–12:00 | `morgen` | Hvordan gikk morgenen? |
| 14:00–18:00 | `arbeidsdag` | Hvordan gikk arbeidsdagen? |
| 18:00–20:00 | `ettermiddag` | Hvordan gikk ettermiddagen? |
| 20:00–24:00 | `kveld` | Hvordan gikk kvelden? |

Hullene (00–05, 12–14) har bevisst ingen sjekkin. Visningen er to steg i samme fullskjerm-layout
(FlowSheet focus-modus) som egenfrekvens_quick: steg 1 slider (1–5, auto-avanserer når den slippes),
steg 2 valgfri setning med «Fortsett i chat»-knapp. Chat-knappen lagrer sjekkinnen og sender
«[Tid på døgnet] gikk [1–5], [setning]» som brukerens første melding i hjemchatten.
Vises bare hvis slottet hverken er registrert eller dismisset for dagen. Dismiss (X) legger i stedet
en chip «✨ Hvordan gikk …?» i handlingssonen på hjemskjermen som åpner fullskjermen igjen; den
forsvinner når slottet registreres. Den gamle server-produserte «Sjekk inn · morgen/kveld»-chipen
(`sjekkInnProducer`) er fjernet — slot-konseptet eier nå sjekk inn-flaten på hjemskjermen.

## Faser

### Fase 1: Domenemodul
- `src/lib/domains/egenfrekvens/period-slots.ts` — slot-definisjoner, `getActivePeriodSlot()`,
  `PERIOD_SLOT_GROUP` (mapper periode-slots inn i morning/evening for eksisterende visninger),
  `localIsoDay()`, `periodSlotStorageKey()`. Enhetstester i `period-slots.test.ts`.

### Fase 2: Server
- `egenfrekvens-checkin.ts`: `EgenfrekvensSlot` utvidet med periode-slots; `validateSlot` godtar dem;
  status fikk `slots`-map (nyeste entry pr. rå slot-verdi) og periode-slots grupperes inn i
  morning/evening-feltene.
- `egenfrekvens-dashboard.ts`: samme gruppering i sparkline-bucketing.
- `api/egenfrekvens/checkin`: `parseSlot` godtar periode-slots.

### Fase 3: Klient
- `src/lib/flows/egenfrekvens-slot.ts`: `buildEgenfrekvensSlotFlow(slot)` — flow-fabrikk (tittelen er
  spørsmålet, derfor ingen statisk FLOWS-entry; `FlowId` fikk 'egenfrekvens_slot' og FLOWS typen
  `Exclude`-er den).
- `HomeScreen.svelte`: onMount sjekker aktivt slot → localStorage-dismiss → server-status → åpner
  fullskjerm. Hoppes over ved `navigator.webdriver` (deterministiske visuelle tester) og når
  `?flow=`/`?chat=1` allerede styrer åpningen.
- `HomeOverlays.svelte`: rendrer FlowSheet; «Fortsett i chat» lagrer sjekkinnen og sender
  kontekstmelding inn i hjemchatten via `startHomeChat`.

### Fase 4: Dashboard (2026-06-10)
- `EgenfrekvensDashboard.svelte` bygget om fra dimensjons-visning (tanker/følelser/handlinger)
  til slot-visning: dagens slot-stripe i siste-kortet, «Døgnrytme»-grid (dager × 5 slots,
  nivåfargede celler med notat i tooltip), snitt-nivå pr. slot, og notat i stedet for T/F/H
  i siste sjekkins-lista. Trend-sparkline beholdt som én samlet dagslinje.
- `egenfrekvens-dashboard.ts`: hvert dagspunkt fikk `slots` (nyeste registrering pr.
  periode-slot) og stats fikk `avgLevelBySlot`. Historiske morning/evening-events vises som
  morgen/kveld via ny `displayPeriodSlotFor()` i period-slots.ts (testet). Gamle felt
  (morning/evening/thoughts/feelings/actions) beholdt i API-et for andre konsumenter.
- `dashboard-cache.ts`: klienttypene utvidet tilsvarende (valgfrie felt — cachede payloads
  uten `slots` rendrer fortsatt).

### Fase 5: Opprydding
- Gammelt app-open prompt-banner fjernet: `EgenfrekvensPrompt.svelte`, `/api/egenfrekvens/status`,
  `egenfrekvensPromptOpen/Day`-state og HomeTitleZone-blokken. Quick/full-flytene og nudge-URLene
  (`?flow=egenfrekvens_quick&slot=…`) er uendret.

## Beslutninger

- **Lagring**: gjenbruker `sensor_events` med `dataType: 'egenfrekvens_checkin'`, `mode: 'quick'` og
  ny slot-verdi i `data.slot` — ingen schema-endring nødvendig.
- **Gruppering**: natt/morgen → morning, arbeidsdag/ettermiddag/kveld → evening, så eksisterende
  sparklines, dagsbaseline og mood-speiling fortsetter å virke.
- **Dismiss**: localStorage per dag+slot (`egenfrekvens-slot-<dag>-<slot>`) med verdiene
  `dismissed` (→ chip på hjemskjermen) og `done` (→ skjul alt), ikke DB — dismiss er
  enhetslokalt og lavkost; registrert-sjekken er server-side via `status.slots`.
- **Dag**: lokal dato (`localIsoDay`), ikke UTC — slottene følger brukerens klokke.
- **Kun ren app-åpning**: fullskjermen trigges bare på `/` uten query-params. Alle push-lenker og
  deep-links har params (nudgeTrack, cycle, flow, …) og slipper unna; apparat-ferdig-pushen som
  før lenket til ren `/` lenker nå til `/apparat?cycle=…` (eller `/?ref=push` uten cycle_id).
- **Gate i stedet for ventetid**: de synkrone sjekkene (tidsvindu + localStorage) avgjøres ved
  hydrering og rendrer et fullskjerm-teppe (`slot-gate`, samme bakgrunn som focus-sheeten, pulserende
  app-logo) umiddelbart. Server-avklaringen (registrert via annen flate?) kjører først i onMount —
  før resten av hjemlastingen, med 5s timeout — og enten åpner sjekkinnen sømløst over teppet eller
  fader teppet bort til hjemskjermen. Feil/timeout faller åpent tilbake til hjemskjermen.

## Verifisering

- `npm test` (334 tester, inkl. nye period-slots-tester) og `npm run check` grønne.
- Manuell Playwright-kjøring mot dev (med webdriver-guard overstyrt): fullskjerm åpnet 22:25 med
  «Hvordan gikk kvelden?», slider+setning lagret korrekt (`slots.kveld` i status, gruppert til
  evening), og visningen kom ikke tilbake etter reload. Testdata slettet etterpå.
- Piksel-diff-testene feilet før denne endringen også (baselines er eldre enn commitene
  transitions/designsystem/skeletons/prikk) — verifisert ved å kjøre hjem-testen på HEAD uten
  disse endringene.
