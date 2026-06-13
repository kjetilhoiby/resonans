# Adaptiv rekalkulering: varsel + coach som endrer planen

Dato: 2026-06-13
Status: ferdig

## Kontekst

Den adaptive treningsmodusen (se `2026-06-12-adaptiv-treningsmodus.md`) justerer
planen ukentlig, men endringene skjedde stille — brukeren oppdaget dem bare ved
å besøke programsiden, og hadde ingen rask måte å overstyre dem på.

Ønsket: når «LLM rekalkulerer treningsprogram» (det adaptive momentet) skal det
føre til et **push-varsel** og en **chat der brukeren kan foreslå justeringer** —
og coachen skal kunne **endre planen direkte** ut fra det brukeren sier.

## Faser

### Fase 1: Brukerføringer (preferences)

- `scripts/db-migrations/0017_program_preferences.sql` + `training_programs.preferences` (jsonb).
- `ProgramPreferences` (programs/types.ts): `pinnedDays` (ukedager løp ikke skal
  flyttes fra), `lockPace` (lås tempo mot auto-rekalkulering), `volumeBias`
  (ønsket volumnivå 0.5–1.5), `notes` (frie føringer).
- `adaptive-service.ts` respekterer føringene: hopper over temporekalkulering ved
  `lockPace`, multipliserer neste ukes volumfaktor med `volumeBias`, og filtrerer
  bort dagflyttinger fra pinnede dager. Dette lukker loopen — det brukeren
  foreslår i chatten påvirker den automatiske justeringen permanent.

### Fase 2: Varsel ved rekalkulering

- `adaptive-nudge.ts`: `notifyAdaptation` sender push (PWA) + Google Chat via
  brukerens ruter, dedupet via `nudgeEvents` (ny type `program_adaptive_recalc`)
  og uke-tag. Deep-link til `/treningsprogram/[id]?nudgeEventId=…`.
- Ny notification-route-nøkkel `programAdaptive` (default `['pwa', chat]`).
- `runWeeklyAdaptation`/`runWeeklyAdaptationsForAllPrograms` tar nå `appUrl` og
  varsler kun når planen faktisk endret seg. Cron-endepunktet sender `url.origin`.
- Varsel sendes aldri ved «ingen endring» — inherent lavfrekvent (maks ukentlig).

### Fase 3: Coach som endrer planen direkte

- Ren, testbar logikk i `program-edits.ts` (17 tester): `planDayMove`
  (flytt/bytt med kollisjonshåndtering), `scaledRunTargets`, `mergePreferences`
  (validering/klemming), pluss DB-operasjonene `moveSessionToDay`, `setRunPace`,
  `scaleVolume`, `updatePreferences`, `resolveTargetProgram`.
- AI-verktøy `manage_training_program` (`src/lib/ai/tools/`) med actions
  `get` (forklar hva som endret seg + finn sessionId), `move_session`,
  `set_pace`, `scale_volume`, `set_preference`. Registrert i `/api/chat`
  (tool-definisjon + dispatch); tilgjengelig i hjem-chatten via
  `/api/chat-stream-messages` → `_runChatRequest`.
- Velger brukerens aktive (adaptiv-foretrukne) program når `programId` utelates.

### Fase 4: Inngang til chatten

- HomeScreen leser `?prefill=…` og åpner chatten med meldingen sendt med en gang.
- Programsiden: «💬 Diskuter justeringene med coachen» (i adaptiv-seksjonen)
  navigerer til `/?prefill=…` med en forklar-og-endre-melding.

## Beslutninger

- **Føringer på program-nivå, ikke harde låser i UI**: coachen setter dem
  konversasjonelt, og den automatiske justeringen respekterer dem. Gir «foreslå»
  semantikk uten egen innstillingsside.
- **Varsel kun ved reell endring**: ingen støy når uken bekrefter planen.
- **Verktøyet leser før det skriver**: `get`-action tvinger modellen til å se
  faktiske sessionId-er og siste justeringer før den endrer — unngår gjetting.
- **Direkte endring vs. neste-uke-føring**: konkrete edits (flytt/tempo/volum)
  treffer planen umiddelbart; `set_preference` påvirker fremtidige automatiske
  justeringer. Begge tilgjengelig, modellen velger ut fra hva brukeren ber om.
- **Gjenbruk av nudge-infrastruktur**: samme push/Chat-ruting, dedup og
  deep-link-mønster som readiness-nudges — ingen ny varslingsstack.

## Verifisering

- 531 enhetstester grønne (17 nye i `program-edits.test.ts`).
- `npm run check`: 0 feil. Produksjons-build OK.
- Hjem-chatten er visuelt testet, men `?prefill=` påvirker bare oppførsel ved
  deep-link (tom URL i baseline-testene), så pikseltestene er uberørt.
