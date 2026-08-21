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

### Vet ikke — må måles

**SpareBank1-transaksjoner.** Bank-API-er kapper som regel historikken.
`spending-analyzer.ts` leser «up to 13 months», men det er *vårt* vindu, ikke
nødvendigvis API-ets. Gir ikke SB1 oss 2019, hører
`canonical_bank_transactions` i gruppa over — og det er 2 245 rader ingen kan
skaffe på nytt.

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

De faktiske leverandørgrensene måles med endepunkter som allerede finnes.
Åpne dem innlogget:

```
/api/sensors/sparebank1/probe                       → kontoliste
/api/sensors/sparebank1/probe?accountKey=<key>      → antall, eldste/nyeste transaksjon,
                                                      og rate-limit-headerne
/api/sensors/withings/debug/coverage?from=2013-01-01&types=weight
/api/sensors/withings/debug/probe?from=…&to=…       → seks varianter av samme spørsmål
```

**SB1-proben uten datofilter er den viktigste**: den viser hvor langt tilbake
banken faktisk gir oss noe, og flytter dermed `canonical_bank_transactions`
mellom to av gruppene over.

## Åpne punkter

- [ ] Kjør SB1-proben og noter eldste transaksjon her
- [ ] Legg backoff på Strava og Tesla før historikkjobber
- [ ] Avklar hvilke domener som blir med på dag én — det avgjør hvor mye av
      kartleggingen som i det hele tatt er relevant
