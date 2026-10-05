# Coachen: smart og rask

Dato: 2026-10-05
Status: pågår (fase 1 ferdig)

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
- `chat-stream-messages`: hele svaret sendes i én token-hendelse.
- `BASE_PROMPT`: «Lengden følger spørsmålet.» Et enkelt spørsmål får et svar på én
  til fire setninger. Det kan bli lengre bare når brukeren tenker høyt, ber om en
  plan eller ber om mer.

### Fase 2: ekte strømming og måling (neste)

- Strøm modellsvaret i den siste runden, så første ord kommer mens resten skrives.
- Mål modellfasen og hvilken modell som faktisk svarte (inkludert reserve) i
  `chat_perf_samples`, så før og etter kan sammenlignes på `/api/diagnostikk`.
  I dag måles bare tiden FRAM TIL første modellkall.

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
- Ikke verifisert mot OpenAI herfra (ingen nøkkel i utviklingsmiljøet). At
  `gpt-5.4` tar `reasoning_effort` og `verbosity` i Chat Completions er antatt ut
  fra gpt-5-familien. Tar den dem ikke, svarer `gpt-4o` via reserven, og
  `[chat-model]` i loggen sier fra.

## Kjent rest

- Hvilken modell som faktisk svarte er ikke synlig uten admin-tilgang til loggen
  (fase 2).
- Ekko-assistenten (`shared-tools.ts`) har sitt eget modellvalg og er ikke rørt.
