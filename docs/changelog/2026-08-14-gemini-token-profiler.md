# Gemini Live: token-profiler, verktøy og ratelimit (server-PR0)

Dato: 2026-08-14
Status: ferdig

## Kontekst

Ekko skal gjøre Gemini Live til primær stemmeflate (brief:
`resonans-lab/ekko/GEMINI_LIVE_VOICE_BRIEF.md`, bestilt i tre faser: «prat deg
til en økt», Live overtar assistenten, dynamisk live-coach). Dette er
server-forutsetningen — «PR0» i briefen — som må være deployet før klientens
fase 1-PR. Alt er additivt: `voice-test`-oppførselen er byte-identisk for
klienter bygget før profilene fantes.

Kjernebeslutningen: **verktøyskjemaene bor i det constrainede token-setupet på
serveren**, ikke i appen. Et skjema klienten selv kan sette er ingen
sikkerhetsgrense, og to kopier (app + server) driver fra hverandre. Klienten
får bare en navne-allow-list (`capabilities.tools`) og `toolsetVersion`.

## Faser

### Fase 1: Profiler og verktøy

- `$lib/domain/ai/gemini-live-profiles.ts` (ny, ren, testet):
  `resolveTokenProfile` (ukjent → `voice-test`, aldri 400 — feature-detection
  begge veier), `ASSISTANT_FUNCTION_DECLARATIONS` (driveDistance, resolvePlace,
  nearestPlace, sendToCar, startWorkout m/ `place`, calendarLookup — speiler
  `AssistantToolExecutor` i Ekko), `toolsForProfile`, `personaForProfile`,
  `isProfileDisabled`, `evaluateMintRateLimit`.
- `gemini-live-token.ts`: `buildAuthTokenRequest` tar `profile` og legger
  profilens verktøy i `bidiGenerateContentSetup.tools`. Masken er UENDRET
  (`model,tools`) for alle profiler — `sessionResumption`, `systemInstruction`,
  `generationConfig.responseModalities`, transkripsjon og `realtimeInputConfig`
  forblir klient-skrivbare.
- `gemini-live.ts`: `GEMINI_LIVE_COACH_MODEL` (valgfri) overstyrer modellen for
  coach-profilen, fallback til vanlig kjede.

### Fase 2: Endepunktet

`POST /api/apps/gemini/ephemeral-token`:

- `profile` i kroppen; `voice-test`-svar uendret; `assistant`/`coach` får i
  tillegg `profile`-ekko, `capabilities { resumption, tools, toolsetVersion }`
  og `persona { version, preamble }`.
- Kill switch: `GEMINI_LIVE_DISABLED_PROFILES` (kommaseparert env) →
  `403 { "error": "profile_disabled" }`. Klienten faller tilbake til
  SSE-samtale/regelcoach uten app-release.
- Ratelimit: 30 mint per bruker per rullende døgn → `429` med `retryAfter`
  (kropp + header). Ny tabell `gemini_token_mints`
  (migrasjon `0058_gemini_token_mints.sql`), bokføres etter vellykket mint.

## Beslutninger

- **`voice-test` får IKKE profile-ekko.** Byte-identisk svar er kontrakten mot
  gamle klienter; nye klienter feature-detecter på at `assistant`/`coach`-svar
  ekkoer profilen.
- **Persona på serveren** så stemmen kan itereres på Vercel uten TestFlight.
  «Unngå ordet ekko» står der fordi «ekko» er vekkeordet for barge-inn — en
  modell som sier det avbryter seg selv.
- **Coach-profilen er `tools: []` i fase 3a**; markLap/sendViewerReply/
  startSharing/getWorkoutStatus designes i fase 3b-PR-en. `systemInstruction`
  låses ikke — klienten komponerer økt-rammen ved connect.
- **Ratelimit-avvisning bokføres ikke** — en avvist forespørsel kostet ingen
  Google-kvote og skal ikke spise av brukerens egen.
- **Åpent punkt (brief §5), krever felttest mot Google:** virker et
  resumption-handle på tvers av et NYTT ephemeral token, og hva er handle-TTL?
  Dokumentert som åpent i `ekko/GEMINI_LIVE_API.md`; cold-rotasjon er designet
  inn klient-side som fallback.

## Verifisering

- `npm test`: 3406 tester grønne, inkl. ny `gemini-live-profiles.test.ts`
  (profil-fallback, verktøynavn, maske-uendret for alle profiler,
  byte-identisk kropp uten profil, kill switch-parsing, ratelimit-kanter).
- `npm run check`: 0 feil.
- Byte-identisk `voice-test`: eksplisitt test på `JSON.stringify`-likhet mellom
  kropp uten profil og med `voice-test`.
