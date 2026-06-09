# Hus-prosjekter som undertemaer av Hjem

Dato: 2026-06-09
Status: ferdig (v1)

## Kontekst

Brukeren ville kunne opprette prosjekter fra hjem-temaet, og ønsket at hvert prosjekt skulle være en full arbeidsflate: egen chat, oppgaveliste med underoppgaver/frister/avhengigheter, og filer (kvitteringer, skisser, bilder før-under-etter). Kanoneksempel: «bygg terrasse fra fundament til toppdekke og beplantning over fire uker».

Dette er strukturelt identisk med hvordan ferier er undertemaer av Familie. Valgt arkitektur: **et hus-prosjekt = et tema med `parentTheme='Hjem'`**, som arver tema-maskineriet (chat via `conversationId`, filer via `ThemeFilesTab`/`themeFiles`, og en ny oppgave-fane). ~85 % av infrastrukturen fantes allerede.

## Faser

### Fase 1: Datalag
- Nytt `projectProfile` JSONB på `themes` (rom, status, startDate, targetDate, coverImageUrl).
- Migrasjon `scripts/db-migrations/0014_theme_project_profile.sql` (additiv, `IF NOT EXISTS`) + `schema.ts`.
- La til `blockedBy?: string[]` i `checklistItems.metadata`-typen (kun type — jsonb, ingen migrasjon).

### Fase 2: Opprett-endepunkt
- `POST /api/hjem/prosjekt/create` — speiler `/api/ferie/create`. `ensureThemeForUser(parentTheme:'Hjem')` (gir egen samtale automatisk) + setter `projectProfile`. Returnerer `{ themeId }`.

### Fase 3: Listing i Hjem
- `/api/tema/[id]/dashboard/home` henter nå barn-temaer (`parentTheme='Hjem'`) med oppgave-progresjon (aggregert fra `checklistItems` per `themeId`) → `projectThemes`.
- `HomeDashboardData`-typen utvidet.
- `HomeDashboard.svelte`: «Prosjekter»-seksjon viser prosjekt-kort (emoji, rom, progresjonsbjelke, frist) → `/tema/{id}`. Inline «+ Nytt prosjekt»-form → create-endepunkt → naviger til nytt undertema. (Erstattet den gamle `projects`-tabell-baserte ProjectCard-lista.)

### Fase 4: Oppgave-CRUD
- `/api/tema/[id]/tasks` (GET/POST/PATCH/DELETE) på `checklistItems` filtrert på `themeId`. Hvert prosjekt får én checklist (`context='theme_project:<id>'`). Støtter underoppgaver (`parentId`), frister (`dueDate`), estimat (`estimateMinutes`), avkryssing, og avhengigheter (`metadata.blockedBy`).
- Delt hjelper `src/lib/server/project-tasks.ts` (`requireTheme`, `ensureProjectChecklist`, `mapTaskItem`).

### Fase 5: AI-nedbryting
- `POST /api/tema/[id]/tasks/breakdown` — GPT-4o bryter ned prosjektet (eller en enkeltoppgave via `parentId`) i 4–8 underoppgaver med estimat, foreslåtte frister (`offsetDays` fra prosjektstart) og avhengigheter (`dependsOn` → `blockedBy`). Setter inn `checklistItems`, markerer forelderens `metadata.hasBreakdown`.

### Fase 6: UI
- `ThemeTasksTab.svelte` — oppgavetre (rekursiv `{#snippet}` for hierarki), avkryssing, frist-badge med forfalt-styling, estimat, «avventer: X» for blokkerte, legg-til-form, «✨ Bryt ned med AI» (prosjekt + per oppgave). Mørke designvariabler.
- `ThemePage.svelte`: ny `oppgaver`-fane. Prosjekt-undertemaer (`isHomeProject`) får fanene `['chat','oppgaver','filer']` og åpner på `oppgaver`.
- `tema/[id]/+page.server.ts`: laster `isHomeProject`, `projectProfile`, `tasks` for prosjekt-undertemaer.

### Fase 7: Filer
- Filer-fanen (`ThemeFilesTab` — opplasting til Cloudinary, bilder/PDF) er med i prosjekt-fanene uten endringer. Dekker kvitteringer/skisser/bilder.

## Beslutninger

- **Undertema framfor å berike `projects`-entiteten:** maksimal gjenbruk av chat/filer; prosjektet blir en førsteklasses arbeidsflate. Den gamle `projects`-tabellen beholdes (typekompat) men rendres ikke lenger i Hjem.
- **Avhengigheter i `metadata.blockedBy`** (string[] av item-ids) framfor egen tabell — holdt v1 migrasjonsfri.
- **Frister fra AI som `offsetDays`** relativt til prosjektstart (eller dagens dato) — enkelt og forklarbart.

## Verifisering

- `npm run check`: 0 feil. `npm test`: 357/357.
- Playwright (auth-bypass, dev): opprett via UI → navigerer til `/tema/{id}` på oppgave-fanen → legg til oppgave → kryss av («1/1 fullført»). Dashboard-API returnerer prosjektet i `projectThemes` med korrekt progresjon. Testprosjektet ble slettet fra DB etterpå.
- AI-nedbryting (`/breakdown`) er wiret og typesjekket, men ikke kjørt live i verifiseringen (ekte OpenAI-kall).

## Fase 8–10 (oppfølging samme dag)

Etter v1 ga brukeren tilbakemelding: AI-nedbrytingen var «for voldsom», og oppgavene burde manipuleres som i dagsplan.

- **Mildere nedbryting:** Erstattet det auto-strukturerte `/api/tema/[id]/tasks/breakdown` (gpt-4o, satt inn 4–8 oppgaver med frist+avhengigheter automatisk) med dagsplanens `BreakdownModal` + `/api/breakdown/suggestions` (gpt-4o-mini, tekstforslag du **plukker fra**). Det aggressive endepunktet er slettet.
- **Langpress-manipulasjon (dagsplan-mønster):** Langpress + ⋯ på en rad → `TaskContextMenu` (Rediger / Bryt ned / Slett). Nytt redigerings-sheet: tekst, estimat (chips), frist (datovelger), avhengigheter (`blockedBy`, avkrysning av andre oppgaver). Inline «＋ underoppgave» per rad.
- **Dra/slipp-sortering (#9):** Peker-basert drag (touch + mus) via dra-håndtak (⠿), reindekserer søsken og persisterer `sortOrder` (PATCH). Innenfor samme nivå.
- **Nøkkelord-parsing (#10):** `parseTaskText` (`src/lib/domains/home/task-parse.ts`, speiler `detectMealPrefix`) tolker «kjøp: X på [butikk]» → ren tekst + `metadata.shopping`/`store`. 🛒-badge i raden. 7 enhetstester.
- Brukslogging: alle nye kontroller har `data-track`/`aria-label` per CLAUDE.md-konvensjonen.

Verifisert: `npm run check` 0 feil, `npm test` 367/367, API + UI-smoke (parsing, redigering, reorder, kontekstmeny, badges) via Playwright; testprosjekt slettet etterpå.

### Fase 11: Datering → fullt redigerbar i ukeplanens dagsliste
Valgt modell: **dual-membership**. Når en prosjekt-oppgave får en `dueDate`, settes `checklistId` til dagens dag-checklist (`context='week:…:day:…'`, opprettes ved behov via `dayContextForDate`), mens `themeId` beholdes. Da:
- lastes og redigeres oppgaven naturlig i ukeplanens dagsliste (toggle/dra bruker item-ets egen `checklistId` = dag-checklisten — ingen ukeplan-endringer nødvendig),
- vises den fortsatt i prosjektets oppgave-fane (hentes via `themeId`).
Fjernes fristen, flyttes item tilbake til prosjektets egen checklist. `src/lib/server/project-tasks.ts:syncProjectItemDayMembership`, kalt fra tasks POST/PATCH når `dueDate` settes/endres.

Verifisert (Playwright + DB): frist → item får dag-context `week:2026-W24:day:2026-06-10`, beholder themeId, vises i prosjekt-fanen OG i `/ukeplan`; fjernet frist → tilbake til prosjekt-checklist.

## Kjente oppfølginger

- Underoppgaver (parentId) med frist vises ikke i dagslista (DaySection filtrerer bort `parentId`-items) — kun topp-nivå daterte oppgaver. Sannsynligvis ønsket.
- `sortOrder` deles mellom prosjekt-fane og dag-liste (ett felt), så reorder ett sted kan påvirke rekkefølgen det andre. Akseptert for v1.
- Hjem-dashboardets klient-cache kan vise et nytt prosjekt med ett refresh-lag (stale-while-revalidate).

- Hjem-dashboardets klient-cache (stale-while-revalidate) gjør at et nytt prosjekt kan mangle i lista til neste revalidering. Vurder cache-invalidasjon ved create.
- Drag-omsortering av oppgaver (`sortOrder` finnes, ikke UI).
- Budsjett/bank-transaksjoner per prosjekt (kobling via `projects.themeId`) — bevisst utenfor v1.
