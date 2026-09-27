# Ro: refleksjons- og ekvanimitetsmodus for Ekko

Dato: 2026-09-27
Status: første versjon bygget, kjørt ende til ende mot lokal base (podman) og simulator.

Appsiden står i `resonans-lab/ekko/RO_SPEC.md`. Endrer du kontrakten, hold begge i sync.

## Kontekst

En alternativ modus for rolige løpe- og gåturer der hodet er innholdet, ikke farten. Den
trener én ferdighet: å registrere tanker, følelser og impulser uten automatisk å handle på
dem. Under turen snakker ingen modell – Ekko spiller ferdigskrevne øvelser. Resonans gjør
to ting: velger øvelsen før turen, og tenker med brukeren i ett kort svar etterpå.

## Endepunkter (`/api/apps/ro/*`, Bearer `rsn_…`)

| Metode | Sti | Hva |
| --- | --- | --- |
| `POST` | `/plan` | `{ mode: open\|continue\|theme, text?, durationMin? }` → øvelse, tema, `situation`, `focus`, `closingQuestion`, `safety`, `sessionId` |
| `POST` | `/sessions/{id}/reflection` | `{ text, durationSec? }` → `reply`, `proposal?`, `theme?`, `next?`, `advanced`, `safety`. Tom `text` registrerer økta uten modellkall. |
| `POST` | `/proposals/{noteId}` | `{ accept: boolean }` – ja/nei til en foreslått hypotese |
| `GET` | `/profile` | `overview` (økter siste 30 dager, temaer, det som virker, aksepterte hypoteser, `reviewSuggested`) + `continueTheme` |
| `POST` | `/speech` | `{ text }` → `audio/wav`: én linje lest av Gemini TTS. 503 = ikke satt opp, 502 = Google feilet. |
| `POST` | `/themes/{themeId}/review` | Den lengre gjennomgangen: før/nå/forsøkt/hjulpet/står fast + ett spørsmål |

Bare `mode=theme` på `/plan` bruker en modell (rask, `EKKO_RO_INTAKE_MODEL`, default
`gpt-4o`, ~2 s). Refleksjon og gjennomgang bruker `EKKO_RO_MODEL` (default `gpt-5.5`, 5–10 s).

## Stemmen (`/speech`)

Gemini TTS, ikke Live: Live omformulerer, og i Ro er ordlyden øvelsen. `generateContent` med
`responseModalities: ["AUDIO"]`, `languageCode: "nb-NO"` og en leseinstruks foran teksten
(«exactly as written … calmly, slowly»). Rå PCM pakkes som WAV før den sendes til Ekko.

- **Modellen slås opp i Googles katalog** (`pickTtsModel`: flash foran pro, ikke lite,
  ikke preview, nyeste versjon) og huskes i en time. `GEMINI_TTS_MODEL` overstyrer.
- **Stemmen** er `GEMINI_TTS_VOICE`, standard `Sulafat` («warm»). Bytter du stemme eller
  instruks, må Ekkos `RoVoice.version` bumpes, ellers spilles gammel lyd fra appens cache.
- Ingen cache på serveren: Ekko cacher per linje, og de faste linjene er få.
- Linjer med brukerens egne fraser («planen som ble endret») sendes til Google.

## Filer

| Hva | Fil |
| --- | --- |
| Katalog, profilmodell, progresjon, sammenslåing – rent og testet | `src/lib/server/ro/ro-logic.ts` (+ `.test.ts`) |
| Promptene | `src/lib/server/ro/ro-llm.ts` |
| Orkestrering | `src/lib/server/ro/ro-service.ts` |
| DB | `src/lib/server/ro/ro-repository.ts`, tabellene `ro_profiles` og `ro_sessions` (`0067_ro_modus.sql`) |
| Stemmen | `src/lib/server/ro/ro-speech-logic.ts` (+ `.test.ts`), `ro-speech.ts` |
| Rutene | `src/routes/api/apps/ro/**` |

## Beslutninger

- **Modellen foreslår, koden bestemmer.** Modellen skriver aldri profilen. Den leverer et
  forslag som `mergeReflection` klipper, dedupliserer og tar imot. Samme prinsipp som
  quizen.
- **Hvem som mener noe er en del av dataene.** Notater er `observation`, `trigger`,
  `reaction`, `interpretation` og `working` (det brukeren sa), eller `user_hypothesis` og
  `assistant_hypothesis` (en forklaring). En hypotese er `proposed` til brukeren har sagt
  ja. Et nei lagres som `rejected`, så den ikke foreslås igjen. Det er det som hindrer at
  assistenten begynner å fortelle brukeren hvem hen er.
- **Progresjon per tema:** observere → forstå → tåle → velge → prøve i livet. Trinnet
  flyttes bare når modellen sier `advance` **og** temaet har hatt minst to økter på
  trinnet. Én god økt er ikke en ferdighet. `revisit` går ett trinn tilbake. Når flere
  øvelser passer et trinn, veksles det, slik at samme ferdighet får en ny inngang.
- **Livet endrer seg.** Temastatus er `emerging`, `active`, `background`, `resolved-ish`
  eller `dormant`. Et tema ingen har rørt på 42 dager regnes som hvilende uansett hva som
  står. Maks to aktive; blir et tredje aktivt, går det eldste i bakgrunnen. Et gammelt tema
  som dukker opp igjen, starter på «observere», men beholder notatene.
- **Ikke en dagbok.** Ordrett tekst (`intake`, `reflection`, `reply`) beholdes bare for de
  ti siste øktene (`forgetOldText`). Det som er verdt å huske, står i profilen, med maks 80
  notater. Det brukeren sier virker, og aksepterte hypoteser kastes sist.
- **Krise:** setter modellen `safety=crisis`, lagres ingenting nytt om temaet, ingen
  hypotese foreslås, og svaret får alltid 113 og 116 123 – lagt på av koden, ikke
  overlatt til modellen. På `/plan` blir økta en åpen `omgivelser` uten tema, og Ekko viser
  telefonnumrene før start.
- **Frasene settes inn midt i setninger** i øvelsene («Tenk kort på {situasjon}.»).
  `asPhrase` gir liten forbokstav og ingen avsluttende punktum. Modellen svarer ofte med en
  hel setning.
- **Ingen score, ingen streak, ingen push.** Oversikten er observasjoner.

## Verifisering

- `npx vitest run src/lib/server/ro` – 44 tester.
- Ende til ende 27. september 2026 mot `resonans-pg` (podman, port 55432) og en egen
  dev-server på 5175, med `local-test-user`. Testet: plan (åpen, fortsett, tema), to
  refleksjoner med hypotese og trinnskifte, ja til hypotese, «hopp over», gjennomgang, og
  Ekko uten server.
- Ikke testet: `safety=crisis` med ekte modellsvar, og hvordan profilen ser ut etter mange
  økter.
