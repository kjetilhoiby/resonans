# Kapplister og kant-til-kant oppgaveliste i prosjekter

Dato: 2026-06-24
Status: ferdig

## Kontekst

Et prosjekt i Resonans er et undertema av «Hjem» (`parentTheme = 'Hjem'`) og har
fanene Samtaler, Oppgaver og Filer. Brukeren ønsket tre ting:

1. Oppgavelista skulle strekke seg **kant til kant** (den var smal, sentrert til 640px),
   og det skulle gå an å **sortere om oppgaver**.
2. Kunne **legge til filer** som chatten kan lese med vision.
3. Et nytt verktøy: **kapplister** for å regne ut hvor mange hele fjøler (f.eks.
   3,90 m) av en dimensjon man trenger for å kappe ønskede lengder, og hva det koster.

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

### Fase 2: Kappliste-beregning (ren logikk)
- `src/lib/kappliste/calc.ts`: `packBoards` (First-Fit-Decreasing bin-packing med
  valgfritt sagsnitt) og `computeCutList` (grupperer rader per dimensjon, pakker
  biter på fjøler, priser hele fjøler). Pluss `normalizeDimension`, `formatNok`,
  `formatMeters`.
- `src/lib/kappliste/calc.test.ts`: 15 tester (eksempelet 5×120 → 2 fjøler, blandede
  lengder, flere dimensjoner, for lange biter, sagsnitt, normalisering, kostnad).
- `src/lib/kappliste/rows.ts`: `sanitizeRows` for server-side validering av input.

### Fase 3: Datamodell + API
- `src/lib/db/schema.ts`: ny tabell `cut_lists` (én rad per kappliste, radene ligger
  i en `rows` JSONB-array: `{dimension, lengthCm, quantity, meterPriceNok}`).
- `scripts/db-migrations/0023_kapplister.sql`: `CREATE TABLE IF NOT EXISTS` + indekser.
- `src/routes/api/tema/[id]/kapplister/+server.ts`: GET (list) + POST (opprett).
- `src/routes/api/tema/[id]/kapplister/[listId]/+server.ts`: PATCH (lagre tittel,
  fjøllengde, sagsnitt, rader) + DELETE. Auth via `requireTheme`.

### Fase 4: UI
- `src/lib/components/domain/theme/ThemeKapplisteTab.svelte`: lager/sletter
  kapplister, redigerer fjøllengde og rader (dimensjon, lengde, antall, meterpris),
  viser live resultat per dimensjon («48x48 — 2 fjøler (421 kr)») og totalsum.
  Autolagrer med 600 ms debounce. Bruker tema-tokens (`--tp-*`, `--card-*`) og
  `var(--page-px)`-gutter, alt mørkt.
- `ThemePage.svelte`: ny fane «📐 Kapp» for prosjekter (`isHomeProject`), wiret inn
  prop `cutLists`.
- `tema/[id]/+page.server.ts` + `+page.svelte`: laster og sender `cutLists`.

### Fase 5: Chat-kontekst
- `src/lib/server/services/context-service.ts`: ny `cutLists`-seksjon injiseres i
  chat-konteksten for prosjektet (analogt med tema-filer), så AI-en kan svare på
  «hvor mange fjøler trenger jeg / hva koster det».

## Beslutninger

- **Kostnadsmodell: hele fjøler × meterpris.** Du betaler for hele fjøler du må
  kjøpe (inkl. kapp/svinn), ikke bare brukt lengde. Avklart med bruker.
- **Antall fjøler: optimal kapping** (bin-packing). Eksempelet 5 biter på 120 cm fra
  3,90 m gir korrekt **2 fjøler** (3 biter per fjøl, 30 cm kapp), ikke 3.
- **Gruppering per dimensjon:** biter av samme dimensjon kombineres på samme fjøl
  (du kan ikke kappe to ulike dimensjoner fra ett bord). Meterpris per dimensjon
  tas som høyeste blant radene for å ikke underprise.
- **JSONB-rader** framfor egen rad-tabell: kapplister er små og selvstendige per
  prosjekt, så hele lista lagres/oppdateres i ett kall.
- **Standard fjøllengde 3,90 m**, sagsnitt 0 mm som default (kan endres per liste).

## Verifisering

- `npm run check`: 0 errors, 0 warnings.
- `npm test`: 741 tester passerer (inkl. 15 nye for kappliste-beregningen).
