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

### Fase 13: Chattene arkiveres og speilet foreslår bursdagsmål

- **«Samtalen er data»**: hele chattene (kropp-og-hode + speilet) arkiveres nå som transkript-refleksjon (kind `birthday_interview_chat`, periodKey = år) med `Du:`/`Resonans:`-linjer. Markør-blokkene strippes fra transkriptet — destillatet bor allerede som seksjoner i selve selvangivelsen. `formatThreadTranscript` (ren, testet).
- **Bursdagsmål**: speil-steget foreslår 2–4 mål frem til neste bursdag (forankret i «Hvor vil du videre» og kavalkade-tallene) og vedlikeholder en `<bursdagsmål>`-blokk brukeren kan justere i chat. Ved levering parses blokken (`parseBirthdayGoals`, ren, testet — «Tittel: 600 km» eller rene intensjonsmål) og opprettes som rader i `goals`: `targetDate` = neste bursdag, `periodKey` = årstall, metadata med target/tracking (running_distance → workout_aggregate, ellers manuell) — samme mønster som ukeplanens mål. Dedupe på `metadata->>'birthdayKey'` + tittel; maks 6.
- Speilets mirror-seksjon lagres uten målblokken.

### Fase 14: Fortellende åpning — Hvem er du nå (chat) → i fjor → hva endret deg

- Åpningen omstrukturert til en narrativ bue. Det gamle «Hvem er du i år?»-skjemaet er nå et **chat-steg «Hvem er du nå?»** (autoSend): AI-en intervjuer om nåtiden — hva opptar deg, hva tror du på, hvordan ville du beskrevet deg selv — og vedlikeholder et `<status>`-selvportrett som lagres som `who`-seksjonen. Ser bevisst ikke bakover ennå.
- Etterfulgt av to nye skjemasteg: **«Hvem var du i fjor?»** (`who_last_year`) og **«Hva endret deg?»** (`what_changed_you`) — den transformative broen mellom fortid og nåtid. Begge nye seksjoner i `INTERVIEW_SECTIONS` rett etter `who`.
- onComplete henter `who` fra `hvem_naa`-chattens status-blokk; «Hvem er du nå?»-tråden arkiveres som egen transkript-seksjon (`birthday_interview_chat`). estimatedMinutes 15 → 18.
- /design: intervju-mock fikk de to nye seksjonene; baseline regenerert.

### Fase 15: Tre nye «se tilbake»-øvelser — brev, bilder, sløyfe

Idémyldring med brukeren landet på tre tilskudd (humørbue valgt bort):

- **Brev til neste år** (tidskapsel): nytt textarea-steg `brev_til_neste_aar` til slutt i selvangivelsen, lagret som `letter_to_future`-seksjon i interview-markdownen. Neste år vises fjorårets brev som eget kort øverst på `/kavalkade` («Brev fra deg for ett år siden») og mates inn i åpningschatten (`_lastYearLetter`). Degraderer grasiøst i år 1. Utelatt fra `formatAnswersAsText`.
- **Årets bilder**: ny `photo-gallery`-felttype i `FlowFormStep` (opplasting via delt `$lib/client/upload-image` → Cloudinary, bildetekst + fjern, maks 6). Nytt steg `aarets_bilder`. Lagres som egen refleksjon `birthday_photos` (JSON, ingen migrasjon — mønster fra `birthday_interview_chat`). Vises som `PhotoGallery`-mosaikk på `/kavalkade` og `photos`-slide i showet. Ren logikk i `birthday-photos.ts` (+ test).
- **Dette ville du i fjor**: `buildBirthdayLoop` (`birthday-loop.ts`, ren + test) holder fjorårets bursdagsmål (`goals` der `metadata.birthdayKey` = i år) og fjorårets spådom opp mot faktisk. Ærlighetsregel: «Oppnådd» kun med ekte tall ≥ mål eller status `completed`, ellers «Uvisst». Løpemål kryssjekkes mot kavalkadens km. `LoopCard` på `/kavalkade` + `loop`-slide i showet.

Felles: `KavalkadeData` fikk `photos` + `loop`; `ShowSlideDef` fikk `photos`- og `loop`-kinds (begge skjult i år 1). /design fikk PhotoGallery- og LoopCard-demoer + slidene; baseline regenerert. Ingen schema-migrasjon. estimatedMinutes 15 → 18.

### Fase 16: Oppdagbarhet

- `src/lib/server/chat-router.ts`: `bursdag|fødselsdag|kavalkade` ruter til self-domenet med hint om `/kavalkade`. Test lagt til i `chat-router.test.ts`.

### Fase 17: Opprydding — lekkasjefiks, sterkere modell og strammere bue

Brukertesting av selvangivelsen avdekket fire ting: chatten lakk interne markør-blokker, skjemafelt var blanke i fokusmodus, chat-stegene følte seg som en liten modell, og flere skjemasteg overlappet med chattene.

- **Markør-lekkasje fikset:** `parseChatMessage` (flow-helpers.ts) strippet bare `<oppgaver>`/`[PLAN_KLAR]`. AI-ens løpende `<status>`- og `<bursdagsmål>`-blokker ble dermed vist rått i hver melding — det så ut som «en oppsummering av svarene mine» og «et internt skjema som lekker». Begge blokkene strippes nå fra visningen (råteksten beholdes i `rawText` for onComplete-parsing). Tester i `flow-helpers.test.ts`.
- **Blanke felt fikset:** `FlowFormStep` skjulte feltlabels i fokusmodus (`{#if !isFocus}`), så «Årets beste» ble en rad anonyme inputs. Labels vises nå for alle felttyper unntatt slider (som bruker stegtittel + helperLabels).
- **Sterkere modell:** Ny `Flow.chatModel` kobles til `ChatState.preferredModel` i `FlowSheet`. Selvangivelsen settes til `gpt-5.4` — en dyp, refleksiv samtale uten verktøybehov.
- **Strammere bue (12 → 11 steg):** Fjernet de overlappende skjemastegene «Siden i fjor» (endret/begynt/sluttet — dekkes av «Hva endret deg?»- og «Hvem var du i fjor?»-chattene) og «Mål og retning». «Rollene dine» fikk en forklarende intro. Alle chat-steg får nå kavalkade-kontekst (trening, søvn, vekt, **lesing**), ikke bare de tre som hadde det før. Status-blokk-instruksjonene presiserer at blokken er intern — ingen «her er oppsummeringen»-prosa, ingen gjentakelse av svarene tilbake.
- **«Om et år» som egen chat:** Det forrige `direction`-skjemafeltet (som matet showets «Dit du vil»-slide) ble til et eget chat-steg som lukker buen *nå → da → endringen → om et år*. AI-en holder et `<status>`-fremtidsbilde som lagres som `direction`-seksjonen og arkiveres som transkript (`birthday_interview_chat`). `reflections/birthday`-endepunktet arkiverer den nye tråden.
- Historiske seksjoner (`goals_past`, `changed`, `started`, `stopped`) beholdes i `INTERVIEW_SECTIONS` for å parse fjorårets selvangivelser, men samles ikke lenger som egne steg.

## Verifisering Fase 17

- `npm run check`: 0 feil, 0 advarsler. `npm test`: alle tester grønne (nye parseChatMessage-tester).

### Fase 18: Robust chat — tapt forbindelse henger ikke lenger

Brukerinnsikt: «Kroppen og hodet» (og andre chat-steg) så ut til å krasje når mobilen bakgrunnet appen mens vi ventet på et LLM-svar. Årsak: strømmen ble verken avbrutt eller feilhåndtert synlig — `flowChat.error` ble aldri vist i chat-steget, og en død forbindelse ga enten evig spinner eller en tom skjerm uten vei videre.

- **Watchdog i `ChatState`**: en stillhets-timer (60 s, nullstilles ved hver status/token) avbryter en strøm som har stoppet å levere, og flagger det som tapt forbindelse i stedet for brukerstopp.
- **Bakgrunns-deteksjon i `FlowSheet`**: `visibilitychange` — var siden borte > 10 s mens chatten lastet, regnes strømmen som tapt ved retur (`markConnectionLost`), så brukeren får retry umiddelbart i stedet for å vente på watchdog-en.
- **Avbryt ved lukking**: `onDestroy` stopper en pågående strøm så den ikke henger igjen.
- **Feil + retry i UI**: `FlowChatStep` viser nå `flowChat.error` med en «Prøv igjen»-knapp (`flowChat.retry()`), så et tapt svar er gjenopprettelig.

### Fase 19: «Start på nytt» + trygg steg-bytting midt i en strøm

- **«Start på nytt»-knapp**: gjenopprettingsbanneret for resumable flows er nå handlingsbart — forkaster utkastet, nullstiller svarene og går til første steg. Banneret auto-skjules ikke lenger (har en ✕ i stedet) så reset-valget er reachable. Chat-init trukket ut til delt `initChatStep()`.
- **Overlappende send fikset**: trykket man «Neste» mens et chat-steg fortsatt strømmet, kolliderte forrige stegs svar med det neste (lekkende melding, blokkert autoSend, hengende «Starter…»). `ChatState` har nå en generasjonsteller: `reset()` invaliderer et in-flight kall slik at dets sene callbacks/feil/opprydding blir no-ops, og `FlowSheet` kaller `flowChat.reset()` ved hvert steg-bytte. Et halvferdig svar avbrytes rent i stedet for å lekke inn i neste steg.

### Fase 20: Kavalkade-chip på selve bursdagen

Brukerinnsikt: på bursdagen var hjemskjermen taus om kavalkaden. «Selvangivelsen»-chipen er designet til å forsvinne på dagen («løpet er kjørt»), men ingenting tok over — så akkurat når selve gevinsten (kavalkaden/showet) skulle dukke opp, var det ingen vei inn fra hjem. Brukeren forventet kavalkade/show på bursdagen.

- `action-producers/birthday-kavalkade.ts` (ny): chip 🎉 fra bursdagen (dag 0) og `KAVALKADE_VINDU_DAGER` (7) dager etter. På selve dagen «Gratulerer med dagen! — spill av året» med høyeste prioritet (99, over selvangivelsens 95) og navigasjon rett til `/kavalkade/show`; dagene etter «Årskavalkaden — året i tall» (prioritet 70) til `/kavalkade`. `navigate`-intent trenger ingen klient-wiring (håndteres allerede i `HomeScreen`).
- Ren datologikk i `kavalkade.ts`: `daysSinceLastBirthday` (0 = i dag) og `visKavalkadeChip`, begge testet. Speiler dato-aritmetikken i `getBirthdayWindows`.
- Registrert i `action-suggestion-service.ts`. Samtidig rettet en gammel skjevhet i `PRODUCER_NAMES` (perf-logging) — lista startet på det fjernede `sjekk-inn` og forskjøv alle etiketter med én.

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
