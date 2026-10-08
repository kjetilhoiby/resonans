# Responses-broen

Dato: 2026-10-08
Status: pågår (fase 4 av planen i `2026-10-08-chat-verktoy-ut-av-ruta.md`)

## Kontekst

Hovedchatten går over Chat Completions, og der kan ikke gpt-5.x tenke og kalle
verktøy i samme kall: `chatCompletionsToolSupport` sier `without-reasoning`, og
coachen sender `reasoning_effort: none` (#461). Responses-API-et tar begge, og
kan bære tenkingen mellom verktøyrundene. Om byttet gir bedre svar, raskere
eller dyrere, skal måles i Stemmegaffel før det gjøres her.

## Fase 4a: broen

`$lib/domain/ai/responses-bridge.ts` oversetter en Chat Completions-forespørsel
til Responses og svaret tilbake til `ChatCompletion`, med en samler for
strømmen. Den er ikke koblet inn i chatten; Stemmegaffel importerer den og
måler med den, så fase 5 kobler inn kode som alt er målt.

## Beslutninger

- **`strict: false` på verktøyene.** Responses er strict som standard, og
  Resonans' skjemaer har valgfrie felt uten `additionalProperties: false`.
- **Tenkingen bæres på assistentmeldingen** (`RESPONSES_OUTPUT_KEY`) og legges
  inn ordrett i neste runde, med `encrypted_content`. Løkka i chat-ruta
  dytter `responseMessage` tilbake i `messages`, så elementene følger med uten
  at løkka vet om dem.
- **`store: false` og ingen `previous_response_id`.** Samtalene skal ikke ligge
  hos OpenAI; tenkingen bæres kryptert i forespørselen i stedet.
- **Ukjente felt kaster** og navngis. En test oversetter hele hovedchattens
  første runde (68 verktøy og `completionSizing` for tre modeller), så et nytt
  felt fra `completionSizing` blir rødt her før det blir stille borte i drift.
- `RESPONSES_BRIDGE_VERSION` bumpes når oversettelsen endrer seg; Stemmegaffel
  har den i cache-nøkkelen.

## Verifisering

16 tester i `responses-bridge.test.ts`. Ikke kjørt mot API-et herfra; det er
Stemmegaffels jobb.
