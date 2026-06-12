# Strukturert settings-side: Profil flyttet til egen underside

Dato: 2026-06-12
Status: ferdig

## Kontekst

Settings-hovedsiden hadde en blandet struktur: Profil og Partner lå inline i en
`<details>`-seksjon øverst, mens alle andre innstillinger (kilder, varslinger,
klassifisering, tracking, eksterne apper, jobber, snoozes) lå som kort i en
oversikts-grid med egne undersider. Profil er ikke viktig nok til å dominere
hovedsiden, og burde følge samme mønster som resten.

## Faser

### Fase 1: Ny underside `/settings/profile`

- `src/routes/settings/profile/+page.server.ts`: Flyttet load (bruker,
  fødselsdato fra self-personen, partnerforhold, parsjekk-status, delingslenke)
  og alle partner-actions (`invitePartner`, `acceptMarriageInvite`,
  `declineMarriageInvite`, `cancelMarriageInvite`, `submitRelationshipCheckin`)
  fra `/settings`.
- `src/routes/settings/profile/+page.svelte`: Profil-kortet (navn, e-post,
  fødselsdato-editor, bilde, høyde/kjønn) og Partner-kortet (invitasjoner,
  daglig parsjekk) flyttet hit uendret. `PageHeader` med `titleHref="/settings"`
  i tråd med designsystemet (tittelen er tilbakeknappen).

### Fase 2: Forenklet hovedside `/settings`

- Hovedsiden er nå en ren oversikts-grid. Nytt «Profil»-kort først i griden med
  status-dot (varsel hvis navn/e-post mangler) som lenker til
  `/settings/profile`.
- Fjernet død kode: `updateSettings`-action (ingen skjema postet til den —
  varslinger har egen action på `/settings/notifications`), og ubrukte
  sync/disconnect-funksjoner for Withings/SpareBank1/Google Sheets som lå igjen
  fra før kildene fikk egen underside. Status-henting beholdt for tellerne på
  «Kilder»-kortet.

### Fase 3: Parsjekk flyttet til Familie-temaet

Den daglige parsjekken er en daglig vane, ikke en innstilling — den hører
hjemme i parforhold/familie-domenet, ikke under settings.

- `src/routes/api/relationship/checkin/+server.ts`: Nytt API (GET status,
  POST submit) etter samme mønster som egenfrekvens-checkin. Gjenbruker
  `$lib/server/relationship-checkin`.
- `src/lib/components/domain/family/RelationshipCheckinCard.svelte`:
  Selvstendig kort som henter status på mount og lagrer via APIet. Rendrer
  ingenting uten bekreftet partner. Score velges med 1–7-knapper
  (`data-track="parsjekk:score"`), notat-felt med aria-label.
- `FamilyDashboard.svelte`: Kortet vises øverst i «Familietre»-visningen.
- `src/lib/components/ui/Textarea.svelte`: Fikk `ariaLabel`-prop (manglet).
- `/settings/profile`: Parsjekk-skjemaet og `submitRelationshipCheckin`-action
  fjernet; Partner-kortet lenker i stedet til `/tema/familie`.

### Fase 4: Oppdatert lenke i Google Chat-nudge

- `src/lib/server/google-chat.ts`: Parsjekk-nudgen lenket til
  `/settings#profil?nudgeTrack=...` (feilformet URL med fragment før query).
  Oppdatert til `/tema/familie?nudgeTrack=...` der parsjekken nå bor.
  NB: forutsetter at brukeren har et tema som heter «Familie» (navneoppslag
  i `/tema/[id]`) — nudgen er kun aktuell for brukere med partner.

## Beslutninger

- Profil og Partner holdes på samme underside — partnerkoblingen er personinfo
  og kortene var allerede gruppert sammen.
- Parsjekken bor i Familie-dashboardet (parforhold er del av family-domenet);
  selve partner*koblingen* (invitasjoner) forblir under profil, siden den er
  konto-administrasjon.
- Parsjekk-kortet henter status selv i stedet for å gå via
  `FamilyDashboardData`/dashboard-cache — dagsfersk status skal ikke caches
  sammen med resten av dashboardet.
- Hovedsidens load henter nå bare brukeren (for profilvarsel og
  varslingsteller); relasjonsspørringene kjører kun på undersiden.

## Verifisering

- `npm run check`: 0 feil.
- `npm test`: 483 tester passerer.
- Settings-siden er ikke blant de 5 sidene i visuell regresjon, så ingen
  baseline-oppdatering trengs.
