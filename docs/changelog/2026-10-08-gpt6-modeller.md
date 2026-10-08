# GPT-6 Sol og Luna: prøvbare der API-et tillater det

Dato: 2026-10-08
Status: ferdig (første steg)

## Kontekst

OpenAI lanserte GPT-5.6 Sol/Terra/Luna i juli 2026 og GPT-6 Sol og Luna i
september (`gpt-6.1-sol` kom 29. september). Modellsidene hos OpenAI per
8. oktober 2026:

| Modell | Pris inn/ut per 1M | Verktøy over Chat Completions |
|---|---|---|
| `gpt-6.1-sol` | $2 / $10 | nei, bare over Responses |
| `gpt-6-luna` | $0,10 / $0,50 | bare med `reasoning_effort: 'none'` |
| `gpt-6-astra` | (over Sol) | nei |

Chatten bruker Chat Completions med verktøy i hvert kall. Et rent modellbytte
til Sol ville gitt 400, og reserven er `gpt-4o`. Altså et dårligere svar enn
standardmodellen, og det ville sett ut som om Sol var dårlig.

## Fase 1: det som kan prøves uten Responses-API-et

- `isReasoningChatModel` og `isReasoningModel` (assistenten) gjenkjente bare
  `gpt-5`. `gpt-6-luna` ville fått `temperature` + `max_tokens` og blitt
  avvist. Mønsteret dekker nå gpt-5 og nyere.
- `chatCompletionsToolSupport` (`$lib/domain/ai/chat-model.ts`) sier hva hver
  modell kan. `chooseChatModel({ withTools })` velger ikke en modell som ikke
  kan ta verktøyene kallet sender (grunnen logges som
  `tools_unsupported:<modell>`), og `completionSizing({ withTools })` gir Luna
  `none`.
- Modellknappen i hjemmechatten har fått **Luna**. Sol står ikke der, siden
  den ikke kan brukes i chatten ennå.
- Brevet (`/brev`) kaller ingen verktøy og bruker `gpt-6.1-sol`
  (`HOME_LETTER_MODEL` overstyrer). Det går nå gjennom
  `createChatCompletionWithFallback`, så en avvist `verbosity` koster
  parameteren, ikke modellen.
- `none` er lagt til som gyldig `CHAT_REASONING_EFFORT`. SDK-en (6.7) kjenner
  ikke verdien, så den castes ved utgangen av `completionSizing`.

## Beslutninger

- **Luna i chatten går uten resonnering.** Det er prisen for verktøy over
  Chat Completions. Den er billig og rask, men om den slår 5.4 som coach er et
  åpent spørsmål. Målingen (`chat.answer` på `/api/diagnostikk`) viser modell
  og tid per svar.
- **Standardmodellen er urørt** (`gpt-5.4`). Luna kan prøves med knappen eller
  med `CHAT_DEFAULT_MODEL=gpt-6-luna` i Coolify uten deploy.

## Neste steg

Full Sol (med resonnering og verktøy) i chatten krever at hovedløkka går over
Responses-API-et: andre meldingsformer, verktøykall som `function_call`-items
og en annen strømmeprotokoll. Det er en egen jobb.

## Verifisering

Enhetstester for familiemønsteret, verktøygrensene og `none` for Luna.
`npm test` og `svelte-check` er grønne. Modellkallene er ikke kjørt mot OpenAI
herfra (ingen nøkkel i utviklingsmiljøet).
