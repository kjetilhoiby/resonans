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

## Fase 12: Ryddet oppgave-UI (lik ukeplan-stil)
- Knappeløse rader — `+` og `...` fjernet; handlinger via langpress (Rediger/Bryt ned/Slett). Dra-håndtak + avkryssing beholdt.
- Ghost-input som lagrer på enter/blur: «Ny oppgave …» (rot) og «Legg til deloppgave …» under hver toppoppgave. Ingen egen «Legg til»-knapp.
- «✨ Foreslå flere steg» → «💬 Chat om prosjektet» (åpner prosjekt-chatten).

## Fase 13: Chat styrer oppgavelista (AI-verktøy)
- Nytt AI-verktøy `manage_project_tasks` (`src/lib/ai/tools/manage-project-tasks.ts`): create/update/check/delete på checklist_items for et themeId. Gjenbruker `project-tasks`-helpers + `parseTaskText`. Støtter parentId (underoppgave), dueDate (→ dag-membership), estimateMinutes, shopping/store, og avhengigheter (`blockedBy` + ergonomisk `blocksItemIds` for «A før B» i ett kall).
- Registrert i `/api/chat/+server.ts` (tool-def + handler). Prosjektets oppgaveliste injiseres i systemprompten MED id-er (`PROSJEKTOPPGAVER`-blokk) når `conversation.themeId` er satt, så AI-en kan referere itemId/parentId/blockedBy presist.
- **Robusthet-fiks:** `ensureThemeForUser` setter nå `conversations.themeId` ved oppretting (før skjedde det bare ved sidelast), så chat-konteksten virker uansett rekkefølge.
- UI-refresh: `ThemeTasksTab` re-henter oppgaver ved mount (fanen re-monteres ved tab-bytte), så endringer gjort i chatten vises når man går til Oppgaver.

Verifisert live (ekte OpenAI): «På Maxbo må jeg også kjøpe aluminiumslister …» → AI kaller `manage_project_tasks`, oppretter «Kjøp aluminiumslister» med 🛒 Maxbo. Avhengighets-retning er **best-effort** — gpt-4o-mini bommer av og til på «før»-retningen (legger blockedBy feil vei); `blocksItemIds` + eksplisitt advarsel i prompten reduserer det, men brukeren kan korrigere presist i rediger-arket.

## Fase 14: Handleliste per butikk (klikkbar butikk)
- Butikknavnet på en innkjøps-oppgave (🛒) er nå en **klikkbar lenke** → `/handleliste?store=<butikk>` (`ThemeTasksTab`).
- Ny rute `/handleliste`: henter innkjøps-oppgaver (`metadata->>'shopping'='true'`) på tvers av alle hjem-prosjekter (`parentTheme='Hjem'`), via join mot `themes`. Uten filter: oversikt med butikk-kort (X igjen / Y kjøpt). Med `?store=`: liste over varene for butikken, **på tvers av prosjekter**, med avkryssing (PATCH til `/api/tema/[id]/tasks`) og klikkbar prosjekt-chip → `/tema/{id}`.
- Verifisert (Playwright + HTML): innkjøp tagget «Maxbo» fra to ulike prosjekter samles i én liste; «Jernia»-vare holdes utenfor; avkryssing reflekteres.

## Fase 15: Butikk → bank-transaksjoner (Fase 3c)
- `/handleliste?store=X` viser nå en «Kjøp på X»-seksjon: bank-transaksjoner som matcher butikken via `canonicalBankTransactions.merchantKey ILIKE '%X%'` (merchantKey er normalisert/UPPERCASE, så fuzzy-match treffer «REMA» → «REMA BØLER»). Siste 180 dager.
- Egen SUM/COUNT-spørring gir korrekt total + antall over hele vinduet; lista viser de 25 siste (med «Viser de 25 siste»-note når kuttet). Beløp formatert med `Intl.NumberFormat` (nb-NO, NOK).
- Ingen ny tabell nødvendig — matcher direkte på normalisert merchantKey. Verifisert mot ekte data: «REMA» → «35 696 kr · 100 kjøp siste 180 dager».

## Kjente oppfølginger

- **Kvitteringer (Fase 3d, ikke bygget):** Henge kvittering (bilde/PDF) på en innkjøps-oppgave/transaksjon. Kan gjenbruke `theme_files` (Cloudinary) + en kobling (`checklistItemId`/`transactionId`), men ingen kvitterings-konsept finnes i dag. Egen runde.
- **Merchant-matching er fuzzy** (substring på merchantKey). Treffer bredt (f.eks. «Coop» matcher alle Coop-varianter), men kan gi falske treff for korte/generiske butikknavn. En eksplisitt butikk→merchantKey-mapping kan komme senere ved behov.
- Avhengighets-retning fra chat er best-effort (gpt-4o-mini, se Fase 13).

- Underoppgaver (parentId) med frist vises ikke i dagslista (DaySection filtrerer bort `parentId`-items) — kun topp-nivå daterte oppgaver. Sannsynligvis ønsket.
- `sortOrder` deles mellom prosjekt-fane og dag-liste (ett felt), så reorder ett sted kan påvirke rekkefølgen det andre. Akseptert for v1.
- Hjem-dashboardets klient-cache kan vise et nytt prosjekt med ett refresh-lag (stale-while-revalidate).

- Hjem-dashboardets klient-cache (stale-while-revalidate) gjør at et nytt prosjekt kan mangle i lista til neste revalidering. Vurder cache-invalidasjon ved create.
- Drag-omsortering av oppgaver (`sortOrder` finnes, ikke UI).
- Budsjett/bank-transaksjoner per prosjekt (kobling via `projects.themeId`) — bevisst utenfor v1.
