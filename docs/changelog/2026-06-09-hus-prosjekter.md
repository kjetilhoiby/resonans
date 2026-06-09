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

## Kjente oppfølginger

- Hjem-dashboardets klient-cache (stale-while-revalidate) gjør at et nytt prosjekt kan mangle i lista til neste revalidering. Vurder cache-invalidasjon ved create.
- Drag-omsortering av oppgaver (`sortOrder` finnes, ikke UI).
- Budsjett/bank-transaksjoner per prosjekt (kobling via `projects.themeId`) — bevisst utenfor v1.
