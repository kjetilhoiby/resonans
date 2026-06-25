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
- **Kollapsbare materialkort:** hvert råmateriale er et kort med en klikkbar topplinje.
  Kollapset viser den bare navnet (dim/tykkelse) + kompakte kapp-chips (lengde/mål ×
  antall); utvidet viser hele editoren. Eksisterende materialer starter kollapset, nye
  starter åpne.
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
  3 per lekt). Plater: 2D MaxRects fri-rektangel-pakker med rotasjon (se Fase 6) —
  et *estimat* for scoping, men tett.
- **Alt i mm** (matcher byggvare-språk: 3900, 2440×1220, 380×420).
- **JSONB-materials** framfor egne tabeller: kapplister er små og selvstendige per
  prosjekt, så hele lista lagres/oppdateres i ett kall.

### Fase 6: Bedre plate-pakking (MaxRects)

Den opprinnelige plate-pakkeren var hylle-basert (Next-Fit Decreasing Height). Den
la kapp i fulle horisontale hyller og kunne ikke fylle restsoner *under* et plassert
kapp — bare ved siden av. Den valgte også orientering grådig per hylle (laveste
høyde), som kunne legge høye kapp flatt og spise opp platehøyden. Resultat:
overestimerte antall plater i vanlige tilfeller.

Eksempel funnet av bruker: 3×(1200×600) + 6×(400×300) på 2440×1220 (totalt
2 880 000 mm² < 2 976 800 mm² = én plate) ble pakket på **2** plater. Optimalt: de
tre store stående (1800 mm bred stripe), seks små i restsona 640×1220 som to
kolonner × tre rader → **1** plate.

- `calc.ts`: byttet hylle-heuristikken med en **MaxRects fri-rektangel-pakker**
  (`splitFree`/`pruneFree`/`findPlacement`/`packWithStrategy`). Den holder en liste
  fri-rektangler per plate og deler dem opp rundt hvert plasserte kapp, så soner
  både ved siden av og under utnyttes.
- Fordi 2D-pakking er NP-hardt og ingen enkelt grådig regel er best for alle
  tilfeller (BSSF stiller store kapp stående men legger små flatt; BLSF motsatt),
  kjører `layoutSheets` **flere strategier** — 3 sorteringer × 5 plasseringsregler
  (`bssf`, `blsf`, `baf`, `portrait`, `landscape`) — og velger pakkingen med færrest
  plater, deretter minst svinn. `portrait`/`landscape` tvinger konsekvent orientering,
  som løser tilfeller der grådig per-kapp-fit pakker dårlig.
- Sagsnitt (`kerfMm`) reserveres til høyre og under hvert kapp via fotavtrykket som
  deler fri-rektanglene.
- Nye tester: brukerens tilfelle → 1 plate; alle kapp innenfor platemålene (aldri
  underestimat). `tooLarge`-flagging og rotasjons-tilfellene består uendret.

### Fase 7: Sagsnitt med desimaler + UI

Sagsnittet (kerf) sto som `integer` med standard `0` og hadde ingen UI — så et
ekte sagblad (~1,8 mm) ble aldri trukket fra. Bruker påpekte dette.

- `cut_lists.kerf_mm`: `integer` → `double precision`, standard `1.8`. Migrasjon
  `0024_kerf_decimal.sql` (bytter type, ny default, og løfter eksisterende 0-rader
  til 1.8 siden 0 bare var en plassholder).
- API (POST/PATCH): tar imot desimaler, klemmer til `[0, 50]` mm, faller tilbake
  til 1,8 ved manglende verdi (i stedet for å avrunde til heltall).
- `ThemeKapplisteTab.svelte`: nytt **Sagsnitt**-felt per kappliste (under tittelen,
  `data-track="kappliste:sagsnitt"`), så bladbredden kan justeres per liste.

### Fase 8: Materiale-modal med presets

Råmaterialer ble lagt til via to knapper («+ Lekt/bjelke» / «+ Plate») som lagde et
tomt materiale du måtte fylle ut inline. Erstattet med én **«+ Materiale»**-knapp som
åpner en modal for å velge materialet skikkelig.

- `MaterialPickerModal.svelte` (domain/theme, bygd på delt `BottomSheet`): toggle
  plate/lengdevare, tresort/platetype (input + `datalist`), behandling (chips), mål
  (x/y/z) og pris. Navnet genereres automatisk fra valgene («15 mm kryssfiner poppel»)
  og kan overstyres.
- **Presets som chips**: dine egne, tidligere brukte materialer (utledet on-the-fly
  fra alle kapplistene dine, deduplisert) — klikk fyller alle felt. Ingen innebygd
  katalog og ingen ny tabell (bevisst valg).
- `catalog.ts`: `WOOD_TYPES`/`TREATMENTS` (valg-alternativer), `materialDisplayName`
  (auto-navn), `presetKey` + `derivePresets` (deduplisering). Rene, testede funksjoner.
- Modellutvidelse (JSONB, ingen SQL-migrasjon): `Material` fikk `woodType`,
  `treatment`, `thicknessMm` og `crossWidthMm`. Brukt til navn/presets — ikke i
  beregningen. `sanitizeMaterials` og schema-`$type` oppdatert.

## Beslutninger (forts.)

- **Presets = kun egne brukte materialer**, ikke en innebygd byggevare-katalog.
  Avklart med bruker — katalogen (norske standardmål) ble brukt som referanse for
  valg-listene, men chips speiler det brukeren faktisk har brukt.
- **Tresort/behandling som egne felt** (ikke bare fritekst-navn), så de kan
  filtreres/gjenbrukes og navnet genereres konsistent.

## Verifisering

- `npm run check`: 0 errors, 0 warnings.
- `npm test`: 755 tester passerer (inkl. 21 for beregning/MaxRects og 8 for
  katalog/presets).
- Verifisert at brukerens plate (3×1200×600 + 6×400×300 på 2440×1220) fortsatt
  pakkes på 1 plate med sagsnitt 1,8 mm.

### Fase 9: Plate-pris i kr/m² (egen PR)

Plater ble priset per hele plate (`pricePerSheetNok`). Bruker påpekte at plater
vanligvis prises i **kr/m²** — analogt med at lengdevarer prises i kr/m.

- `Material.pricePerSheetNok` → `pricePerSquareMeterNok`. Kostnad for plate =
  `antall plater × plateareal (m²) × pris/m²` (du betaler fortsatt for hele plater
  inkl. svinn). `computeMaterial`, `rows.ts`, schema-`$type`, modal og inline-editor
  oppdatert. Felt-label «Pris per m²» med suffiks `kr/m²`.
- Data-migrasjon i `DATA_MIGRATIONS` konverterer eksisterende plate-materialer:
  `pricePerSquareMeterNok = pricePerSheetNok / plateareal`, fjerner `pricePerSheetNok`.
  Idempotent (kun rader som fortsatt har en plate med `pricePerSheetNok`), så
  effektiv kostnad bevares.
- Tester oppdatert: plate-kostnad bruker areal × pris/m².

### Fase 10: «Kapp i butikk» for transport (Tesla Model Y, egen PR)

En hel plate (2440×1220) eller lang lekt (3,90 m) får ikke plass i et bil-lasterom.
Mange byggevarebutikker kapper gratis. Resonans foreslår nå hvilke snitt du bør be om.

- `transport.ts` (ren logikk + 14 tester): `fitsTransport`, layout-bevisst
  **giljotin-partisjonering** av plater (`planSheetTransport`) som legger snittene i
  mellomrommene i kappeplanen — ingen ferdig bit deles — og 1D-segmentering av
  lengdevarer (`planBoardTransport`). `planMaterialTransport` aggregerer per materiale.
- **Transport-grense per kappliste**, forhåndsutfylt med Tesla Model Y (baksete ned:
  ~1900 mm lengde × ~1000 mm bredde mellom hjulkassene), redigerbar. Nye kolonner
  `transport_max_length_mm`/`transport_max_width_mm` (migrasjon 0025), API + loader.
- UI: transport-grense-felt ved siden av sagsnitt, og en «📦 Kapp i butikk»-linje per
  materiale: «Be butikken kappe N plate(r) med M snitt → alle deler passer bilen».
  Advarer hvis en ferdig bit selv er for stor for bilen.
- Eksempel: 3×(1200×600) + 6×(400×300) på 2440×1220 → 3 snitt → 4 striper
  (≤636×1220) som alle passer Model Y.
- **«Tilpass kapp til bil» som checkbox** (kolonne `transport_enabled`, migrasjon
  0026, default på): krysses av/på per kappliste. Avkrysset skjuler både
  transport-grense-feltene og «kapp i butikk»-linja.
