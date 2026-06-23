# Ferieoppgaver som hurtigvalgstripe

Dato: 2026-06-23
Status: ferdig

## Kontekst

«Gjennomfør»-fanen i ferieplanen (`FerieExecutionView`) viste oppgaver som en
vertikal liste med fullbredde-knapper. Ønsket var samme hurtigvalgstripe som på
forsiden (horisontale pills), brukt som oppgavestripe på toppen — og mulighet
til å avvise påminnelsen om udekkede barn-dager.

## Faser

### Fase 1: Dismissbare pills i den delte stripa
`ActionPillRow` (hurtigvalgstripa på forsiden) fikk additiv støtte for avvisning:
- `action-pill-types.ts`: `dismissable?: boolean` på `ActionPillItem`.
- `ActionPillRow.svelte`: ny valgfri `onItemDismiss`-prop. Når et element er
  `dismissable` og callbacken er satt, rendres pillen med en ×-knapp (egen knapp
  ved siden av hovedknappen — ingen nøstede knapper). Forsiden setter ingen av
  delene, så dens markup/rendering er uendret.

### Fase 2: Oppgavestripe i ferieplanen
- `FerieExecutionView.svelte`: oppgavelista byttet ut med `ActionPillRow`.
  Oppgaver mappes til pills med ikon (✍️ dagbok, 🧳 reise, ⚠️ gap). Klikk gjør
  samme navigasjon som før; ×-knappen på gap-pillen avviser den.

### Fase 3: Persistert avvisning av udekkede barn-dager
- `FerieProfile.gapAckCount` (+ i `FerieProfilePayload`): antall udekkede
  barn-dager brukeren har avvist.
- `ferie/+server.ts`: `gapAckCount` lagt til i felt-merge-whitelisten.
- `FerieDashboard.svelte`: holder `gapAckCount`, lagrer det, og sender
  `onDismissGap` (setter `gapAckCount = gapCount` og lagrer).
- Gap-påminnelsen vises kun når `gapCount > 0 && gapCount !== gapAckCount` — så
  den dukker opp igjen hvis antallet udekkede dager endrer seg.

### Fase 4: Kartfortelling-inngang i stripa
Ferie-visningen fikk sin egen kartfortelling (samme `TripMapStory` som
reise-temaet), matet av feriedagbokas steder, med en inngang fra stripa:
- `FerieExecutionView.saveDiaryEntry`: geokoder stedet ved lagring og lagrer
  `geo` på notatet (som `TripDiary` allerede gjorde) — slik får feriedagene
  kart-nåler.
- `TripApi.getTripProfile` (ny): henter reiseprofilen, brukt til å laste
  bilde-nåler (`imagePins`) og `geoByDay` inn i ferie-kartet.
- `FerieExecutionView`: monterer `TripMapStory`, og legger en «🗺️
  Kartfortelling»-pill sist i oppgavestripa når det finnes stedfestede dager
  eller bilde-nåler. Pillen scroller til kartet.

## Beslutninger

- **Utvidet `ActionPillRow` additivt** i stedet for å duplisere pill-stilen, slik
  at forsiden og ferieplanen deler komponent (prinsipp 2). Endringen er
  bakoverkompatibel og rører ikke forsidens rendering.
- **`gapAckCount` framfor en ren boolean:** lar påminnelsen komme tilbake når
  dekningsbildet endrer seg, i stedet for å skjules permanent.

## Verifisering

- `npm run check`: 0 feil, 0 advarsler.
- `npm test`: 692 tester passerer.
- Forsidens hurtigvalgstripe er uendret (ingen `dismissable`-elementer der), så
  piksel-diff for hjem-siden påvirkes ikke.
