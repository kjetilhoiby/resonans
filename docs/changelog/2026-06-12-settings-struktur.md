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

### Fase 3: Oppdatert lenke i Google Chat-nudge

- `src/lib/server/google-chat.ts`: Parsjekk-nudgen lenket til
  `/settings#profil?nudgeTrack=...` (feilformet URL med fragment før query).
  Oppdatert til `/settings/profile?nudgeTrack=...`.

## Beslutninger

- Profil og Partner holdes på samme underside — partnerkoblingen er personinfo
  og kortene var allerede gruppert sammen.
- Hovedsidens load henter nå bare brukeren (for profilvarsel og
  varslingsteller); relasjons- og parsjekk-spørringene kjører kun på
  undersiden.

## Verifisering

- `npm run check`: 0 feil.
- `npm test`: 483 tester passerer.
- Settings-siden er ikke blant de 5 sidene i visuell regresjon, så ingen
  baseline-oppdatering trengs.
