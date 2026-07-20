# Prosjekttyper (hjem-prosjekter uten kappliste)

Dato: 2026-07-20
Status: ferdig

## Kontekst

Hjem-prosjekter (undertemaer av «Hjem») fikk alle samme faner hardkodet:
`chat`, `oppgaver`, `kapp` (Kappliste/materialkalkulator) og `filer`. Kappliste er
bare relevant for bygg-/oppussingsprosjekter. Noen prosjekter handler mer om
kommunikasjon — purre folk, samle kontaktinfo, formulere e-poster og ta noen
telefoner — og trenger ikke kappliste. De trenger heller en kontaktliste og
påminnelser om å følge opp.

Denne endringen innfører en **prosjekttype** (`projectProfile.kind`) som styrer
hvilke faner et prosjekt får, og legger til en kontaktliste + purre-nudge for
kommunikasjons-/arrangementprosjekter.

## Faser

### Fase 1: Prosjekttype + betingede faner

- **`src/lib/domain/project-kinds.ts`** (ny): registeret over prosjekttyper.
  Fem typer: `bygg` (🔨, oppgaver+kappliste — default), `kommunikasjon` (📞,
  oppgaver+kontakter), `arrangement` (🎉, oppgaver+kontakter), `innkjop` (🛒,
  oppgaver+kappliste), `generell` (📋, bare oppgaver). `projectTabsForKind()`
  gir full fane-liste (alltid `chat` først, `filer` sist). Manglende/ukjent kind
  → `bygg` (bakoverkompatibelt: eldre prosjekter oppfører seg som før).
- **`schema.ts`**: `projectProfile.kind` lagt til (jsonb, ingen migrasjon nødvendig).
- **`ThemePage.svelte`**: `availableTabs` for hjem-prosjekter bruker nå
  `projectTabsForKind(projectProfile)` i stedet for hardkodet liste. Ny fane-etikett
  «📇 Kontakter».
- **`HomeDashboard.svelte`**: «+ Nytt prosjekt» har en type-velger (chips). Kortenes
  emoji faller tilbake på typens emoji.
- **`/api/hjem/prosjekt/create`**: tar imot `kind`, setter det i profilen, og velger
  standard-emoji fra typen.
- **`/api/hjem/prosjekt/[id]`** (ny): PATCH for å endre type/rom/frist/status i etterkant.

### Fase 2: Kontakter

- **`project_contacts`-tabell** (`schema.ts` + migrasjon `0044_project_contacts.sql`):
  navn, rolle, telefon, e-post, status (`todo`/`venter`/`ferdig`), notat,
  `followUpAt` (purredato), `lastContactedAt`.
- **`src/lib/server/project-contacts.ts`** (ny): mapper + rene hjelpefunksjoner
  (`isContactDueForFollowUp`, `contactsDueForFollowUp`, `normalizeIsoDate`).
- **`/api/tema/[id]/kontakter`** (ny): GET/POST/PATCH/DELETE (body `contactId`).
- **`ThemeKontakterTab.svelte`** (ny): kontaktkort med status-pille (syklet ved klikk),
  ring/e-post-lenker, oppfølgings-badge (uthevet ved forfall), rediger-sheet med
  purredato, og «✨ Utkast»/«💬 Chat»-knapper som sender AI-en en forespørsel om å
  formulere oppfølging.
- Kontakter lastes i `tema/[id]/+page.server.ts` kun for typer med kontakter-fane.

### Fase 3: Purre-nudge + AI

- **`src/lib/server/project-followup-nudges.ts`** (ny): daglig purre-nudge. For hver
  bruker finnes forfalte, ikke-ferdige kontakter (gruppert per prosjekt) og varsles
  på PWA + Google Chat når lokal tid = innstilt tidspunkt (default 09:00).
- **`/api/cron/project-followup-nudges`** (ny), registrert i cron-jobb-registeret
  (`0 * * * *`, timebasert lokal-tid-gating). Instrumentert med `withCronTracking`.
- **`google-chat.ts`**: `buildProjectFollowUpNudgeMessage`.
- **`nudge-events.ts`**: ny `nudgeType` `project_followup`.
- **`notification-channels.ts`**: ny rutenøkkel `projectFollowUp` (default PWA + chat).
- **`manage_project_contacts`** AI-verktøy (`src/lib/ai/tools/manage-project-contacts.ts`):
  create/update/delete/list. Registrert i `shared-tools.ts` og `api/chat/+server.ts`
  (verktøydef + executor + `PROSJEKTKONTAKTER`-kontekstinjeksjon med id-er).

## Beslutninger

- **`kind` i `projectProfile` (ikke ny kolonne).** Hjem-prosjekter er temaer; profilen
  er allerede jsonb. Ingen migrasjon for kind, og manglende kind → `bygg` gir
  smertefri bakoverkompatibilitet.
- **Kontakter i egen tabell, ikke `theme_lists`.** Kontakter har strukturerte felter
  (telefon/e-post/status/purredato) som driver nudge-logikk — for rikt for en enkel liste.
- **Purre-nudge piggybacker på timebasert cron-mønster** (som `day-planning-nudges`),
  gatet på lokal tid. Ingen ny planleggingsinfrastruktur.
- **AI formulerer e-post/samtaler i chatten**, verktøyet lagrer bare kontaktene.
  Kontekstinjeksjon gir modellen kontaktlista med id-er.

## Verifisering

- `npm run check`: 0 feil.
- `npm test`: 1579 tester grønne, inkl. nye `project-kinds.test.ts` (11) og
  `project-contacts.test.ts` (7 grupper).
- Nye rene funksjoner (tab-resolvering, purre-forfallslogikk) er enhetstestet.
- Visuell regresjon uendret: type-velgeren vises kun når «+ Nytt prosjekt» er åpnet,
  og kontakter-fanen kun for kommunikasjons-/arrangementprosjekter — baseline-sidene
  (hjem, tema/helse, tema/økonomi) er visuelt uendret i standardtilstand.
