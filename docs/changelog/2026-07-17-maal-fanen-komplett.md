# Mål-fanen: komplett måloversikt

Dato: 2026-07-17
Status: ferdig (dev-verifisering gjenstår)

## Kontekst

Mål-fanen viste søppel: det interne «Planlegging»-målet (maskineri for oppgavekobling),
tomme skall for skjermtidsmål («Skjermtid under …» uten data-bar) og intensjonsmål uten
måling («Styrke») side om side med ekte målbare mål. Vektmålet på 98 kg var nådd, men sto
som aktivt — ingen livssyklus fantes (ingen skrivere av `status:'completed'`, ingen
nådd/utløpt-deteksjon). «ALDRI meta-titler»-regelen for AI-en var kun prompt-tekst og lakk.

Brukeravklaringer: flere vektmål med ulik horisont er legitimt — løsningen er **filtrert
visning på tidshorisont**, ikke dedup. Fanen skal være **komplett** oversikt: skjermtidsmål
skal visualiseres der, ikke gjemmes. Og søvnmål ønskes (leggetid, oppvåkning, powernaps).

## Faser

### Fase 1: Lekkasjer, horisont-filter, livssyklus, skjermtid-visualisering

**Lekkasjetetting**
- `plan/mal/+page.server.ts` ekskluderer `metadata.isPlanningGoal`.
- Ny ren modul `src/lib/domain/goal-validation.ts` (testet): `isMetaGoalTitle`
  («Planlegging», «Bedre struktur», «Rutiner» → blokkert; «Planlegge bryllupet» → ok),
  `goalHorizon` (frist ≤100 dager eller ingen frist → 'kort', ellers 'lang'),
  `isGoalExpired`, `isWeightGoalReached` (krysset target i målretning),
  `isRunningGoalReached`.
- `create-goal.ts` (delt av chat og assistent via shared-tools): hard guard — meta-tittel
  gir `success:false` med korrigerende melding så modellen lager et konkret mål i stedet.

**Horisont-filter og sortering** (`plan/mal/+page.svelte`)
- Pille-rad: «Neste tre måneder» (default) | «På lang sikt» | «Alle»
  (`data-track="maal:horisont-filter"`).
- Innenfor filteret: mål med måling først (løping/vekt/skjermtid/søvn), så oppgavemål.
  Intensjonsmål uten måling ligger i collapsible «Uten måling» som kompakte rader med
  arkiver-knapp.

**Livssyklus**
- `GoalDetailCard`: «🎉 Nådd»-badge når målbar progresjon har krysset target, «Fullfør»-knapp
  → `PATCH /api/goals/[id]` `{status:'completed'}` (ruten validerer nå status-whitelist
  active/completed/archived). Collapsible «Fullførte mål» med gjenåpne-knapp.
  Utløpt frist uten nådd → diskret «Frist passert»-badge.

**Skjermtid på Mål-fanen**
- Aggregat-lesing ekstrahert fra `/skjermtid`-loaderen til `screen-time-goals.ts`
  (`screenTimeMetricFromAggregate`, `getLatestScreenTimeWeekMetrics`,
  `readScreenTimeGoalMetadata` eksportert).
- Mal-loaderen evaluerer skjermtidsmål mot nyeste uke → `screenTimeEvalMap`;
  `GoalDetailCard` fikk skjermtid-gren med mål-bar (ok/over-farge, basisLabel) og lenke
  til `/skjermtid`.

### Fase 2: Søvnmål (leggetid, oppvåkning, powernaps)

- Ny ren modul `src/lib/domain/sleep-goals.ts` (13 tester): mål-typer `duration`
  (måltimer/natt), `bedtime`/`waketime` ('HH:MM' ± slingring, default 30 min) i
  `goals.metadata.sleepGoal` (ingen schema-endring). **Nap-inferens**: Withings sender
  powernaps som egne korte events uten flagg — regel: start 09–21 lokal Oslo-tid og
  varighet <3t → nap. **Middag-akse** (12:00=0) gjør leggetider rundt midnatt
  sammenlignbare; median siste 7 netter evalueres mot målsonen.
- Tynn DB-side `src/lib/server/integrations/sleep-goals.ts` (speiler screen-time-goals):
  `readSleepNights`, `listSleepGoals`, `createSleepGoal` (idempotent per kind),
  `evaluateSleepGoalsForUser`.
- **Aggregat-bugfiks**: `aggregation.ts` (uke/måned/år) holder naps ute av
  `metrics.sleep`-snittet — de trakk nattsnittet ned.
- **Onboarding-fiks**: `health_sleep_onboarding` hadde form-felt for `targetHours` og
  `bedtimeGoal` men ingen `onComplete` — alt ble kastet. Nå POSTes de til ny rute
  `POST /api/soevn/goals` som oppretter duration-/bedtime-mål.
- Visning: `GoalDetailCard` fikk søvn-gren med `TargetZoneBar` (duration = at_least,
  bedtime/waketime = range rundt måltid) + nap-linje («💤 2 powernaps siste uke»).
  Naps registreres automatisk fra Withings — ingen manuell registrering.

### Fase 3: Manuell powernap-registrering

Withings fanger bare søvn utstyret måler — hvileøkter på sofaen fantes ingen steder.

- **Eksplisitt flagg**: `data.isNap: true|false` på en sleep-event overstyrer inferensen
  (en hvil kl. 21:30 er nap når brukeren sier det). Manuelle naps skrives som vanlige
  'sleep'-events (sensor `manual_nap`, `type: 'manual_log'`) og flyter dermed automatisk
  inn i nap-tellingen og holdes ute av nattsnittet.
- **`logNap`/`deleteNap`/`listRecentNaps`** i server-modulen; ny rute
  `POST/GET/DELETE /api/soevn/nap` (HH:MM tolkes som i dag Oslo-tid via `todayAtLocalTime`,
  testet; DELETE rører aldri sensor-synkede events).
- **Chat-verktøy `log_nap`** («tok en powernap», «hvilte en halvtime i ettermiddag») —
  registrert i både chat og assistent, ett kall per hvil, retroaktiv via time-parameter.
- **Nytt målslag `nap`**: `{kind:'nap', maxPerWeek}` → «Maks 2 powernaps/uke» med
  at_most-sone på Mål-fanen; `POST /api/soevn/goals` tar `napMaxPerWeek`.
- **Hurtigregistrering**: chips (15/20/30/45 min) i ekspandert søvnmål-kort
  (`data-track="maal:registrer-powernap"`), lokal delta-oppdatering av nap-linjen.

## Beslutninger

- **Filter på tidshorisont, ikke kategori-gruppering** — brukervalg; to vektmål med
  måneds- og toårsperspektiv er legitimt og skilles av filteret. Grensen er 100 dager
  (`HORIZON_THRESHOLD_DAYS`); mål uten frist regnes som «pågående nå» → kort sikt.
- **Meta-tittel-guard i verktøyet, ikke bare prompten** — prompt-regler lekker;
  `success:false` med forklaring lar modellen selv reformulere.
- **Nap-regel 09–21 lokal + <3t** — lang dagsøvn (nattskift) regnes som natt; kort
  kveldssøvn regnes ikke som nap.
- **Median (ikke snitt) for leggetid/oppvåkning** — robust mot én sen kveld.
- **sleepGoal i metadata som screenTimeGoal** — selvinneholdt, ingen schema-endring,
  utenfor metric-catalog-systemet.

## Verifisering

- `npm test`: 1391 tester grønne (nye: goal-validation 9, sleep-goals 13).
- `npm run check`: 0 feil.
- Gjenstår i dev: «Planlegging» borte; «Styrke» under «Uten måling»; skjermtidsmål med
  ekte bar; 98 kg-målet viser «🎉 Nådd» → Fullfør flytter til «Fullførte mål»;
  horisont-filteret skiller måneds- og toårsvektmålet; chat nekter «Planlegging»-mål;
  søvn-onboarding oppretter mål som vises med sone-bar og nap-telling.
