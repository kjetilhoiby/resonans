# Årskavalkade og bursdagsintervju

Dato: 2026-06-11
Status: ferdig

## Kontekst

Brukeren har bursdag om en uke og ønsket seg to ting: en **årskavalkade** (året i tall — løpt, gått, lest osv.) og et **«hvem er du i år, hvem var du i fjor»-intervju** med spørsmål som «hva har endret seg», «hva har du begynt/sluttet med», «hva husker du best» og årets beste konsert/bok/film/teaterstykke.

Poenget med intervjuet er akkumulering: svarene lagres per år, slik at neste års intervju og kavalkade kan holde årets svar opp mot fjorårets.

## Faser

### Fase 1: Bursdagsintervju-flow

- `src/lib/flows/birthday-interview.ts` (ny): Spørsmålsdefinisjoner (`INTERVIEW_SECTIONS`) og markdown-formatet svarene lagres i. `buildInterviewMarkdown`/`parseInterviewMarkdown` gir tapsfri tur-retur via stabile `## `-overskrifter — det er sånn neste års intervju leser fjorårets svar. Rene funksjoner med tester i `birthday-interview.test.ts`.
- `src/lib/flows/types.ts` + `registry.ts`: Ny flow `birthday_interview` (🎂, domain `self`, fokusmodus). Fire skjemasteg (hvem er du i år / siden i fjor / hva husker du best / årets beste) og et avsluttende chat-steg («Året i speilet») der AI-en speiler årets svar mot fjorårets og kavalkade-tallene. Fjorårskontekst mates inn via `context.initialData` (`_lastYearAnswers`, `_kavalkadeSummary`) som `buildPrompts` leser fra flowData.
- `src/routes/api/reflections/birthday/+server.ts` (ny): Lagrer intervjuet med `upsertReflectionForPeriod` — kind `birthday_interview`, periodKey = årstall. Upsert gjør at intervjuet kan tas på nytt samme år. AI-ens speiling lagres som egen seksjon (`mirror`).
- `src/lib/server/reflections.ts`: `birthday_interview` lagt til i `ReflectionKind`.

### Fase 2: Årskavalkade

- `src/lib/server/kavalkade.ts` (ny): Rene beregningsfunksjoner. `getBirthdayWindows` regner bursdagsår (forrige bursdag → neste, fra self-personens `birthDate`; fallback siste 365 dager). `summarizeYear` aggregerer treningsøkter per sport (fra `workout_daily_aggregates`), skritt/søvn/vekt/skjermtid (fra månedsraden i `sensor_aggregates`) og ferdigleste bøker (`books.finishedAt`). `formatKavalkadeForPrompt` lager AI-kontekst. Tester i `kavalkade.test.ts`.
- `src/routes/kavalkade/` (ny side): «Året i tall» med i-år-vs-i-fjor per metrikk, bokliste, årets intervjusvar, fjorårets svar («Hvem var du i fjor?») og start-knapp for intervjuet via `FlowSheet`. Bygget på `SectionCard`/`SectionLabel` og AppPage-tokens.

### Fase 3: «Tenk stort» — ordsky, tidslinje og AI-magi

- `src/lib/server/ordsky.ts` (ny): Ren ordfrekvens-beregning med norsk tokenisering og grammatisk stoppordliste (innholdsverb som «rydde»/«kjøpe» beholdes med vilje). Mates med årets sjekkliste-oppgaver (`checklist_items`) og rendres som vektet ordsky på siden. Tester i `ordsky.test.ts`.
- `buildMonthTimeline` i `kavalkade.ts`: Måned-for-måned-tidslinje for bursdagsåret — toppsport, antall økter, skritt, bøker fullført den måneden og månedens overskrift fra `plan_artifacts` (kind `month`). Grensemåneder telles bare i snittet måned ∩ vindu. Tester lagt til.
- `src/lib/kavalkade-magi.ts` (ny, delt klient/server): Markdown-format for bursdagshilsner (`## Karakter — Bok`), tapsfri tur-retur. Tester i `kavalkade-magi.test.ts`.
- `src/routes/api/kavalkade/magi/+server.ts` (ny): To GPT-4o-genererte innslag, lagret som refleksjoner (kind `birthday_prophecy` / `birthday_greetings`, periodKey = år, upsert ved regenerering):
  - **Spådommen**: spåkone-tekst om året som kommer, basert på kavalkade-tall, tidslinje, ordsky-toppord og intervjusvar (i år + i fjor).
  - **Hilsner fra bokhylla**: bursdagshilsner fra sentrale romankarakterer i årets ferdigleste bøker (fallback fjorårets), i karakterens egen stemme.
- `src/lib/server/kavalkade-data.ts` (ny): Felles datalaster for siden og magi-endepunktet — page-serveren ble en tynn wrapper.

### Fase 4: Komponentuttrekk og /design-demo

- De visuelle blokkene ble trukket ut av siden til props-drevne komponenter i `src/lib/components/domain/kavalkade/`: `KavalkadeStats`, `Ordsky`, `MonthTimeline`, `GreetingsList`, `InterviewAnswerList` (+ delte UI-typer i `types.ts`). `/kavalkade`-siden komponerer nå disse.
- Ny `/design`-seksjon «Kavalkade» (mellom Ukeplan og Sheets) demoer alle fem med deterministiske fixtures i `design/mocks.ts`. Seksjons-id lagt til i `tests/visual/pages.spec.ts`, og baseline `design-kavalkade.png` generert.
- `playwright.config.ts`: readiness-URL endret til `/design` (public path) — rot-siden krever DB og ga 500 i miljøer uten, slik at webServer-sjekken aldri ble grønn.

### Fase 5: Fullskjerm-show («Spotify Wrapped»)

- `show-slides.ts` (domain/kavalkade): `buildShowSlides` — ren funksjon som bygger slide-sekvensen fra årsdataene: intro → sport-tall (maks 3) → økter → skritt → bøker → ordsky → månedshøydepunkter → minnet → årets beste → hilsner fra bokhylla → spådoms-teaser → outro. Tomme datakilder hoppes over; hver slide får hue fra et fargehjul og egen varighet. Tester i `show-slides.test.ts`.
- `ShowSlide.svelte`: én fullskjerm-slide — ord-for-ord-typografi-reveal, count-up-tall (rAF med ease-out), drivende gradient-blobs (transform-animert, kompositor-vennlig). `animate={false}` fryser slutt-tilstand (for /design og visuell regresjon); `prefers-reduced-motion` respekteres. Display-typografi bruker `clamp()` med vilje — plakat-tekst, ikke kort-innhold.
- `KavalkadeShow.svelte`: story-spiller — segmentert progresjonsbar, tap-soner (venstre/høyre), piltaster + Escape, auto-fremdrift per slides varighet, crossfade mellom slides. Stopper på outro.
- Rute `/kavalkade/show` (samme datalaster) + «▶ Spill av året»-knapp øverst på `/kavalkade`.
- `/design`: tre frosne ShowSlide-demoer i kavalkade-seksjonen (baseline regenerert) + live-demo med full animasjon på `/design/kavalkade-show` (public path, mock-data, ikke i visuell regresjon).

### Fase 6: Farger og konfetti

- `Konfetti.svelte` (domain/kavalkade): CSS-konfettiregn med deterministisk «tilfeldighet» (golden ratio-spredning, ingen `Math.random` — /design er i visuell regresjon). Negative animation-delays gir fullt felt fra første frame; `animate={false}` og `prefers-reduced-motion` fryser bitene som et spredt drys. Regner over show-outroen alltid, og introen på selve bursdagen (`confetti`-flagg i `buildShowSlides`, testet).
- Fargeløft i `ShowSlide`: tredje gradient-blob med komplementærfarge (screen-blend), mer mettede blobs, gradient-tall (background-clip: text, hue → hue+75), flerfarget ordsky (hue per ord) og hued punktmarkører i lister.
- Fargeløft på `/kavalkade`-siden: hver statboks får egen kulør fra showets fargehjul (venstre kant, gradient-bakgrunn, farget verdi); side-ordskyen er også flerfarget.
- /design: outro-slide med frosset konfetti-drys lagt til i show-demoene; baseline regenerert.

### Fase 7: Selvangivelsen som hurtighandling med frist

- Intervjuet heter nå **«Selvangivelsen»** (flow-navnet i registry) og har eksplisitt frist: **midnatt kvelden før bursdagen**.
- `action-producers/birthday-interview.ts` (ny): chip i hurtighandling-stripa på hjemmeskjermen i vinduet 7 dager før bursdagen (self-personens `birthDate`, beregnet i brukerens tidssone). Frist-etikett skjerpes mot slutten («frist om N dager» → «frist i morgen» → «frist i kveld», prioritet 85 → 95). Forsvinner når intervjuet er levert for året (reflections-oppslag) og på selve bursdagen — da er løpet kjørt. Ren fristlogikk (`selvangivelseFristLabel`, `SELVANGIVELSE_VINDU_DAGER`) i `kavalkade.ts` med tester.
- Klient-wiring etter eksisterende mønster: dispatch-case i `HomeScreen.svelte` + FlowSheet i `HomeOverlays.svelte`. Chipen henter først kontekst fra nytt endepunkt `/api/kavalkade/interview-context` slik at speil-steget får fjorårssvar og kavalkadetall også når flyten startes fra hjem.
- `/kavalkade`-CTA-en speiler fristen i kortteksten og knappen heter «Lever selvangivelsen».
- NB: hjem-baselinen (visuell regresjon) vil vise chipen i bursdagsvinduet — forventet diff ved neste lokale kjøring.

### Fase 8: Fødselsdato i profil-UI

- Brukerinnsikt: fødselsdato fantes i datamodellen (`persons.birthDate`, redigerbar i familie-UI-ets `PersonEditSheet`) men ikke i profilseksjonen på `/settings` — og uten en ekte self-person syntetiserer `/api/persons` bare en virtuell med `birthDate: null` som ikke kan lagres. Hele bursdagsrigget sto dermed uten datakilde for nye brukere.
- Nytt felt «Fødselsdato» i Profil-kortet på `/settings` (DateInput + lagre med statusknapp), lagret via nytt endepunkt `PUT /api/profile/birthdate` som oppdaterer self-personen — eller oppretter den (kind `self`, navn fra users) hvis den bare var virtuell.

### Fase 9: Utkast — festskinn (fulle farger som bakgrunn)

- `ShowSlide`/`KavalkadeShow` får `skin`-prop: `'dark'` (default) | `'fest'`. Festskinnet lar mettet farge ta over hele slide-bakgrunnen (gradient i slidens hue, lysere/mørkere blobs i screen/multiply-blend, hvit typografi, hvitt count-up-tall med fargeskygge). I appen: `/kavalkade/show?skin=fest`.
- Plakat-utkast for kavalkade-kortene på `/design/kavalkade-fest` (public, mock-data, ikke i visuell regresjon): hver seksjon én mettet kulør, implementert som rene token-overrides (`--card-*`, `--text-*`, `--section-label-color` + nye komponent-tokens `--kv-stat-bg/edge/value-color`, `--kv-ord-color`, `--kv-greeting-edge`) — komponentene er uendret appens faktiske.
- Mørk/Fest-veksler på live-demoen `/design/kavalkade-show`. Tas skinnet i bruk, flyttes overridene til `/kavalkade` og demoen opp fra utkast.

### Fase 10: Grafer og bokstav-strøm

- `buildSportHistory` i `kavalkade.ts` (ren, testet): per toppsport månedsserie for inneværende bursdagsår + årstotaler bakover så langt det finnes data (maks 6 år, km for distansesporter, økter ellers). Datalasteren henter nå hele treningshistorikken (`workout_daily_aggregates` uten datogulv).
- Sport-slidene i showet får **månedssøyler** (staggered scaleY-grow) og **år-for-år-løp** (horisontale barer, inneværende år i gradient) under hero-tallet. År-for-år vises bare med minst to år; måneder bare når noe er > 0.
- **Bokstav-strøm**: intro-/outro-titler strømmer inn tegn for tegn (CSS, ord-wrappet med blur-inn); quote-tekst strømmer som chat (rAF, `STREAM_CHARS_PER_SEC = 75`) med blinkende caret. Hilsner fra bokhylla åpner med «**{karakter} skriver** …»-indikator (pulserende prikker) før teksten tikker inn — attribusjonen fades inn når strømmen er ferdig. Quote-varigheter beregnes av strømlengden (`quoteDuration`).
- `prefers-reduced-motion` dekker nå også JS-animasjonene (count-up og strøm hopper til slutt-tilstand via matchMedia).
- /design: frossen stat-demo viser grafene, hilsen-demoen har writer; baseline regenerert. Live-demoens mock-input fikk sporthistorikk.

### Fase 11: Selvangivelsen v2 — fire spørsmål, roller og kropp-og-hode-chat

- Brukerinnsikt: selvangivelsen skal få på det rene **hvor var jeg i fjor → hva ville jeg oppnå → hvordan ble veien → hvor vil jeg videre**, på tvers av psykisk helse/vekt/trening/søvn og rollene (pappa, partner, venn, ansatt) — og tunge punkter skal kunne chattes videre på, ikke bare krysses av i skjema.
- Nye seksjoner i `INTERVIEW_SECTIONS` (stabil markdown-kontrakt som før): `role_dad/role_partner/role_friend/role_work`, `health_talk`, `goals_past`, `direction`.
- Nye flow-steg: **Rollene dine** (skjema, fire textareas) → **Kroppen og hodet** (chat, autoSend): AI-en intervjuer om psykisk helse/vekt/trening/søvn langs de fire spørsmålene, med kavalkade-måledata og fjorårets selvangivelse i prompten («vekta gikk fra X til Y — var det planen?»). AI-en vedlikeholder en `<status>`-blokk per melding (inbox-mønsteret); `parseStatusBlock` (ren, testet) henter den i onComplete som seksjonsinnhold → **Mål og retning** (skjema: `goals_past` + `direction`).
- Speil-steget tilbyr eksplisitt å chatte videre på enkeltsvar. Chat-stegene er ekte flersvingssamtaler — «Neste» trykkes når man er ferdig.
- Showet får en «Dit du vil»-quote-slide når `direction` er besvart. estimatedMinutes 10 → 15.
- «Årets beste» beholdt og utvidet med **beste sang** og **beste tur** (seksjoner, skjemafelt og show-sliden).

### Fase 12: Gjenopptakbare utkast

- Flows kan nå merkes `resumable: true` (kun selvangivelsen foreløpig): `FlowSheet` lagrer flowData + steg fortløpende i localStorage (`flow-draft:{flowId}`) og gjenoppretter ved neste åpning med en «Fortsetter der du slapp»-notis. Utkastet ryddes ved levering; eldre enn 14 dager ignoreres; `initialData` (kontekst per åpning) overstyrer alltid utkastets kontekstnøkler.
- Ren utkast-logikk (`serializeFlowDraft`/`parseFlowDraft`/`flowDraftKey`) i `flow-helpers.ts` med tester (versjon, flow-id, alder, korrupt JSON).
- Begrensninger: per enhet (localStorage, ikke kryss-enhet), og forlater man midt i et chat-steg starter det steget på nytt — fullførte stegs svar (inkl. chat-tråder) overlever.
- Verifisert live i Chromium: fyll ut → reload → gjenopptatt på riktig steg med feltverdier intakt.

### Fase 13: Oppdagbarhet

- `src/lib/server/chat-router.ts`: `bursdag|fødselsdag|kavalkade` ruter til self-domenet med hint om `/kavalkade`. Test lagt til i `chat-router.test.ts`.

## Beslutninger

- **Lagring i `reflections`, ikke ny tabell.** Intervjuet er én refleksjon per år med strukturert markdown — ingen schema-endring eller migrasjon nødvendig. Parsing skjer mot de stabile overskriftene i `INTERVIEW_SECTIONS`.
- **Bursdagsår, ikke kalenderår.** Kavalkaden går fra forrige til neste bursdag (self-personens `birthDate` i `persons`). Uten fødselsdato: siste 365 dager.
- **Månedsaggregater telles i året de starter i.** Grensemåneden rundt bursdagen havner helt i ett av årene — enkel og forutsigbar avgrensning fremfor dag-presis splitting.
- **Vektendring krever minst to måneder med data**, ellers vises bare nivået.
- **Kavalkade-modulen ligger i `$lib/server`** (brukes kun server-side); norske sport-etiketter («løpt», «gått») mappes derfor på i page-serverens load i stedet for å importeres i klienten.

- **AI-innslagene genereres på forespørsel, ikke ved sidelast.** Spådom og hilsner koster et LLM-kall; knapp + lagret refleksjon gjør siden rask og resultatet stabilt til brukeren ber om nytt.

## Verifisering

- `npm test`: 464 tester grønne (41 nye: intervju-format, kavalkade-beregning, tidslinje, ordsky, hilsen-format, show-slides inkl. konfetti-flagg, router-trigger).
- Showet verifisert live i headless Chromium mot `/design/kavalkade-show`: intro-typografi, count-up midt i animasjon, skritt-/bok-slides og progresjonsbar fanget i screenshots.
- `/design`-seksjonen verifisert med Playwright i dev-server (dummy-env): alle fem demoer rendrer, baseline `design-kavalkade.png` sjekket inn. NB: eksisterende design-baselines viser små font-renderingsdiffs (0.04–0.09) i agent-containeren — uavhengig av denne endringen; den nye baselinen bør re-genereres lokalt ved neste `test:visual:update` hvis den diffes.
- `npm run check`: 0 feil, 0 advarsler.
- Visuelle tester ikke berørt — ingen av de 5 baseline-sidene er endret; `/kavalkade` er ny side utenfor baseline-settet.
