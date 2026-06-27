# Pågående ferie: snarveier og dagbok-hurtighandling

Dato: 2026-06-27
Status: ferdig

## Kontekst

Når en ferie er i gang, gikk ferie-temaet alltid til planleggingen («Rammer»,
steg 1 av 3) selv om brukeren var midt i ferien. Det var heller ingen enkel vei
inn til den pågående ferien fra hjemskjermen eller ukeplanen, og ingen rask måte
å skrive dagens feriedagbok på.

Ønsker fra bruker:
1. Ferie-ikon ved datoen på hjemskjermen under pågående ferie, for rask tilgang.
2. Det samme på dags-/ukeplanen.
3. Hopp rett til gjennomføringsfasen når ferien er i gang.
4. «Skriv feriedagbok» som hurtighandling når dagens notat ikke er gjort.

## Faser

### Fase 1: Delt «pågående ferie»-logikk

Ny ren modul `src/lib/ferie/active-ferie.ts`:
- `isFerieActiveOn(profile, iso)` — dekker vinduet datoen?
- `ferieOverlaps(profile, fromIso, toIso)` — overlapper vinduet et intervall (uke)?
- `activeFerieThemes(themes, fromIso, toIso)` — ferie-temaer (gjenkjent via
  `resolveThemeDashboardKind`) med overlappende vindu, med emoji-fallback `🏖️`
  og vindusdatoer for dag-merking.

Enhetstester i `active-ferie.test.ts` (11 tester).

### Fase 2: Hopp rett til «Underveis» + dagbok-deeplink

`FerieDashboard.svelte`:
- Startvisning settes til `gjennomfor` når dagens dato er innenfor ferievinduet,
  ellers `rammer` som før.
- Fasen «3 · Gjennomfør» fikk nytt navn **«3 · Underveis»** (leses mer naturlig
  mens man er i ferien). Intern view-id `gjennomfor` er uendret.
- Leser `?feriedagbok=idag` fra URL og sender `autoOpenDiary` videre.

`FerieExecutionView.svelte`:
- Ny prop `autoOpenDiary` — åpner dagbok-skjemaet for i dag etter at innleggene
  er lastet (brukes av hurtighandlingen fra hjemskjermen).

### Fase 3: Ferie-ikon + hurtighandling på hjemskjermen

`src/routes/+page.server.ts`:
- `loadFerieThemes` (defensiv mot manglende `ferie_profile`-kolonne).
- `activeFerie` = ferie-temaer aktive i dag.
- `feriedagbokTodo` = første pågående ferie der dagens dagboknotat
  (`reflections.kind = 'feriedagbok'`, `periodKey = i dag`) mangler.

`HomeTitleZone.svelte`: ferie-emoji som lenke (`/tema/{id}?tab=data`) ved siden
av tittelen/datoen, én per pågående ferie.

`HomeScreen.svelte`: ny handlings-chip «Skriv feriedagbok» (priori­tet 98) når
`feriedagbokTodo` finnes — navigerer til `/tema/{id}?tab=data&feriedagbok=idag`.

### Fase 4: Ferie-ikon på ukeplanen

`src/routes/ukeplan/+page.server.ts`: `loadFerieThemes` + `activeFerie`
(overlapper uka), returnert ved siden av `activeTrips`.

`ukeplan/+page.svelte`:
- Ferie-ikon i toppen (samme mønster som reise-ikonene), lenker til
  `/tema/{id}?tab=data`.
- Ferie-dager merkes i dag-knappene via `tripDayEmoji`-kartet; reiser (mer
  spesifikke) vinner når både reise og ferie dekker samme dag.

## Beslutninger

- **Gjenbrukte `resolveThemeDashboardKind`** for å avgjøre hva som er et
  ferie-tema, i stedet for å duplisere navnematching.
- **Deeplink i stedet for prop-drilling**: hurtighandlingen sender
  `?feriedagbok=idag`, som `FerieDashboard` plukker opp via `$page`. Unngår å
  tråkle ekstra props gjennom tema-side → `ThemeDataTab` → `FerieDashboard`.
- **Dag-merking gjenbruker `tripDayEmoji`** på ukeplanen for å holde
  `DaySection` uendret; reiser prioriteres foran ferie ved overlapp.
- **«Underveis»** valgt som nytt fasenavn (forslag — enkelt å endre i
  view-switch-en i `FerieDashboard.svelte`).

## Verifisering

- `npm test` — 833 tester grønne (inkl. 11 nye for `active-ferie`).
- `npm run check` — 0 feil, 0 advarsler.
- Visuell regresjon ikke kjørt: de nye elementene vises kun ved pågående ferie,
  og baseline-fixturene har ingen aktiv ferie, så hjem/ukeplan-baselinene endres
  ikke.
