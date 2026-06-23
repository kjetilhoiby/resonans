# Dagsprogram-paginering

Dato: 2026-06-23
Status: ferdig

## Kontekst

«Dag-for-dag»-lista (Dagsprogram) i ferie-temaet rendret hver eneste dag fra
feriestart til -slutt. For lange ferier ble lista uoversiktlig, og brukeren må
som regel forholde seg til dagene rundt «i dag» – ikke uker med passerte eller
fjerne dager.

## Faser

### Fase 1: Paginering rundt i dag

`src/lib/components/domain/TripDayCalendar.svelte`:

- Viser som standard maks 5 dager i fortiden og 10 i fremtiden, med «i dag»
  alltid synlig i midten.
- «↑ Vis tidligere (N)» øverst og «↓ Vis senere (N)» nederst avslører flere
  dager i batcher (5 fortid / 10 fremtid per klikk). Knappene viser hvor mange
  dager som gjenstår og skjules når alt er synlig.
- Synlige dager beregnes via `$derived` (`pastDays` / `futureDays` /
  `todayDay`); checklists lastes fortsatt for hele perioden i `onMount`, så
  ekspandering ikke trigger nye kall.
- Knappene har `data-track="ferie-dagsprogram:vis-tidligere|vis-senere"` siden
  teksten er dynamisk.

## Beslutninger

- «I dag» regnes verken som fortid eller fremtid og vises alltid når den ligger
  i ferievinduet. Ligger i dag utenfor vinduet (ferie helt i fortid/fremtid),
  faller lista naturlig tilbake til siste 5 / første 10 dager.

## Verifisering

Manuell gjennomgang av komponentlogikk. `npm run check` kunne ikke kjøres i
dette miljøet pga. manglende nettverkstilgang til npm-registeret.
