# Datakartlegging før flytting til egen plattform

Dato: 2026-08-21
Status: planlagt

## Kontekst

Resonans skal flyttes fra Vercel + Neon til egen plattform (Hetzner + Coolify +
PostgreSQL). Før noe flyttes må to spørsmål besvares, og de blandes lett:

1. **Hva kan hentes inn igjen fra et eksternt API, og hva kan det ikke?**
2. **Hvor fort kan det i så fall hentes?**

Dette dokumentet er svaret på hva vi *vet*, målt i koden 21. august 2026 — ikke
hva leverandørdokumentasjonen påstår. Leverandørgrenser er bevisst ikke sitert
her: de endres, og repoet lagrer dem ikke. Nederst står det hvordan de faktiske
tallene måles på ett kall.

**Hovedfunnet er at spørsmål 2 nesten ikke betyr noe.** Den billigste
migreringen er en `pg_dump`, ikke et API-kall.

## Målt: dagens synkfrekvenser

Fra jobbdefinisjonene i `src/routes/api/cron/jobs/+server.ts`.

| Kilde | Cron | Kjøringer/døgn |
|---|---|---|
| Dropbox | `*/5 * * * *` | 288 |
| Withings | `*/5 5-22 * * *` | ~216 |
| Tesla | `*/15 5-22 * * *` | 72 |
| SpareBank1 | `0 */6 * * *` | 4 |
| Spond | `0 2 * * *` | 1 |
| Strava | ingen cron — trigges fra Ekko | – |

Dette har gått i månedsvis uten å treffe et tak. **Steady state er altså
bevist trygt.** All risiko ligger i backfill.

## Målt: hvordan hver integrasjon håndterer å bli avvist

| Integrasjon | 429-håndtering |
|---|---|
| SpareBank1 | Fullt oppsett: samler `Retry-After` og `X-RateLimit-*`, tre forsøk med backoff (`fetchWithRetry` i `sparebank1.ts`). Henter kontoer sekvensielt, med kommentar om at det er for å unngå grensa |
| Withings | Ingen HTTP-429-håndtering, og det er riktig: Withings svarer `status !== 0` i **JSON-kroppen**. Begge kallstiene sjekker den (`withings.ts:207`, `withings-hr-recovery.ts:219`) |
| Tesla | Kaster `TeslaApiError` på 429. Ingen backoff |
| Strava | Kaster `StravaApiError` på 429. Ingen backoff |
| Dropbox, Spond | Ingen håndtering |

**Konsekvens for backfill:** en historikkjobb mot Strava eller Tesla vil
stoppe i stedet for å roe ned. Det må rettes *før* en slik jobb kjøres, ikke
etterpå.

Withings-koden bærer dessuten et målt råd i kommentaren over
`fetchWithingsIntradayActivity`: *«Withings anbefaler under 24 timer per
kall»*. Det er grunnen til at `withings-backfill` går dag for dag.

## Klassifisering: hva som kan hentes igjen

### Kan aldri hentes igjen — må flyttes

Alt brukeren selv har skrevet eller bestemt. Det siste er lettest å glemme,
fordi det ikke ser ut som data:

- Ernæringsloggen og sultmeldingene (`nutrition_log` under `manual`)
- Manuelle søvnlogger, forstyrrelser og dupper
- Livviddemålinger (`body_log`)
- Kroppsprofil, dagsmål, makromål, metrikkinnstillinger, `sensor_goals`
- Temaer, prosjekter, oppgaver, refleksjoner, memories, bok- og filmlister
- Chat-historikk (`conversations`, `messages`)
- Øktvurderinger (`workout_assessments`) — LLM-genererte og dyre å regenerere
- **Brukerens overstyringer:** `workout_suppressions`, `metadata.dismissed`,
  `sourceRejected`, `preferGps`/`preferHr`, `merchant_mappings`,
  `classification_overrides`, `bank_account_settings.savingsRole`

Den siste gruppa er hundrevis av små beslutninger tatt over lang tid. De
finnes ikke i noe API.

### Kan hentes igjen

- Withings: målinger, søvn, aktivitet — tilbake til 13. oktober 2017
- Strava-aktiviteter, Tesla, Spond
- GPX-filene (de ligger i Dropbox)
- TMDB- og Goodreads-metadata

### Målt 21. august 2026: SpareBank1 gir nøyaktig 24 måneder

Proben ble kjørt på ti kontoer. Resultatet er utvetydig:

| Konto | Rader | Eldste | Nyeste |
|---|---|---|---|
| Felleskonto Ekteskapet | 1800 | 2024-08-21 | 2026-08-20 |
| Brukskonto Kjetil | 2036 | 2024-08-21 | 2026-08-20 |
| Sparekonto Kjetil | 428 | 2024-08-21 | 2026-08-20 |
| Sparekonto Ekteskapet | 582 | 2024-08-25 | 2026-08-20 |
| Regningskonto | 435 | 2024-08-25 | 2026-08-16 |
| Nedbetaling | 7 | 2026-06-11 | 2026-08-19 |
| Barnas kontoer (3) | 3–6 | 2024-08-30 | 2025-12-30 |
| Europaferie | 0 | – | – |

**Fire kontoer starter på nøyaktig samme dag, 2024-08-21 — to år før
måledagen.** Det er ikke unge kontoer; det er et rullerende vindu.

Signalet er delt startdato, ikke antall rader. En ekte kort historikk gir
ULIK startdato per konto, siden hver konto har sin egen første transaksjon.
Verktøyet lette først bare etter runde radtall (sidegrenser) og kalte derfor
et toårsvindu «kort historikk» — 729 dager mellom eldste og nyeste lå én dag
under terskelen for «lang». `finnFellesGulv` ser det riktige signalet nå, og
måler vinduet fra **i dag** framfor fra nyeste transaksjon.

Banken sendte `X-RateLimit-Remaining: 58`. Kvoten finnes altså og eksponeres,
men vi traff den ikke med elleve kall.

**Men konklusjonen hviler på et kontrollspørsmål som må stilles.** Vår probe
spurte lenge UTEN datofilter, og mange API-er svarer da med et *standardvindu*
selv om de ville gitt mer til den som ber eksplisitt. Uten begge spørsmålene
kan vi ikke skille «banken har bare 24 måneder» fra «banken gir 24 måneder til
den som ikke spør bedre».

Proben stiller derfor nå begge: etter kontorunden spør den én gang til, på
kontoen med flest rader, med `fromDate=2015-01-01`. Kommer det data eldre enn
gulvet, var standardvinduet **vårt** problem — og da må all backfill oppgi
`fromDate` eksplisitt. Kommer samme svar, er vinduet bankens.

**Kontrollrunden er kjørt, og vinduet er bankens.** To uavhengige bevis:

1. **`fromDate=2015-01-01` ga HTTP 400.** Banken NEKTET å svare, framfor å
   returnere tom liste. Et tomt svar kunne betydd «ingen transaksjoner den
   gangen»; en avvisning betyr at datoen håndheves.
2. **Gulvet flyttet seg nøyaktig én dag på ett døgn.** Målt 21. august:
   2024-08-21. Målt 22. august: 2024-08-22. Et fast kutt ville stått stille,
   og et radtak ville ikke fulgt kalenderen. Det er et rullerende vindu, og
   dette er det sterkeste beviset vi har — det krevde bare tålmodighet.

Proben spør nå om **dagen før gulvet** framfor en vilkårlig gammel dato. Det
skiller «banken avviser gamle datoer generelt» fra «grensa går nøyaktig her»,
og en avvisning rapporteres som en måling framfor å bli en 500 hos oss.

**Konsekvens:** alt eldre enn 2024-08-21 finnes **bare hos oss**.
`canonical_bank_transactions` flyttes dermed opp i gruppa «kan aldri hentes
igjen». Hvor mange rader det gjelder er én spørring unna — kontooversikten i
`Sparebank1DiagnosticsSection` viser `minDate` per konto.

Det gjør bankdataene til det mest uerstattelige i hele basen: de er både
umulige å hente på nytt og vanskelige å rekonstruere manuelt.

## Beslutninger

**Migrering skjer med `pg_dump`, ikke med API-kall.** Alt som ligger i Neon
kopieres til den nye databasen. Ingen eksterne API-er røres. Da er
rate-limits irrelevante for selve flyttingen.

**«Kan dette hentes igjen?» er derfor ikke et migreringsspørsmål, men et
risikospørsmål:** hva mister vi hvis kopien svikter? Klassifiseringen over er
svaret, og den avgjør hva som må verifiseres ekstra nøye etter flyttingen.

**Sugerøret trengs bare til to ting:** hull vi aldri har hatt (HealthKit-årene
før oktober 2017, som går gjennom Ekko), og data vi bevisst dropper nå men
kanskje vil ha senere.

**Strava og Tesla får backoff før noen backfill kjøres mot dem.** Å oppdage
det midt i en historikkjobb er dyrere enn å fikse det nå.

## Verifisering

Tallene over er hentet slik, og kan hentes på nytt på samme måte:

```bash
# synkfrekvenser
grep -oE "'/api/cron/[a-z0-9-]+'|schedule: '[^']+'" src/routes/api/cron/jobs/+server.ts

# hvem håndterer 429
grep -rIlE "rate.?limit|429|retry.after|backoff" src/lib/server/integrations/
```

De faktiske leverandørgrensene måles med verktøy som allerede finnes.

**SpareBank1: knappen i `/settings/sources`** — «Sjekk hvor langt tilbake
banken gir oss data», på bankkortet under diagnostikken
(`Sparebank1HistoryProbeSection`). Den spør hver konto etter tur, viser antall
rader, eldste og nyeste dato, og konkluderer.

Verdikten har tre utfall, ikke to, og det er poenget:
`$lib/domain/economics/history-probe.ts` skiller «kan hentes igjen» og «kan
ikke hentes igjen» fra **«vet ikke ennå»**. Returnerer banken nøyaktig 100
(eller 200, 500 …) rader, har vi antakelig truffet en sidegrense — og da er
eldste dato et **gulv**, ikke sannheten. Historikken kan gå mye lenger
tilbake enn målingen viser. Et gjettet svar her ville blitt brukt til å
bestemme om det er trygt å slette noe.

Withings måles fortsatt med URL:

```
/api/sensors/withings/debug/coverage?from=2013-01-01&types=weight
/api/sensors/withings/debug/probe?from=…&to=…       → seks varianter av samme spørsmål
```

## Åpne punkter

- [x] ~~Trykk knappen og noter eldste transaksjon~~ — målt 21. august 2026:
      gulv 2024-08-21 på fire kontoer
- [x] ~~Kjør kontrollrunden og bekreft at vinduet er bankens~~ — bekreftet
      22. august 2026: HTTP 400 på eldre dato, og gulvet flyttet seg én dag
      på ett døgn
- [ ] Legg backoff på Strava og Tesla før historikkjobber
- [ ] Avklar hvilke domener som blir med på dag én — det avgjør hvor mye av
      kartleggingen som i det hele tatt er relevant
