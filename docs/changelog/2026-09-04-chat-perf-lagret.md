# Chat-målingen lagres, og vinduet fikk slakk mot klokkeskjevhet

Dato: 2026-09-04
Status: ferdig

## Kontekst

`[chat-perf]` har logget én linje per melding siden 2. september 2026. Den er
riktig for å se på ÉN melding, men spørsmålet som faktisk står — **hvor går
tida i chat-pipelinen, og hva er verdt å cache** — besvares av fordelingen over
mange meldinger.

Og linja var i praksis utilgjengelig: loggringbufferen tømmes ved restart, og
restart skjer ved hver push. Målingen var derfor et vindu på noen timer som
krevde admin-secret å lese. Den ble aldri lest.

Bakgrunnen er at kodebasen **ikke har én in-process cache**. Det var rasjonelt
under serverless — hver invokasjon er kald, så en cache betaler seg aldri — og
er den største uutnyttede spaken på en container. Men repoets egen instruks er
å måle først: «se lesenøkkelen (`wall` mot `sum`) før du optimaliserer noe.»

## Hva

- `chat_perf_samples` (migrasjon 0063): `wall_ms`, `phases` som jsonb, instans.
  Skrives ved siden av logglinja, gjennom `runInBackground` — feiler stille og
  ventes ikke på.
- `summarizeChatPerf` (`$lib/domain/chat-perf-stats.ts`) aggregerer til
  persentiler per fase, med en dom i ord.
- Eksponert på det åpne `/api/diagnostikk` som `chat`.
- Foreldet serverless-begrunnelse i `strava-sync-service.ts` rettet: designet
  er uendret riktig, men av en annen grunn (et opplastingssvar skal ikke vente
  på en tredjepart, og SIGTERM ville kappet en 30-sekunders polling uansett).

## Beslutninger

**PERSENTILER, aldri snitt.** Samme lærdom som `worst` i `host-metrics.ts`, og
den er dyrekjøpt: Coolifys minnegraf viste 78 % under en hendelse der
OOM-killeren fyrte tre ganger, fordi den glattet. Et snitt over chat-målinger
ville skjult nøyaktig den halen brukeren kjenner.

**Median OG maks per fase, fordi de er ulike problemer.** Lav median med høy
maks er en utligger å forstå; høy median er arbeid å fjerne. Bare det andre er
en cache-kandidat.

**Dommen holdes tilbake under `MIN_SAMPLES_FOR_VERDICT` (20).** Tallene sies,
mønsteret ikke — samme form som `describeWeeklyIntensity` og
`MIN_OBSERVATIONS` i sultprediksjonen. Et cache-grep tatt på tre målinger kan
fjerne arbeid som ikke var problemet.

**`wall / sum` er parallelliseringens helse, og den står i dommen.** Nær 1
betyr at fasene i praksis kjører etter hverandre, og da er svaret å faktisk
starte dem parallelt — ikke å cache. Verktøyet skal si det framfor å la noen
cache seg forbi et rekkefølgeproblem.

**`parsePhases` er en hviteliste, ikke et cast.** `phases` er jsonb, altså en
generell beholder. Navnene er kode-literaler i dag, men et felt noen legger til
senere skal ikke følge med ut av et ÅPENT endepunkt. Samme regel som
`toPublicCronRun`. Verifisert med en rad skrevet MED et ekstra felt, gjennom
ekte jsonb.

**Nærmeste-rang-persentil, ikke interpolerende.** Med få målinger er en
interpolert verdi et tall som ikke ble målt, og det er verre enn et som ble.

## Funnet underveis: vinduet mistet den ferskeste raden

Verifiseringen mot ekte Postgres var **flakete** — 25 skrevne rader ble lest som
24, og den som forsvant var den nyeste.

Årsaken er reell og gjaldt også i prod: vinduets øvre grense settes i Node
(`Date.now()`), mens radene stemples av Postgres (`now()`). Skrives en rad et
øyeblikk etter at vinduet ble beregnet, faller den utenfor. Man spør om siste
time og mangler den ferskeste målingen — som er den man oftest er ute etter.

`NOW_SLACK_MS` (5 s) legges derfor til den **implisitte** «nå». Et eksplisitt
`until` er et historisk spørsmål og må være reproduserbart, så det respekteres
presis. Vindulengden måles fortsatt fra ankeret, så «60 minutter» er 60
minutter.

Feilen gjaldt `host`, `cron` og `jobs` like mye som `chat`. Den ble bare synlig
her fordi dette var det første tilfellet der en rad skrives og leses i samme
sekund.

## Verifisering

| Sjekk | Resultat |
|---|---|
| `npm test` | 4454 tester i 308 filer, grønt (16 nye) |
| `npm run check` | 0 feil, 0 advarsler |
| 25 målinger mot ekte PostgreSQL | aggregert riktig; utligger synlig i maks (900 ms), ikke i median (30 ms) |
| Dommen | «tyngste fase er «helsebriefing» med median 400 ms (p95 400, maks 400) — der ligger gevinsten» |
| `wall ≈ sum` | «fasene kjører nærmest etter hverandre (wall er 102 % av sum) — se på om de faktisk startes parallelt før du cacher noe» |
| Rad skrevet MED ekstra jsonb-felt | feltet nådde ikke svaret |
| Flakingen etter `NOW_SLACK_MS` | fem kjøringer, stabil |

## Kjent rest

- **Ingen cache er lagt inn.** Det var med vilje: dette er målingen som skal
  avgjøre hvor. Se på `chat` i `/api/diagnostikk` etter et døgns bruk.
- `wall/sum`-tallet fra testen er kunstig. Det ekte tallet avgjør om neste grep
  er en cache eller å faktisk parallellisere.
- Vi måler bare kontekstbyggingen fram til første modellkall, ikke modellsvaret.
