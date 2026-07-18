# Livskompasset — ukentlig verdikompass

Dato: 2026-06-16
Status: ferdig

## Kontekst

Brukerens psykolog (ACT-spesialist) anbefalte «Livskompasset» som modell for ukentlig
innsjekk: del livet i verdiområder og score hvert område på to akser — *hvor viktig er
dette for meg* og *hvordan samsvarte uka som gikk med det*. Gapet mellom de to er signalet.

Dette utfyller den eksisterende egenfrekvensen, som måler en annen akse:

- **Egenfrekvens** = tilstand/overskudd over tid, daglig, flere slots per dag.
- **Livskompasset** = verdi-samsvar, ukentlig (helg), ett kompass per uke.

Kjernen i ACT-modellen er at lavt samsvar bare er et problem når dimensjonen *også* er
viktig. Det som er «ute av synk» = høy viktighet + lavt samsvar. Det er det chatten tar tak i.

## Faser

### Fase 1: Prototype på /design
Spillbar prototype i `src/routes/design/sections/livskompasset.svelte` for å kjenne på
interaksjonen (scoring → kompass → chat) før datalag. Itererte på dimensjonsliste og pynt
(senterhull, etiketter på fast ytre radius).

### Fase 2: Delt domenekonfig
`src/lib/domains/livskompass/dimensions.ts` — eneste kilde for områder, dimensjoner, farger,
terskler og ren logikk (`computeOutOfSync`, `averageMatch`, `buildChatSeed`, `localIsoWeek`).
12 dimensjoner i 4 områder (Relasjoner / Helse / Arbeid / Fritid & mening). Enhetstester i
`dimensions.test.ts` (12 tester).

### Fase 3: Server + API
- `src/lib/server/livskompass-checkin.ts` — lagrer i `sensor_events` med
  `dataType: 'livskompass_checkin'` (ingen ny tabell, speiler egenfrekvens-mønsteret).
  Viktighet forhåndsutfylles fra forrige registrerte uke (`prefillImportance`).
- `src/routes/api/livskompass/checkin/+server.ts` — GET (status + `isWeekendNow`), POST, DELETE.

### Fase 4: Komponenter
- `LivskompassWheel.svelte` — gjenbruker `RadialSectorChart` (utvidet med `labelRadiusFraction`).
  Fylt ark = samsvar, svak bakgrunnsark = viktighet → gapet er synlig.
- `LivskompassCheckin.svelte` — fullskjerm scoring → resultat, med chat-handoff.
- `LivskompassWidget.svelte` — hjem-widget (mini-hjul + antall ute av synk).
- `/design`-seksjonen rendrer nå de faktiske komponentene (levende dok).

### Fase 5: Hjemskjerm-integrasjon
Speiler egenfrekvens-slot-mønsteret i `HomeScreen.svelte` / `HomeOverlays.svelte` /
`home-context.ts` / `HomeWidgetZone.svelte`:
- **Helgegate**: fullskjerm i helga (lør/søn/helligdag) om uka ikke er tatt.
- **Chip**: dismisset → chip i handlingssonen til uka registreres.
- **Widget**: vises når et kompass er registrert.
- **Chat-handoff**: «Snakk om det» seeder chatten med de største gapene.

### Fase 6: Onboarding + begge akser på 1–10 (2026-06-19)
Begge akser flyttet fra 1–5 til **1–10** — både viktighet (onboarding-ranking) og ukens samsvar.
Like skalaer betyr at gapet er rett differanse (`gap = viktighet − samsvar`), ingen normalisering;
ute av synk = viktighet ≥6 og gap ≥3. Ankerord via `matchLabel`/`importanceLabel`. `NEUTRAL_MATCH = 5`
er startverdi for samsvar-slideren.
- **Onboarding-steg** i `LivskompassCheckin`: «Hva betyr mest for deg? Ranger viktigheten 1–10».
  Vises første gang (`needsOnboarding`), lagres som egen profil (`dataType: 'livskompass_importance'`)
  via `POST /api/livskompass/importance`, deretter fortsetter brukeren rett inn i ukas samsvar-scoring.
- Viktighet forhåndsutfylles nå fra: denne ukas innsjekk → nyeste innsjekk → onboarding-profil → defaults.
- Viktighets-markøren og samsvar-thumben deler samme spor-posisjon siden begge er 1–10.

### Fase 6b: Gap-relative samsvar-ankerord (2026-07-18)
`matchLabel` var absolutt (avstand fra 10: «Langt unna» … «Helt på linje») og kranglet med
gap-modellen: viktighet 3 / samsvar 3 fikk «Litt unna» selv om uka traff akkurat det brukeren
ønsket, og viktighet 10 / samsvar 8 fikk «Ganske på linje» tross et reelt gap. Nå tar
`matchLabel(match, importance)` begge akser og setter ord på gapet: «Langt under det viktige»
(gap ≥5), «Klart under det viktige» (gap ≥3, speiler ute-av-synk-terskelen), «Litt under»
(gap ≥1), «På linje» (gap −2…0), «Mer rom enn viktigheten tilsier» (gap ≤ −3). Tallet
`(n/10)` vises fortsatt rått ved siden av.

### Fase 7: Funn via egenfrekvens-temaet + helge-nudge (2026-06-20)
**Oppdagbarhet:** Livskompasset vises nå i Egenfrekvens-temaets data-fane (`ThemeDataTab`, gated på
`activeDashboardKind === 'egenfrekvens'`) som `LivskompassWidget`. Tapp → `goto('/?flow=livskompass')`.
Ny deep-link-håndtering i `HomeScreen.onMount` (`flow=livskompass`) laster status og åpner kompasset.

**Helge-nudge:** ukentlig nudge (Google Chat + Web Push) lørdag morgen, speiler egenfrekvens-nudgen:
- `src/lib/server/livskompass-nudges.ts` — `runLivskompassWeekendNudges`. Per bruker: lørdag i egen
  tidssone + tidsvindu (default 09:00, 15-min vindu) + ikke allerede tatt denne uka (`status.submitted`).
  Default på; bruker kan slå av via `notificationSettings.livskompassetWeekend.enabled = false`.
- `src/routes/api/notifications/livskompasset-weekend/+server.ts` — GET/POST, `withCronTracking` + CRON_SECRET.
- Cron-jobb i `/api/cron/jobs`: `*/15 * * * 6` (lørdag UTC).
- Nye union-verdier: `NotificationRouteKey += 'livskompassetWeekend'`, `nudgeType += 'livskompasset_weekend'`.
- Ruting faller tilbake til `['pwa', 'chat:default']` (default for ikke-dailyCheckIn-nøkler), så push
  virker uten ekstra oppsett.
- Deep-link `/?flow=livskompass&nudgeEventId=…` sporer `flow_started` på nudge-eventet som egenfrekvens.

### Fase 8: ACT-coaching i chatten + fjernet hjem-widget (2026-06-20)
**Fjernet** livskompass-kortet fra hjemskjermens widget-pager — den sonen er for små runde
metric-widgets, og et fullbreddes kort tok en hel pager-side og brakk den kompakte layouten.
Flatene er fortsatt: helgegate, chip, Egenfrekvens-temaets dashboard og helge-nudgen.

**ACT-coaching i chatten:** «Snakk om det» åpner nå en chat med et system-prompt-prefiks som gjør
AI-en til en ACT-coach. Etter psykologens modell: sett et lite mål om å heve de 2–3 største avvikene
ETT poeng neste uke, med konkrete grep.
- `buildCoachingSystemPrompt(scores)` + `buildCoachingSeed(scores, note)` i `dimensions.ts` (rene,
  testede funksjoner). Prompten lister de største gapene og instruerer coaching-atferden.
- Sendes som `systemPrompt` fra `LivskompassCheckin` → `ChatState` → server bruker det som
  `systemPromptPrefix` (legges *på toppen* av den vanlige modulære prompten — bok-chat-mønsteret).
- Ny `startLivskompassCoachingChat(seed, systemPrompt)` i `HomeScreen`: fersk samtale med prefikset
  aktivt for hele samtalen, ryddes i `closeChat`/`startHomeChat` så det ikke lekker til andre chatter.

### Fase 9: Tiltak fra chat → ukelista (2026-06-20)
Coaching-chatten kan nå føre avtalte, målbare tiltak rett på en ukes sjekkliste — typisk neste uke.
- Nytt AI-verktøy `add_to_week_plan` (`src/lib/ai/tools/add-to-week-plan.ts`): `{ weekOffset, items }`.
  Finner-eller-oppretter ukas liste (`context = week:YYYY-Www`, default neste uke), tolker frekvens
  i teksten via `parseListRepeatCount` («Skjermfri 16–19 tre kvelder» → tre punkter) og klokkeslett
  via `buildChecklistItemFields` («kl. 21» → metadata). Speiler innsetting fra `add_checklist_items`.
- Registrert i `/api/chat/+server.ts` (verktøydefinisjon + handler i verktøy-loopen). Coaching-chatten
  går via `_runChatRequest`, så verktøyet er tilgjengelig der.
- `buildCoachingSystemPrompt` instruerer AI-en om å bruke verktøyet (weekOffset=1) når dere blir enige
  om tiltak og brukeren vil føre dem opp.

### Fase 10: Lukket mål-sløyfe — ukesmål spores fra coaching til neste innsjekk (2026-07-18)
Coachingens ett-poengs-mål forsvant tidligere i ukelista som anonyme punkter: ingen kobling til
dimensjon, ingen persistert intensjon, og neste innsjekk visste ingenting om målet. Nå lukkes sløyfa:

- **Dimensjons-tagging:** `add_to_week_plan` tar punkter som `{ text, dimension? }` (strenger støttes
  fortsatt). Gyldig dimensjons-id (validert i `normalizeWeekPlanItems`, `week-plan-items.ts`) stempler
  item-metadata med `source: 'livskompass'` + `livskompassDimension`. Begge tool-schemas oppdatert
  (chat-endepunktet med enum fra `LIVSKOMPASS_DIMENSION_IDS`, assistentens shared-tools).
- **Persistert intensjon:** dimensjons-taggede kall skriver et `livskompass_goal`-sensor-event
  (`recordLivskompassGoals`): `{ week, goals: [{ dimensionId, fromMatch, target }] }` der fromMatch
  hentes fra siste innsjekk og target = fromMatch + 1 (capped på 10). Flere events for samme uke
  flettes ved lesing (nyeste vinner per dimensjon).
- **Status-berikelse:** `getLivskompassStatus` returnerer nå `previous` (siste innsjekk før uka) og
  `weekGoals` (ukas mål + tiltaksstatus talt opp fra ukelistas taggede punkter).
- **Innsjekk-UI:** spøkelses-markør under slider-sporet viser forrige ukes samsvar; dimensjoner med
  mål får «🧭 Ukas mål: 2 → 3 · tiltak 2/3»; resultatsteget åpner med «Målet fra forrige helg»
  (✓/·-liste). Coaching-prompt og seed får mål-utfallet (`evaluateWeekGoals`/`describeGoalOutcome`),
  og prompten instruerer modellen om å tagge nye tiltak med dimensjon.
- **Ukeplan/hjem:** `ChecklistItemRow` viser 🧭 på punkter med `source: 'livskompass'`.
- **Mål-stripe i ukeplanen:** `LivskompassGoalStrip` over ukelista viser ukas kompass-mål
  («🧭 Ukas kompass-mål: Egen tid 2 → 3 · tiltak 1/2») med dimensjonsfarge og live tiltakstelling
  fra klient-staten (`livskompassGoalViews` i `week-tasks-logic.ts`). Målene lastes i
  `+page.server.ts` via `getLivskompassGoalsForWeek` for den viste uka (også historiske uker).
  Rendrer ingenting uten mål → ingen visuell baseline-churn.
- Drive-by: sensor-config `sliderRange` rettet fra `'1_5'` til `'1_10'` (stalt etter fase 6).

## Beslutninger

- **Gapet er signalet**, ikke samsvaret alene. `computeOutOfSync` krever gap ≥2 og viktighet ≥3.
- **Viktighet forhåndsutfylles** fra forrige uke og justeres ved behov (toggle), så helgerutinen
  hovedsakelig er samsvar-scoring — lav friksjon.
- **Daglig sjekkin vinner ved kollisjon**: på helgemorgener viker kompasset til chip om den
  daglige slot-sjekkinnen tar fullskjermen (egenfrekvens er hovedkontaktflaten per VISION).
- **Ingen visuell baseline-churn**: livskompass-data lastes kun utenfor webdriver, så
  hjem-widgeten dukker ikke opp i piksel-diff-testene.

## Verifisering

- `npm run check` — 0 feil.
- `npm test` — 574 tester grønne (inkl. 12 nye for `dimensions.ts`).
- `npm run build` — OK.
- Ny visuell baseline `design-livskompasset.png`. Øvrige visuelle diff er forhåndseksisterende
  miljø-/datadrift (klokke, vekt, skritt, gjeldende uke), ikke fra denne endringen.
