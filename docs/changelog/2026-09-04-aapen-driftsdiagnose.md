# Åpen driftsdiagnose — og en forbikjøring som alt var åpen

Dato: 2026-09-04
Status: ferdig

## Kontekst

3. september sto VPS-en stum i drøyt førti minutter: TCP på 80/443 ble
akseptert, men ingen HTTP-respons fullførte, og tre uavhengige apper var nede
samtidig. Mekanismen lot seg lese av Coolifys grafer (CPU mot taket, minne på
78 %, hull i målingene), men **hvilken jobb** som spiste maskinen krevde
`cron_executions` — og den lå bak auth.

Den som feilsøker en boks som ikke svarer har sjelden en hemmelighet for
hånden. Et diagnoseverktøy man ikke rekker er ikke et diagnoseverktøy.

## Funnet underveis: `?debug` var ingen bryter

Gaten i `/api/health` var:

```ts
const isAuthed = env.CRON_SECRET && authHeader === `Bearer ${env.CRON_SECRET}`;
const debug = url.searchParams.has('debug');
if (isAuthed || debug) return json(result);
```

`debug` sto i **ELLER** med autentiseringen, og `/api/health` er offentlig.
Parameteren var altså ikke et ekstra detaljnivå — den var en forbikjøring av
hele vakten. Målt mot prod 4. september ga `GET /api/health?debug` uten
legitimasjon full status, inkludert `topError` med rå exception-tekst.

Formen er verdt å kjenne igjen: **en flagg-parameter som SUPPLERER en
auth-sjekk med ELLER**, framfor å bli lest først etter at den er bestått.

## Hva

**`/api/diagnostikk` (åpent, eksakt match i `PUBLIC_API_EXACT`)** — cron-kjøringer
i et vindu med sti, status, varighet og tidspunkt, pluss jobbkøen som tellinger.
`?minutes=` (default 60, tak 1440) og `?until=<ISO>` for å se bakover:
«hva skjedde 12:48 i går» er `?until=2026-09-03T13:00:00Z&minutes=30`.

**`/api/health`** gir full status bare mot `Bearer $CRON_SECRET`. `?debug` er
beholdt som et harmløst alias fordi den står i dokumentasjonen, men gir ingen
tilgang. Den uautentiserte delen er uendret: `status` + `clock`, som er pulsen
vakthunden leser.

## Beslutninger

**Hvitelist felt, aldri svartelist dem.** `toPublicCronRun` BYGGER et nytt
objekt av fire navngitte felt. Den gjør ikke `delete rad.error` og sprer ikke
`...rad`. Forskjellen er hele garantien: en spread lekker hvert felt noen
legger til i `cron_executions` senere, uten at noen ser det. En test bruker en
rad med et ekstra felt og krever at det ikke følger med ut.

**To felt er konkret farlige, og det ene ser harmløst ut.** `error` er rå
exception-tekst med stier og id-er. `resultSummary` er verre nettopp fordi
navnet lyder som et aggregat — SB1-synken legger `accountNames` der, altså
brukerens kontonavn. Verifisert mot ekte Postgres med begge feltene fylt med
nettopp slikt innhold: ingen av delene når svaret.

**To skanser, ikke én.** Spørringen velger kolonner eksplisitt framfor
`select()` uten argument. Hvitelistingen i domenelaget ville holdt alene, men
den andre skansen koster ingenting og er synlig i en SQL-logg.

**Svaret sier HVOR man skal se, ikke HVA som sto der.** Det er nok til å finne
jobben som spiste maskinen; meldingen krever fortsatt legitimasjon. Det er den
bevisste grensa, og den er grunnen til at endepunktet kan være åpent i det hele
tatt.

**`/api/admin/logs` forblir admin-gatet.** Ringbufferen tar imot hva som helst,
inkludert `[500]`-linjer med brukerinnhold. Et åpent API over den kan ikke
gjøres trygt ved utvelgelse, fordi det ikke finnes felt å velge mellom.

**Eksakt match, ikke prefiks.** Et framtidig `/api/diagnostikk/detaljer` skal
måtte be om tilgang selv. Samme vakt som `/api/health` fikk i august 2026 etter
tre bugs av den motsatte feilen.

**Vinduet har tak.** Uten grense er et uautentisert endepunkt en gratis
tabelldump: `cron_executions` vokser med ~630 rader i døgnet. `clamped: true`
sier fra at det ble kappet framfor å gjøre det stille.

**Ugyldige parametere faller til defaulten framfor 400.** Dette er et verktøy
man skriver for hånd i en adresselinje.

## Verifisering

| Sjekk | Resultat |
|---|---|
| `npm test` | 4338 tester i 303 filer, grønt (35 nye) |
| `npm run check` | 0 feil, 0 advarsler |
| Mot ekte PostgreSQL med `error` og `resultSummary` fylt med kontonavn og stier | verken kontonavn, `accountNames`, exception-tekst eller filsti i svaret |
| Rad utenfor vinduet | ikke med |
| `?until` tre døgn tilbake | henter nettopp den raden |
| Tregeste jobb øverst | `/api/cron/tung-jobb`, 91 000 ms |
| Feilet kjøring | `failed: true`, ingen melding |
| Jobbkø | `{ failed: 1, queued: 2 }`, ingen rader |
| `canSeeFullHealth` | avviser `?debug`, feil bearer, manglende «Bearer », og er fail-closed uten `CRON_SECRET` |

## Kjent rest

`/api/health` kan ikke autentiseres med session: den står i `PUBLIC_API_EXACT`,
så `locals.userId` settes aldri. Full status krever derfor `CRON_SECRET` også
fra en innlogget nettleser. Det var slik før også — `?debug` skjulte det.
