# Tema-pager: sveipbare tema-sider på hjemskjermen

Dato: 2026-07-04
Status: ferdig

## Kontekst

Tema-sonen på hjemskjermen viste kun de seks første temaene (`themes.slice(0, 6)`) —
med mange temaer ble resten usynlige, og ferie-/prosjekt-temaer (f.eks. «Seng til Iver»,
«Hyller til guttene») okkuperte plassene til de løpende temaene. Ønske fra bruker:

1. Tema-feltet skal være sideveis sveipbart med snap, seks og seks tema per side.
2. Egne «sider» i sveipen for ferier/reiser og for prosjekter.
3. De seks første plassene (side 1) reserveres for prioriterte tema, styrt av
   sorteringen i langpress-lista.

## Faser

### Fase 1: Kind-klassifisering server-side

`src/routes/+page.server.ts` fikk `loadActiveThemes()` som klassifiserer hvert tema
i SQL: `ferie_profile`/`trip_profile` satt → `'ferie'`, `project_profile` satt →
`'prosjekt'`, ellers `'standard'`. Defensiv fallback (alle som standard) hvis
profil-kolonnene ikke er migrert — samme mønster som `loadFerieThemes`.
`Theme`-typen i `home-context.ts` fikk valgfri `kind: ThemeKind`.

### Fase 2: Side-bygger som ren logikk

Ny modul `src/lib/components/domain/home/home-theme-pages.ts`:
- `buildThemePages(themes)` — chunker standard-temaer seks og seks (global
  sorteringsrekkefølge bevart), deretter egne sider for ferie/reise og prosjekter.
- `findPriorityBoundaryId(themes)` — id-en til sjette standard-tema, brukt som
  skillelinje i sorteringslista.
- Enhetstester i `home-theme-pages.test.ts` (11 tester).

### Fase 3: Sveipbar pager i tema-sonen

`HomeThemeZone.svelte` byttet `slice(0, 6)` mot en scroll-snap-pager etter samme
mønster som widget-pageren (`overflow-x: auto` + `scroll-snap-type: x mandatory`,
`PagerDots` under). Sone-labelen er dynamisk og følger aktiv side: «Temaer»,
«Flere temaer», «Ferier & reiser», «Prosjekter». Langpress-åpning av
sorteringspanelet fungerer som før (pointercancel ved scroll avbryter timeren).

### Fase 4: Prioritert-markering i sorteringslista

`HomeOverlays.svelte` (tema-panelet): skillelinje «Vises på forsiden ↑» etter det
sjette standard-temaet, og små tags («Ferie»/«Prosjekt») på rader som ikke
konkurrerer om de prioriterte plassene. Drag-and-drop-logikken er uendret —
skillelinjen har ikke `data-theme-id` og ignoreres av `computeDropIndex`.

## Beslutninger

- **Ferie og reise deles på samme sider** (`kind: 'ferie'`): begge er tidsavgrensede
  «bobler» og skilles fra løpende temaer; egen reise-side kan splittes ut senere.
- **Prioritering = eksisterende sortering**: side 1 er de seks første standard-temaene
  i `sortOrder`. Ingen ny «pinned»-mekanikk — langpress-lista er fortsatt eneste
  sorteringsflate, og `/api/tema/reorder` er uendret (flat rekkefølge på tvers av kinds;
  relativ rekkefølge innen hver side følger den globale).
- **Ferie-/prosjekt-temaer kan ikke innta side 1** selv om de sorteres øverst — de har
  egne sider. Tags i lista kommuniserer dette.
- Kind beregnes i SQL (case-uttrykk) i stedet for å sende profil-jsonb til klienten
  (geoByDay m.m. kan bli stort).

## Verifisering

- `npm test`: 991 tester grønne (81 filer), inkl. 11 nye for side-byggeren.
- `npm run check`: 0 feil, 0 advarsler.
- Visuell regresjon (`npm run test:visual:review`) kunne ikke kjøres i agent-miljøet
  (ingen `.env`/DATABASE_URL) — hjem-baselinen må oppdateres ved neste lokale kjøring:
  `VISUAL_REVIEW_CONTEXT="Tema-sonen er nå sveipbar pager med sider for ferier og prosjekter" npm run test:visual:review`
