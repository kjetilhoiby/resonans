# Modellaliaser fra Stemmegaffel: `json_cheap` først

Dato: 2026-10-09
Status: pågår (`json_cheap` er bygget; `vision`, `prose`, `reasoning` og `fast_tools` står igjen)

## Kontekst

Modellnavnene sto hardkodet i ~55 kallsteder. Et modellbytte betydde da en kodeendring per
kallsted, og formen på kallet ble gjettet av modellnavnet (`completionSizing`). Den gjetningen
tok feil for gpt-5.4 8. oktober 2026. Stemmegaffel (`resonans-lab/stemmegaffel`) måler modellene
mot det Resonans sender og deler ut aliaser på `/api/v1/aliaser/{navn}`, med modellen og
parameterne som er målt å virke. Laben foreslår bytter. Den bytter aldri et alias selv; det gjør
et menneske i labens grensesnitt.

`json_cheap` er først fordi kallene er smale, bakgrunnsrettede og lette å etterprøve: tekst inn,
JSON ut, ingen bruker som venter på ordene.

## Faser

### Fase 1: `json_cheap`

- `$lib/domain/ai/model-alias.ts` inneholder reglene, uten I/O:
  - `parseAliasPayload` leser labens svar felt for felt;
  - `resolveAlias` velger alias eller standard og sier hvorfor;
  - `applyAlias` setter modellen og formen på kallstedets forespørsel;
  - `shouldFallBackFromAlias` avgjør om et avvist kall skal prøves med standarden.
- `$lib/server/ai/model-alias.ts` henter aliaset og kaller OpenAI:
  - minne i prosessen, fornyet hvert kvarter i bakgrunnen;
  - første henting venter høyst 1,5 s;
  - `createWithAlias` prøver én gang med standarden når OpenAI avviser (400/404), og setter aliaset til side i 30 minutter.
- Kallstedene som er flyttet (alle var `gpt-4o-mini`, tekst inn og JSON ut):
  - `email-processors/ai-extraction.ts`, `oda-receipt.ts` og `find-triage.ts`;
  - `integrations/spending-analyzer.ts` (to kall);
  - `tracking-triage.ts` (tekstkallet);
  - `api/inbox/triage-suggest` og `api/checklist-items/triage-suggest`.
- **Ikke flyttet, med vilje:**
  - bildekallet i `tracking-triage.ts`, `attachment-triage` og `school-plan.ts` (PDF-grenen bruker gpt-4o). Disse er `vision`.

### Fase 2: pensjoneringen (14. oktober 2026)

OpenAI pensjonerer `gpt-4o`, `gpt-4o-mini`, `gpt-4.1` og `gpt-4.1-mini` 14. januar 2027.
To av dem sto som det Resonans faller tilbake på, altså det som skal svare når noe annet
ikke gjør det.

- **`json_cheap` har ny standard: `gpt-6-luna`.** `ALIAS_DEFAULTS` er nå `{ model, params }`,
  og standarden går gjennom `applyAlias` som et svar fra laben gjør. Formen er
  `max_completion_tokens` (med kallstedets verdi; `null` betyr at kallsteder uten tak
  fortsatt ikke får noe), `reasoning_effort: 'none'` og ingen temperatur. Laben målte Luna
  minst like god som `gpt-4o-mini` på alle `json_cheap`-oppgavene, til to tredjedeler av
  prisen.
- **Chatreserven er `gpt-5.4-mini`** (`FALLBACK_CHAT_MODEL`, `$lib/domain/ai/chat-model.ts`).
  Den sendes med `fallbackCompletionSizing`: `max_completion_tokens` med gulv,
  `reasoning_effort: 'none'`, ingen temperatur og ingen ordrikhet. `none` er det eneste
  tenkenivået gpt-5.x tar over Chat Completions med verktøy, og reserven skal være den
  forespørselen som er minst sannsynlig å bli avvist.
- **Stemmegaffel vet om datoen.** `KJENTE_UTLOP` fyller hullet OpenRouter-katalogen har, og
  varselvinduet er 120 dager. Et alias som peker på en av de fire modellene, flagges nå som
  akutt.
- **Står igjen:** `vision` (bildekallene peker fortsatt på `gpt-4o`/`gpt-4o-mini`),
  `CHAT_DEFAULT_MODEL=legacy` (heuristikken velger `gpt-4o`) og de øvrige kallstedene med
  en hardkodet 4o- eller 4.1-modell.

## Beslutninger

- **`STEMMEGAFFEL_URL` er bryteren.** Fram til fase 2 var hvert kall byte-likt det det var
  uten den. Etter fase 2 bruker standarden sin egen modell og form (se over), og testen
  `gir standarden sin egen form` vokter den.
- **Bare OpenAI, og bare direkte.** Resonans har én klient til disse kallene. Et alias som peker
  på Google, eller på en OpenAI-modell målt gjennom OpenRouter, faller tilbake på standarden med
  grunnen i loggen. En flerleverandørklient er et eget steg, og trengs først når laben anbefaler
  en annen leverandør.
- **Aliaset bestemmer formen, kallstedet innholdet.**
  - Tokentaket får navnet laben målte (`max_completion_tokens`), men verdien kallstedet ba om.
  - Temperatur sendes bare når laben målte at modellen tar den.
  - Tenkenivå og ordrikhet kommer fra laben bare når kallstedet ikke har satt dem.
  - `response_format` og meldingene er alltid kallstedets.
- **En avvisning er ett ekstra kall, ikke en feil hos brukeren.** Laben har målt aliaset på sine
  oppgaver, ikke på hvert kallsted. 429 og nettverksfeil prøves ikke på nytt; det ville bare
  doblet trykket.
- **Ingen ny modellmåling i Resonans.** Hvilken modell som svarte, logges én gang per bytte
  (`[modell-alias] json_cheap → … (stemmegaffel)`). Kvalitet og kost måles i laben.

## Verifisering

- `model-alias.test.ts`: 15 tester. De dekker:
  - labens svar i formen det hadde 9. oktober;
  - leverandør- og rutevakta;
  - byte-likhet uten laben;
  - navnebytte på tokentaket;
  - temperatur som droppes for en tenkende modell;
  - reglene for nytt forsøk.
- `npm test` (5 404 tester) og `npm run check` er grønne.
- 9. oktober svarte laben `gpt-4o-mini` med `max_completion_tokens` på `json_cheap`. Første
  utrulling bytter altså ingen modell. Den endrer bare navnet på tokentaket for disse kallene.

## Neste

- `vision`: bildekallene over, `attachment-triage`, `ticket-reader`, skjermtidsparseren.
- `prose` og `reasoning` krever at Responses-spørsmålet er avgjort for de modellene laben anbefaler.
- `fast_tools` (hovedchatten) til sist, etter de andre.
