# SpareBank1-tokenet: én vei inn, med lås og fersk lesing

Dato: 2026-09-03
Status: ferdig

## Kontekst

Brukeren måtte logge inn på SpareBank1 **fire ganger i løpet av ett døgn**. Det
tallet er selve diagnosen: et samtykke som går ut varer 90 dager, og et glidende
refresh token dør av inaktivitet over dager. Fire ganger på et døgn betyr at
kjeden blir **brutt**, ikke at den går ut på tid.

SpareBank1 roterer refresh-tokenet — hvert refresh-svar bærer et nytt, og det
forrige blir ugyldig. Standard OAuth-oppførsel ved rotasjon er dessuten *reuse
detection*: brukes et token som alt er rotert bort, invalideres hele familien.
Da er innlogging eneste vei tilbake, umiddelbart.

Vi hadde fire måter å produsere nettopp den gjenbruken på.

## Faser

### Fase 1: Legitimasjonen leses aldri fra et snapshot

`getValidSparebank1AccessToken(sensor)` tok et sensor-OBJEKT og leste
legitimasjonen fra det. Objektet ble hentet tidligere i flyten, og ingenting
garanterte at det fortsatt var gjeldende. Refresha en annen flyt i mellomtiden,
sendte denne et dødt refresh token.

Ny `$lib/server/integrations/sparebank1-token.ts`. Funksjonen tar nå bare `id`
og leser alltid fra basen.

### Fase 2: Refresh serialiseres

Cron (hver 6. time), jobbkø-workeren og knappene i `/settings/sources` kan alle
be om et token samtidig. To som ser et utløpt token, refresher begge med SAMME
refresh token.

En transaksjonsbundet advisory-lås per sensor (`pg_advisory_xact_lock`), og
legitimasjonen leses **på nytt inne i låsen**. Vant noen andre kappløpet, ser vi
deres ferske token og refresher ikke i det hele tatt.

Transaksjonsbundet, ikke sesjonsbundet som dispatcherens lederlås: vi skal holde
den i et øyeblikk, ikke være leder, og den slippes av commit/rollback uansett
hva som skjer. Egen nøkkelromsprefiks, så den ikke kolliderer med lederlåsen.

### Fase 3: Manglende `expires_at` betyr forny, ikke la være

Gaten var `if (credentials.expires_at && now >= credentials.expires_at - 60)` —
altså hoppet den helt over refresh når feltet manglet. Feltet mangler så snart
SB1 utelater `expires_in` i ett eneste svar, og da ble tokenet brukt til det
døde.

`shouldRefresh` (`sparebank1-token-rules.ts`, rent og testet) returnerer nå
`true` for manglende, ikke-numerisk eller uendelig `expires_at`. Å tvile skal
føre til et refresh, ikke til å la være.

### Fase 4: En ny `expires_at` arver aldri en gammel

Den gamle koden gjorde
`expires_at: refreshed.expires_in ? now + refreshed.expires_in : credentials.expires_at`.
Den gamle verdien lå per definisjon i fortida — det var jo derfor vi refresha.
Resultatet var et token som var permanent «utløpt», så **hvert eneste kall**
utløste et nytt refresh. Med rotasjon ble det en kjede av rotasjoner.

`resolveExpiresAt` gir alltid et tidspunkt i framtida: `expires_in` når den
finnes, ellers `FALLBACK_TTL_SECONDS` (10 minutter). Konservativt kort med
vilje — et for kort anslag koster én ekstra refresh, et for langt koster en 401
midt i en synk.

### Fase 5: Importen hentet et token per chunk

`processStep` i backfillen kalte `getValidSparebank1AccessToken` for **hver
100-transaksjoners chunk**. Sammen med fase 4 ga det ett refresh per chunk.

Tokenet ble aldri brukt der: transaksjonene ligger i payloaden, så steget gjør
ingen API-kall. Hentingen er fjernet, og `syncAllSparebank1Data` henter selv et
token **lat** hvis den mot formodning skulle trenge det (fallbacken finnes
fortsatt for en kontonøkkel som ikke er prefetchet).

### Fase 6: En 401 fører til refresh og ett nytt forsøk

`fetchWithRetry` håndterte bare 429. En 401 falt rett gjennom, og kalleren
kastet — så et token som døde før `expires_at` sa (tilbakekalt, klokkeavvik,
kortere levetid enn oppgitt) ble en hard feil bare innlogging kunne rette.

Ny `Sparebank1HttpError` bærer statuskoden som et FELT, og `callWithAuth` i
`runSparebank1Sync` gjør ett nytt forsøk etter refresh.
`refreshAfterUnauthorized` tar tokenet som fikk 401-en: er det lagrede et annet,
har noen alt rotert, og vi returnerer deres framfor å refreshe på nytt.

### Fase 7: Flaten sier fra når kjeden er død

`isExpired` regnes av `config.expiresAt` og at et refresh token *finnes* — men
et token SB1 har avvist ligger fortsatt i raden. Kortet sa derfor «Tilkoblet»
mens kjeden var død, og dataene bare stoppet. Status-endepunktet returnerer nå
`lastError`, og kortet viser den.

## Beslutninger

**Statusen er et felt, ikke en regex.** `probe`-endepunktet henter statuskoden ut
av en feiltekst, med en kommentar om at det ikke var verdt å endre signaturen for
et diagnoseverktøy. Nå er det verdt det: 401-retryen er en oppførselsavgjørelse,
og den skal ikke hvile på et meldingsformat. Meldingene er uendret, så probens
uttrekk virker fortsatt.

**Retryen er ÉN.** Går det andre forsøket også i 401, er det ikke tokenet som er
problemet, og en løkke ville bare brent refresh-kjeden fortere.

**Låsen droppes under neon-http.** Der finnes ingen sesjon å holde en lås på.
Re-lesingen inne i den kritiske delen gjelder uansett, og den er den viktigste
av de to halvdelene.

**Vi gjetter fortsatt på SB1s oppførsel — og slutter med det.** Om SB1 returnerer
`expires_in`, og om refresh-tokenet roteres, er nettopp det vi ikke visste. Hver
refresh logger nå
`[sb1-token] refresh sensor=… expires_in=… rotert=ja/nei gyldig_til=…`, søkbart
over `GET /api/admin/logs?grep=sb1-token`. Neste gang er det en måling, ikke en
hypotese.

## Verifisering

- `npm run check` — 0 errors, 0 warnings.
- `npm test` — 4228 tester i 296 filer, alle grønne (11 nye på `shouldRefresh` og
  `resolveExpiresAt`, inkludert de to gamle feilene: manglende `expires_at`, og
  en arvet utløpt verdi).
- `npm run build` — grønt.

## Kjent rest

**Årsaken er ikke bevist.** Fire innlogginger på et døgn passer med
rotasjons-gjenbruk, og alle fire veiene dit er lukket — men vi har ikke sett SB1
avvise et gjenbrukt token med egne øyne. Loggingen i fase 7 er det som gjør
neste runde etterprøvbar. Holder innloggingen nå, er det svaret; skjer det
igjen, sier loggen om det er `expires_in` som mangler, om tokenet roteres, og
hvor ofte refresh faktisk fyrer.

**Withings og Spond har samme struktur i gatene** (`expires_at`-sjekk uten
lås, ingen 401-retry). Withings synker hvert 5. minutt og holder kjeden varm, så
den har ikke vist symptomet — men mønsteret er det samme, og en lengre pause i
synken ville truffet den likt.
