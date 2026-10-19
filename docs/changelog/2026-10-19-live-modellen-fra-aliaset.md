# Live-modellen fra aliaset, ikke fra Coolify

Dato: 2026-10-19
Status: ferdig i kode; aliaset står på samme modell som før

## Kontekst

Ekkos Gemini Live-modell ble valgt av `GEMINI_LIVE_MODEL` (og `GEMINI_LIVE_COACH_MODEL`)
i Coolify, med `DEFAULT_LIVE_MODEL` i koden som reserve. Både konstanten og den modellen
alle kjører på, `gemini-3.1-flash-live-preview`, stenges av Google **17. november 2026**.
Datoen sto ingen steder vi så etter: ikke i OpenRouters katalog (Live-modellene finnes
ikke der), ikke i Stemmegaffel, og en miljøvariabel har ingen dato.

Et bytte krevde dessuten at noen åpnet deploy-panelet. Tekstmodellene byttes i laben,
der stengedatoene nå også står.

## Faser

### Fase 1: aliaset `live` i Stemmegaffel (`resonans-lab/stemmegaffel`)

- Migrering `0010_live`: `modeller.type` (`chat` | `live`). `hentModeller` gir bare chat
  som standard, så ingen rangering, suite eller kapabilitetsprøve ser Live-modellene.
- `src/lab/server/live.ts`: Googles egen katalog (`models.list`, filtrert på
  `bidiGenerateContent`) synkes sammen med OpenRouter-katalogen én gang i døgnet. En
  Live-modell som forsvinner fra katalogen, blir `utgatt`.
- Aliaset `live` starter på `google/gemini-3.1-flash-live-preview`, med stengedatoen fra
  `KJENTE_UTLOP`. Siden `/aliaser/live` viser modellene, datoene og reserven, og har
  «Prøvd på telefon» og «Bytt hit».
- **Reserven velges bare blant Live-modeller et menneske har satt til «prøvd på
  telefon»** (`status = 'fulgt'`), og blant dem den med lengst levetid foran seg.
- `GET /api/v1/aliaser/{navn}` har nå `utloper` på modellen og reserven, for alle aliaser.

### Fase 2: Resonans leser aliaset

- `$lib/server/ai/lab-alias.ts`: hentingen fra laben (kvartersminne, 1,5 s første gang)
  flyttet ut av `model-alias.ts`, så tekstaliasene og Live deler den.
- `$lib/domain/ai/live-model.ts`: rekkefølgen aliasets modell → reserve →
  `DEFAULT_LIVE_MODEL`. En modell hoppes over når den er stengt eller borte fra
  Googles katalog (holdt et kvarter i prosessen).
- `resolveLiveModel` i `integrations/gemini-live.ts` erstatter `GEMINI_LIVE_MODEL` og
  `GEMINI_LIVE_COACH_MODEL`. Ekkos valg i Live-debug vinner fortsatt.
- `GET /api/apps/gemini/models` sier `source` (`stemmegaffel` | `reserve` | `default`) og
  `reasons`; `fromEnv` er borte. Ekko dekoder ikke noen av dem, så appen trenger ikke
  et nytt bygg.

## Beslutninger

- **Ingen reserve uten en telefonprøve.** Det som skiller en Live-modell som virker fra
  en som ikke gjør det, kan ikke måles fra laben: `gemini-2.5-flash-native-audio` lukker
  med 1007 så snart mikrofonen står åpen. En automatisk valgt «nyeste» reserve kunne
  vært nettopp den.
- **Reserven er ikke et bytte.** Laben bytter aldri aliaset selv. At Resonans bruker
  reserven den dagen modellen stenger, er en sikring, og loggen (`[gemini-live] modell …
  (reserve: …)`) sier det. Bytt aliaset før.
- **Ingen nødbryter i miljøet.** Aliaset kan byttes i laben uten deploy, og det var hele
  poenget med miljøvariabelen. Svarer ikke laben, brukes forrige svar i prosessen, og
  uten noe svar `DEFAULT_LIVE_MODEL`.
- **Ingen profil-spesifikk modell.** `GEMINI_LIVE_COACH_MODEL` var en bryter for et behov
  som aldri ble målt. Trengs det, er det et eget alias.

## Verifisering

- `live-model.test.ts` (regelen), `gemini-live-model.test.ts` (hele veien med falske
  svar fra laben og Google: miljøvariabelen leses ikke, en modell borte fra katalogen gir
  reserven i selve tokenet, standarden uten laben).
- Labens `live.test.ts` (katalogfilteret og reservevalget), og en røyktest mot PGlite:
  migrering, synk med falsk katalog, aliassvar før og etter at en modell er satt til
  «prøvd».

## Står igjen

- **Før 17. november:** prøv en nyere Live-modell (f.eks. `gemini-3.8-live`) på telefonen
  i alle tre profiler — lyd inn uten 1007, coach-økt, låst token, gjenopptakelse — sett
  den til «prøvd» og bytt aliaset. Til da står aliaset på 3.1, uten reserve.
- `DEFAULT_LIVE_MODEL` bør flyttes til samme modell når den er prøvd.
- `GEMINI_LIVE_MODEL` og `GEMINI_LIVE_COACH_MODEL` kan slettes fra Coolify.
