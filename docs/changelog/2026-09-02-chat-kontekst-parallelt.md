# Chat-konteksten hentes parallelt, og koster nå en målt pris

Dato: 2026-09-02
Status: ferdig

## Kontekst

«Hva koster en chatmelding før modellen i det hele tatt ser den?» var
ubesvarbart uten å gjette. Kartleggingen av `/api/chat` viste hvorfor:
kontekstbyggingen var **ti sekvensielle `await` på rad** — minne, person, mål,
prosjektoppgaver, kontakter, fremgangsmåte, dagskontekst, ferie, helsebriefing
— alle uavhengige av hverandre, alle betalende sin egen rundtur i sum. Et
serverless-formet mønster: på Neon HTTP var hver av dem en HTTPS-request, og
ingen prosess levde lenge nok til at noen så totalen.

## Faser

### Fase 1: Måleren (`$lib/server/chat-perf.ts`)

`createChatPerf` + `formatChatPerfLine` (rene, testet): én søkbar linje per
melding, tyngste fase først —

```
[chat-perf] kontekst wall=237ms sum=598ms ruting=104ms helse=86ms mål=67ms …
```

Lesenøkkel: fasene i parallellbatchen overlapper, så `sum` er samlet arbeid
og `wall` er tiden brukeren ventet. `wall` ≈ største enkeltfase betyr at neste
forbedring er å gjøre nettopp den fasen billigere — ikke mer parallellisering.
NB: under samtidighet inkluderer hver fases walltid ventetid på pool og
event-loop, så enkeltfaser overrapporterer noe; `wall` er tallet som er sant.

### Fase 2: Parallellbatchen

De ni kontekstblokkene hentes nå med én `Promise.all`. Feilhåndteringen per
blokk er bevisst uendret: best-effort-blokkene (person, prosjekt, prosedyre,
dag, ferie, helse) fanger selv og koster sin seksjon; minne og mål var harde
avhengigheter før og er det fortsatt — en rejection der gir 500 nå som før.
`today`/datokonteksten er hoistet foran batchen (ferieblokka trenger den);
måltekstblokka bygges synkront etter. Ruting, lagre-melding og historikk er
sekvensielle av natur (historikk trenger lagret melding) og måles hver for seg.

## Verifisering

`npm test` (4 078, +2) og `npm run check` grønne. Runtime mot ekte PostgreSQL
16 med FULLT skjema (`db:push` mot lokal pgvector-base), to ekte meldinger
gjennom `/api/chat`:

- `wall=237ms sum=598ms` og `wall=187ms sum=355ms` — walltiden er ~40–50 % av
  summert arbeid selv mot en TOM lokal base med sub-ms spørringer. Mot prod
  (data + ekte nettverk mellom container og Postgres) er gevinsten større i
  absolutte tall; [chat-perf]-linjene i Coolify-loggen gir fasiten.
- Nøyaktig én perf-linje per melding; alle ni fasene fullførte; meldinger og
  samtale persistert. 500-en i testen kom fra modellkallet (dummy
  OpenAI-nøkkel), etter at hele konteksten var bygget — samme som før.

## Neste steg (avhenger av prod-tall)

Les `[chat-perf]`-linjene etter noen dagers bruk. Er `helse`-fasen dominant på
helsemeldinger, er kandidaten å gjøre dashboard-lasterne billigere (eller en
kort TTL-cache på briefingen — med åpne øyne for staleness rett etter at et
verktøy har skrevet). Er `ruting` dominant, er det gpt-4o-mini-latens, ikke DB.
