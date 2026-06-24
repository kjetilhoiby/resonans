# Kapplister og kant-til-kant oppgaveliste i prosjekter

Dato: 2026-06-24
Status: ferdig

## Kontekst

Et prosjekt i Resonans er et undertema av «Hjem» (`parentTheme = 'Hjem'`) og har
fanene Samtaler, Oppgaver og Filer. Brukeren ønsket tre ting:

1. Oppgavelista skulle strekke seg **kant til kant** (den var smal, sentrert til 640px),
   og det skulle gå an å **sortere om oppgaver**.
2. Kunne **legge til filer** som chatten kan lese med vision.
3. Et nytt verktøy: **kapplister** for å regne ut hvor mange lekter/bjelker eller
   plater man trenger og hva det koster — for å scope prosjektene.

Etter en avklaring ble kapplista utvidet fra «dimensjon + lengder» til en
**materiale → kapp**-modell: hvert materiale er enten en lengdevare (lekt/bjelke
med meterpris) eller en plate (med plate-pris), og kan ha flere kapp i flere mål.

Punkt 1 (sortering) og 2 fantes allerede: oppgavelista hadde dra-og-slipp-sortering
(`ThemeTasksTab`), og Filer-fanen laster opp filer som ekstraheres med GPT-4o vision
i bakgrunnen og injiseres i chat-konteksten (`ThemeFilesTab` + `ContextService`).
Hovedarbeidet ble derfor kapplister + å gjøre oppgavelista bred.

## Faser

### Fase 1: Kant-til-kant oppgaveliste
- `src/lib/components/domain/theme/ThemeTasksTab.svelte`: fjernet `max-width: 640px;
  margin: 0 auto` på `.tasks`, satt `width: 100%`. Lista bruker nå hele bredden med
  samme `var(--page-px)`-gutter som resten av appen. Sortering (dra i ⠿-håndtaket)
  var allerede på plass og er uendret.

### Fase 2: Kappliste-beregning (ren logikk, alt i mm)
- `src/lib/kappliste/calc.ts`:
  - `packLinear` — 1D First-Fit-Decreasing for lengdevarer.
  - `packSheets` — 2D hylle-heuristikk (rotasjon tillatt) for plater. Estimat for
    scoping; kan overestimere litt, men aldri underestimere grovt.
  - `layoutLinear` / `layoutSheets` — samme pakking, men returnerer plasseringene
    (hvilke kapp på hvilken lekt/plate, med koordinater) for visuell kappeplan.
  - `computeMaterial` / `computeCutList` — antall lekter/plater + kostnad + layout per
    materiale og totalt. Pluss `formatNok`, `formatMeters`.
- `src/lib/kappliste/calc.test.ts`: 19 tester (5×1200 → 2 lekter, blandede lengder,
  plate-pakking, rotasjon, layout-koordinater, for store/lange kapp, sagsnitt, kostnad).
- `src/lib/kappliste/rows.ts`: `sanitizeMaterials` for server-side validering.

### Fase 3: Datamodell + API
- `src/lib/db/schema.ts`: ny tabell `cut_lists` med `materials` JSONB-array. Hvert
  materiale: `{ id, name, kind: 'linear'|'sheet', stock*, price*, cuts: [...] }`.
  Et kapp er `{ lengthMm }` (linear) eller `{ widthMm, heightMm }` (sheet).
- `scripts/db-migrations/0023_kapplister.sql`: `CREATE TABLE IF NOT EXISTS` + indekser.
- `src/routes/api/tema/[id]/kapplister/+server.ts`: GET (list) + POST (opprett).
- `src/routes/api/tema/[id]/kapplister/[listId]/+server.ts`: PATCH (tittel, sagsnitt,
  materialer) + DELETE. Auth via `requireTheme`.

### Fase 4: UI
- `src/lib/components/domain/theme/ThemeKapplisteTab.svelte`: lager/sletter
  kapplister; legg til materialer som lengdevare eller plate; rediger stock-størrelse,
  pris og flere kapp per materiale. Viser live resultat per materiale («2 lekter à
  3,90 m (421 kr)» / «3 plater 2440×1220 (897 kr)») og totalsum. Autolagrer med
  600 ms debounce. Tema-tokens (`--tp-*`, `--card-*`), `var(--page-px)`-gutter, mørkt.
- **Visuell kappeplan** per materiale (kollapsbar): lengdevarer vises som horisontale
  stolper der hver lekt deles i segmenter per kapp + kapp til overs (skravert); plater
  vises som en målestokk-riktig plate med kappene plassert (x/y/b/h fra `layoutSheets`).
  `calc.ts` fikk `layoutLinear`/`layoutSheets` som returnerer plasseringene, og
  `MaterialResult.layout` bærer dem til UI-et.
- `ThemePage.svelte`: ny fane «📐 Kapp» for prosjekter (`isHomeProject`), wiret inn
  prop `cutLists`.
- `tema/[id]/+page.server.ts` + `+page.svelte`: laster og sender `cutLists`.

### Fase 5: Chat-kontekst
- `src/lib/server/services/context-service.ts`: ny `cutLists`-seksjon injiseres i
  chat-konteksten for prosjektet (analogt med tema-filer), så AI-en kan svare på
  «hvor mange fjøler trenger jeg / hva koster det».

## Beslutninger

- **Materiale → kapp-modell.** Et materiale er enten lengdevare (lekt/bjelke,
  meterpris) eller plate (plate-pris), og eier flere kapp i flere mål. Cross-section/
  tykkelse (48x48, 15mm) ligger i materialnavnet; stock-størrelsen er lengden per
  lekt (linear) eller platemålet (sheet).
- **Kostnadsmodell: hele lekter/plater × enhetspris.** Du betaler for hele enheter
  inkl. kapp/svinn, ikke bare brukt materiale. Avklart med bruker.
- **Antall: optimal kapping.** Lengdevarer: 1D FFD (5×1200 fra 3900 → 2 lekter,
  3 per lekt). Plater: 2D hylle-heuristikk med rotasjon — et *estimat* for scoping.
- **Alt i mm** (matcher byggvare-språk: 3900, 2440×1220, 380×420).
- **JSONB-materials** framfor egne tabeller: kapplister er små og selvstendige per
  prosjekt, så hele lista lagres/oppdateres i ett kall.

## Verifisering

- `npm run check`: 0 errors, 0 warnings.
- `npm test`: 745 tester passerer (inkl. 19 for kappliste-beregningen, med layout).
