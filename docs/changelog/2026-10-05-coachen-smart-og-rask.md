# Coachen: smart og rask

Dato: 2026-10-05
Status: pågår (fase 1–4 ferdig, fase 5 måler)

## Kontekst

Brukerintervjuet til redesignet (oktober 2026) ga et tydelig funn. Brukeren velger
chatgpt.com som coach selv om Resonans har dataene, og alle fire grunnene ble krysset
av: smartere svar, én tråd, «det bare virker» og hukommelse. Det skarpeste beviset
kom i oppfølgingen: brukeren **limer inn skjermbilder fra Resonans og Ekko i
ChatGPT**. Dataene finnes altså i Resonans; det er modellen, flaten og farten som
taper. Brukeren beskrev Resonans som «seigere» med en «dummere» LLM, og fikk
«veldig lange svar» da modellen ble skrudd opp i bøker.

Bruksdataene (`/api/diagnostikk/bruk`, 90 dager) sier det samme fra en annen kant:
464 chatmeldinger, nesten alle til dagbok og skriving, og rundt 40 til helse, trening,
søvn og vekt til sammen.

Målt i koden:

- **«Auto» svarte med `gpt-4o-mini`.** Et regex-sett («sammenlign|analyse|plan …»)
  løftet enkelte meldinger til `gpt-4o`.
- **Runden etter et verktøykall ignorerte brukerens valg.** Den gikk gjennom samme
  heuristikk, så selv med 5.4 valgt ble svaret som faktisk leses, det som kommer
  etter at tallene er hentet, skrevet av mini.
- **AI-ruteren var den tyngste fasen før første modellkall.** Den er et eget
  `gpt-4o-mini`-kall som velger modus, domener og modellforslag. Median 1,3 s av
  1,65 s (`[chat-perf]`, 8 målinger).
- **Svaret ble «skrevet» tegn for tegn etter at det var ferdig.** Proxy-modusen i
  `chat-stream-messages` ventet på hele svaret og sendte det så ett tegn om gangen
  med 4 ms pause, altså ~2,5 s ren ventetid for 600 tegn. Det så ut som strømming og
  var det motsatte.

## Faser

### Fase 1: modell, ruting, lengde (denne endringen)

- `$lib/domain/ai/chat-model.ts` (ny, med tester) eier modellvalget og parameterne
  per modellfamilie.
  - Standardmodellen er `gpt-5.4`, i alle runder, og brukerens eksplisitte valg
    gjelder også etter verktøyene.
  - Reasoning-modeller får `max_completion_tokens` (gulv 4000, siden
    reasoning-tokens teller), `reasoning_effort: 'low'` og `verbosity: 'low'`, men
    ingen `temperature`. De to parameterformene kan ikke blandes; det var grunnen
    til at bare førsterunden hadde en gpt-5-gren.
  - `legacy` gir den gamle heuristikken tilbake.
- `/api/chat`:
  - AI-ruteren er av som standard. Regex-rutingen beholdes for kontekstmodulene.
  - Verktøyene skjules bare for de spesialiserte flatene (bok, film, flyt), og
    modellen velger selv. Regex-rutingen gir `conversation` for alt den ikke kjenner
    igjen, og den gamle regelen ville da tatt fra coachen både tallene og websøket.
  - Modellkallene går gjennom `createChatCompletionWithFallback`. Avviser OpenAI
    forespørselen (400/404), prøves den én gang med `gpt-4o`, og det logges som
    `[chat-model]`.
- `chat-stream-messages`: hele svaret sendes i én token-hendelse (erstattet av
  ekte strømming i fase 2).
- `BASE_PROMPT`: «Lengden følger spørsmålet.» Et enkelt spørsmål får et svar på én
  til fire setninger. Det kan bli lengre bare når brukeren tenker høyt, ber om en
  plan eller ber om mer.

### Fase 2: ekte strømming og måling

Brukeren etter fase 1: «Raskere og bedre». Målt på første melding: rutingen fra
1 308 ms til 2 ms, og tiden fram til første modellkall fra 1 650 ms til 106 ms.
Men svaret kom fortsatt i ett, først når modellen var helt ferdig.

- **`$lib/server/chat-completion.ts`** (ny) eier modellkallet: strømmet gjennom
  SDK-ens `chat.completions.stream()` når noen lytter, ellers `create()`, og med
  reserven fra fase 1. Klienten sendes inn, så løkka kan testes.
  - **Verktøyløkka er uendret.** Strømmen gir det samme `ChatCompletion` tilbake
    (SDK-en setter sammen verktøykallene av bitene), og strømmingen er en
    bieffekt for den som ser på.
  - **Prat før et verktøykall nullstilles** (`stream_reset`). Sier modellen «la
    meg sjekke …» og kaller et verktøy, er det ikke svaret, og teksten tømmes
    før neste runde strømmer det ekte svaret.
  - **Reserven prøves bare før det første ordet.** Har brukeren sett tekst,
    ville et nytt forsøk skrevet et annet svar oppå det første.
- **`chat-stream-messages`** sender `token` videre fortløpende, og sender det
  ferdige svaret i én hendelse bare når ingenting ble strømmet. `complete` bærer
  fortsatt den endelige teksten (verktøylekkasje strippet), og klienten bygger
  boblen av den, så det strømmede blir erstattet av det lagrede.
- **`proxy-chat-stream`/`ChatState`** fikk `onStreamReset`. Ingen ny SSE-løkke.
- **Selve svaret måles** (migrasjon `0069_chat_perf_answer.sql`):
  `chat_perf_samples` fikk `model`, `first_token_ms`, `total_ms`,
  `tool_rounds`, `fallback` og `streamed`. Målingen skrives nå ÉN gang når
  svaret er ferdig, eller uten svarfeltene når meldingen feiler — før ble den
  skrevet ved første modellkall. `/api/diagnostikk` viser `chat.answer` med
  persentiler for første ord og ferdig svar, hvilke modeller som svarte, og
  hvor mange ganger reserven tok over.
  - **Modellen er den OpenAI sier svarte** (`completion.model`), ikke den vi ba
    om. Det er den eneste måten å se at reserven tok over, uten admin-tilgang
    til loggen.
  - **Modellnavnet går gjennom `sanitizeModelName`** ved både skriving og
    lesing: det ligger på et åpent endepunkt, og `preferredModel` kommer fra
    klienten.

### Fase 3: avslaget betales én gang, og årsaken synes

Første svarmåling i prod etter fase 2 (`chat.answer` på `/api/diagnostikk`):

> 1 svar: første ord etter 14 484 ms, ferdig etter 15 088 ms; modell:
> gpt-4o-2024-08-06 ×1; reserven svarte 1 gang.

`gpt-5.4` ble avvist, og reserven svarte. Hva som ble avvist sto bare i loggen.
Og hver runde prøvde modellen på nytt: med én verktøyrunde betyr det to avslag
per melding, for alltid. Strømmingen virket, men det første ordet kom etter
fjorten sekunder.

- **Samme modell uten parameteren før reserven.** Avvises `verbosity` eller
  `reasoning_effort` (`OPTIONAL_MODEL_PARAMS`), prøves samme modell uten den
  parameteren OpenAI navngir, eller uten begge hvis den ikke sier hvilken. Den
  første reserven byttet bort modellen for å redde en parameter, altså feil vei.
- **`ModelRejectionMemory` husker avslaget i prosessen** (30 minutter): en droppet
  parameter sendes ikke igjen, og en ubrukelig modell hoppes over. Et avslag er
  en egenskap ved konfigurasjonen, ikke ved meldingen, og skal betales én gang
  per deploy, ikke per runde. Tidsgrensa gjør at en rettet konfigurasjon tas i
  bruk igjen uten restart. Dette er kodebasens første in-process-hukommelse, og
  den er målt fram: avslaget kostet en hel modellrunde hver gang.
- **Årsaken lagres** (`rejection`, migrasjon 0070) som et maskinnavn bygd av
  OpenAIs strukturerte felt: `400:unsupported_parameter:verbosity`
  (`describeRejection`). Det bygges aldri av meldingsteksten, siden målingen
  ligger på et åpent endepunkt. Teksten vaskes igjen ved lesing
  (`sanitizeRejection`), og `chat.answer.rejections` teller dem.

### Fase 4: hvor tida i svaret går

Etter fase 3 (fem svar, de tre siste fra gpt-5.4): avslaget var
`400::reasoning_effort`, og uten parameteren svarer `gpt-5.4`. Men første ord
kom fortsatt etter median 14,7 s, med 17,8 s til ferdig svar og én verktøyrunde
per melding. Tre forklaringer med tre ulike rettelser:

1. **Tenking.** Uten `reasoning_effort` tenker modellen på standardnivået, og to
   modellkall per melding betyr to runder tenking.
2. **Verktøyene.** Tida går i oppslagene, ikke i modellen.
3. **Prompten.** 48 verktøydefinisjoner pluss konteksten er tusenvis av tokens
   per kall.

Ingen av dem kan velges uten å måle, så denne fasen bare måler (migrasjon 0071):

- `model_ms` er samlet tid i modellkallene. `totalMs − wallMs − modelMs` er
  verktøyene og resten.
- `prompt_tokens` (største prompt), `completion_tokens` og `reasoning_tokens`
  (summert) kommer fra OpenAIs `usage`. Strømmen ber om `include_usage`, ellers
  har et strømmet svar ingen tokentall.
- `chat.answer.split` på `/api/diagnostikk` viser medianene, og setningen sier
  dem i ord.

**Svaret på fase 4** (fire svar etter deploy): første ord etter median 6,6 s,
ferdig svar etter 7,1 s. Det er under halvparten av 14,5 s. Modellkallene tok
median 2,9 s, og verktøy og annet 1,6 s. **0 tenketokens**, så tenkingen var
ikke synderen. Derimot var prompten på **median 34 200 tokens per kall**, og hver
melding har typisk to kall.

### Fase 5: promptens anatomi og cache-treff

Lokalt målt er verktøylista **67 verktøy og ~89 000 tegn som JSON, ≈22–25 000
tokens**. Det er rundt to tredjedeler av prompten, og den sendes i hvert kall.
VISION sa «48 verktøy ≈ 7 000 tokens», og det har ikke stemt på lenge.
Størst: `query_training` (5,3 kB), `query_weight`, `create_goal`,
`create_widget`, `query_nutrition` og `propose_widget`.

Om det koster tid avhenger av OpenAIs prompt-cache: et identisk prefiks er
raskere og billigere. Verktøyene ligger først i prefikset og er like hver gang,
så de BØR treffe cachen. Denne fasen måler om de gjør det (migrasjon 0072):

- `prompt_parts` er lengden på hver promptblokk i tegn (verktøy, grunnprompt,
  minne, mål, helse, historikk, …), aldri innholdet. Navnene går gjennom en
  hviteliste (`PROMPT_PART_NAMES`).
- `prompt_tokens_total` og `cached_tokens` summeres over kallene, og
  `chat.answer.split.cachedShareMedian` viser andelen.

Svaret i prod: verktøy 89 261 tegn, grunnprompt 23 816, minne 9 666, mål 4 181,
helse 1 734. Bare **~20 %** av prompten kom fra cachen. Verktøylista er altså
den store posten, og den koster tid.

### Fase 6: verktøyutvalget, og hvorfor rutingen ikke kan være porten

Spørsmålet var om rutingens regelsett er godt nok til å bestemme hvilke verktøy
modellen får se. Det er det ikke. Prøvd på 24 setninger slik brukeren faktisk
skriver dem, rutet omtrent halvparten feil eller til `general`:

| Melding | Rutet til | Burde vært |
|---|---|---|
| Sprang meg en tur | general | health |
| har jeg trent for mye? | general | health |
| hvordan er formen nå? | general | health |
| gikk en lang tur med hunden | general | health |
| hvor mange økter har jeg hatt | general | health |
| føler meg litt nede | general | self |
| minn meg på å ringe rørleggeren | general | planning |
| hvor mye har vi brukt på mat | food | + economics |
| har jeg råd til ny sykkel? | health | + economics |
| og i fjor? | general | (forrige tema) |

Så lenge alle verktøyene fulgte med, kostet en bom bare konteksten. Det var
heller ikke gratis: siden AI-ruteren ble slått av i fase 1, har helsebriefingen
manglet for nettopp disse meldingene utenfor et helsetema. Som PORT for
verktøyene ville en bom koste selve verktøyet, og da svarer coachen uten
brukerens tall. Rutingen er derfor gjort robust i fire lag:

1. **Utvalget er en UNION av fire signaler**
   (`$lib/domain/ai/tool-selection.ts`). Ingen av dem er alene om å avgjøre:
   rutingens domener og ferdigheter, temaet samtalen ligger på
   (`resolveThemeDashboardKind`, samme signal som helsebriefingens gate),
   verktøyene og domenene i trådens to siste svar (`toolsCalled` lagres nå i
   svarets metadata), og et bilde i tråden. `kjerne` følger alltid med: dag,
   uke, oppgaver, sjekklister, minne, mål, vær, websøk og refleksjoner, altså
   det en dagboksmelding trenger.
2. **Ordene som bommet er lagt til** i `detectPromptFocusModules`, med tester på
   begge sider (`prompt-focus-modules.test.ts`). Underveis dukket det opp en
   feil som har ligget der lenge: `\bøkter\b` traff ALDRI «mange økter», fordi
   `\b` er ASCII i JS og det ikke finnes noen ordgrense mellom et mellomrom og
   «ø». Ordet traff bare inni «treningsøkter». Grensa er nå en lookaround.
3. **`load_tools` er sikkerhetsnettet.** Med kuttet på kan modellen be om en
   gruppe selv, og den følger med fra neste runde. Beskrivelsen ber den gjøre
   det FØR den sier at den ikke kan noe.
4. **Skygge først.** `CHAT_TOOL_SELECTION` er `shadow` som standard: alle
   verktøyene sendes som før, og hvert svar lagrer hva utvalget ville vært,
   hvilke verktøy modellen kalte, og hvilke av dem som MANGLET
   (`tool_selection`, migrasjon 0073). `/api/diagnostikk` viser
   `chat.answer.toolSelection` med bom-andel, de oftest bommede verktøyene og
   hvilke signaler som bidro. Kuttet skrus på med `on` når bom-andelen er under
   `MAX_MISS_RATE_FOR_CUT` (5 %) over minst 20 svar med verktøykall. `off`
   slår av målingen.

Anslått fra målingen per verktøy: en dagboksmelding går fra 89 000 til ~21 000
tegn verktøy (24 %), en økonomimelding til ~24 000, en helsemelding til ~54 000
(helsegruppa er tung: `query_training` alene er 5,3 kB).

En test leser `tools`-lista i chat-ruta, i alle fire skrivemåtene der, og krever
at den og kartet har nøyaktig de samme navnene. Et nytt verktøy uten gruppe
ville ellers forsvunnet stille den dagen kuttet skrus på. I drift holdes et
ukjent navn INNE (`toolNamesForGroups`), så testen er porten og driften er
sikringen.

## Beslutninger

- **Miljøvariabler, ikke kode, styrer eksperimentet.** `CHAT_DEFAULT_MODEL`
  (`legacy` for det gamle), `CHAT_AI_ROUTER=true`, `CHAT_REASONING_EFFORT` og
  `CHAT_VERBOSITY`. Et eksperiment som må deployes tilbake, blir ikke skrudd av
  når det burde.
- **Ruteren fjernes fra den kritiske stien, ikke parallelliseres.** Konteksten
  avhenger av domenene den velger, så parallellkjøring ville krevd å bygge
  konteksten to ganger. En sterk modell med verktøy trenger ikke at noen gjetter
  domenet på forhånd.
- **Bok- og filmnavigeringen forsvinner med ruteren.** «Åpner «Stoner»…» framfor
  et svar var en flate som tok brukeren ut av samtalen, og det strider mot én tråd.
  Med `CHAT_AI_ROUTER=true` er den tilbake.
- **Lav ordrikhet på API-nivå i tillegg til prompten.** En sterkere modell skriver
  mer, ikke bedre, og brukeren hadde allerede opplevd det.
- **Reserven slår bare til når forespørselen avvises**, ikke ved 429 eller
  nettverksfeil, der den bare ville doblet trykket.

## Verifisering

- `chat-model.test.ts`: standardvalg, at valget gjelder etter verktøyene, legacy,
  parameterformene per familie, gulvet, ugyldige miljøverdier og når reserven slår
  til.
- `npm test`: 5 117 tester grønne. `svelte-check`: 0 feil.
- Fase 1 i prod: rutingen falt fra 1 308 ms til 2 ms, og tiden fram til første
  modellkall fra 1 650 til 106 ms (to målinger). Brukeren: «raskere og bedre».
- Fase 2: `chat-completion.test.ts` beviser rekkefølgen med en falsk klient
  (strømming, nullstilling, reserve bare før første ord, ingen reserve ved 429).
  `chat-completion.sdk.test.ts` kjører den EKTE SDK-en mot en lokal server i
  OpenAIs SSE-format og beviser at kontrakten den falske antar holder:
  `content.delta`, verktøykall satt sammen av biter, `completion.model`, og et
  400-svar som feil med `status`. `chat-perf-stats.test.ts` dekker svarmålingen
  og vaskingen av modellnavnet. `npm test`: 5 137 grønne; `svelte-check` 0 feil.
- At `gpt-5.4` tar `reasoning_effort` og `verbosity` er fortsatt ikke verifisert
  mot OpenAI herfra, men `chat.answer.byModel` og `fallbacks` på
  `/api/diagnostikk` svarer på det etter første melding.

- Fase 6: `tool-selection.test.ts` (union, tråd, tema, bilde, kartet mot ruta),
  `chat-perf-stats.test.ts` (vasking av navn modellen kan finne på, bom-andel,
  dom holdt tilbake under 20) og `prompt-focus-modules.test.ts` (setningene i
  tabellen, og at «formen på teksten», «forbruket har økt» og «nede i
  kjelleren» ikke treffer). `npm test`: 5 192 grønne; `svelte-check` 0 feil.

## Kjent rest

- Ekko-assistenten (`shared-tools.ts`) har sitt eget modellvalg og strømmer ikke.
- `POST /api/chat` (JSON) strømmer ikke, med vilje.
- Første ord måles fra rutingen, ikke fra når forespørselen kom inn; validering
  og samtaleoppslag før det er ute av tallet.
- Avbryter brukeren, går modellkallet videre på serveren, som før.
- Verktøyutvalget gjelder bare hovedchatten. Ekko (`shared-tools.ts`) sender
  sin egen liste.
- Kuttet er ikke skrudd på. Det avgjøres av bom-andelen i prod, ikke herfra.
- `mat` i matmønsteret treffer fortsatt «automat» og «format». Det er et ekstra
  domene, ikke et manglende, og er latt stå.
- Grunnprompten (23 800 tegn) er neste post, og cache-andelen er ikke bedret.
