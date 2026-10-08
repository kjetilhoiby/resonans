# Chat-verktøyene ut av ruta

Dato: 2026-10-08
Status: ferdig (fase 1 av en plan som fortsetter i Stemmegaffel)

## Kontekst

Stemmegaffel (`resonans-lab/stemmegaffel`) måler modeller mot det Resonans
faktisk sender, og skal brukes til å teste et bytte fra Chat Completions til
Responses-API-et før det gjøres her. Men hovedchattens verktøy lå inline i
`routes/api/chat/+server.ts`, så laben målte verktøyvalg mot tretten egne
stedfortredere med Resonans' navn. Et verktøyvalg målt mot andre verktøy enn
chatten sender, sier lite om chatten — og den ekte lista er ~95 000 tegn, så
også fartsmålingen var for lett.

Planen videre:

1. Verktøyene og sammensetningen av systemmeldingen ut av ruta (dette).
2. Opptak av ekte og syntetiske chat-runder, admin-gatet, som laben henter.
3. Laben bruker de ekte verktøyene og opptakene: en «prøv»-side og en suite.
4. Responses som egen protokoll i laben, målt mot Chat Completions.
5. Byttet her, bak et flagg.

## Fase 1

- **`$lib/server/chat/tools.ts`** eier `CHAT_TOOLS` — 68 definisjoner, ingen
  utførelse. Ruta importerer den som `tools`; ingenting i oppførselen er endret.
  Skriptet som flyttet blokka tok med nøyaktig de importene den brukte, og
  ryddet bort de ruta ikke lenger trengte.
- **`chat-tools.json`** er den samme lista som ren data, skrevet av
  `tools.test.ts` med `toMatchFileSnapshot`. Laben kan ikke importere
  `tools.ts`: flere oppføringer leser feltene fra verktøymodulene, og de
  importerer databasen.
- **`assembleSystemPrompt`** (`$lib/domain/ai/chat-system-prompt.ts`) setter
  sammen systemmeldingen av de tretten blokkene og regner promptens anatomi av
  den samme lista. Før lå rekkefølgen én gang i en `+`-kjede og én gang til i
  `answerTrack.promptParts`.
- `tool-selection.test.ts` leste navnene ved å parse kildeteksten i ruta (fire
  regex-former og et importoppslag). Den leser nå `CHAT_TOOLS` direkte, og en
  vakt krever at ruta importerer lista framfor å definere sin egen.

## Beslutninger

- **En generert fil framfor å splitte 30 verktøymoduler** i definisjon og
  utførelse. Splitten hadde vært renere, men stor, og den ville ikke gjort
  laben uavhengig av at ingen definisjon noen gang importerer noe tungt. JSON-en
  er ingen kopi i den farlige forstand: testen er rød så lenge den avviker.
- **`promptParts` endrer rekkefølge** (prefiks før grunnprompt), ikke navn.
  `summarizePromptParts` grupperer på navn, så lagrede rader leses som før.
- Systemmeldingen er byte-lik den gamle; en test låser formen.

## Verifisering

`npm test` (5357 tester) og `npm run check` grønt. `chat-tools.json` rundtur
gjennom JSON er lik `CHAT_TOOLS` (ingen zod-verdier eller funksjoner i et
skjema som ville forsvunnet stille).
