# Brief til Ekko: vektbackfill fra Apple Health

Dato: 2026-08-09
Status: bygget på begge sider. Ikke kjørt mot ekte HealthKit-data ennå.

## Kort sagt

Ekko leser vekthistorikken fra HealthKit på telefonen og sender den til Resonans i
bolker. Det er en **engangsjobb** for perioden før oktober 2017 — ikke en løpende synk.
Withings dekker alt fra oktober 2017 og framover, og skal fortsette å gjøre det.

Gevinsten er fire år ekstra vekthistorikk på Resonans' vektflate: fra 13. oktober 2017
tilbake til desember 2013.

## Hvorfor

Vektflaten i Resonans bruker dybden i historikken til å si ting som «laveste trend siden
mars 2019» og «største nedgang på 90 dager». Withings-kontoen gir 1 205 veiinger, men
starter brått 13. oktober 2017. Health Mate-appen viser en sammenhengende kurve fire år
lenger tilbake — 8. desember 2013, med et merket punkt på 107,5 kg 1. juli 2014.

De to påstandene kan ikke stemme samtidig, så vi spurte Withings' API på seks måter mot
samme vindu:

| variant | målinger | eldste |
|---|---|---|
| `meastypes` + `category=1` + datovindu (som synken) | 0 | — |
| `meastype=1` (entall) + `category=1` + datovindu | 0 | — |
| `meastypes` + datovindu, uten `category` | 0 | — |
| `category=2` (mål/objectives) + datovindu | 0 | — |
| **`lastupdate=0`, hele historikken, paginert** | **1 337** | **2017-10-13** |
| ingen dato, ingen `lastupdate`, paginert | 1 337 | 2017-10-13 |

De to siste er de avgjørende: **ingen datofilter i det hele tatt**, paginert helt ut.
Eldste måling bak OAuth-tilsagnet er 13. oktober 2017. Det er ikke et vindu vi ba feil
om — det er kanten på det som finnes.

Forklaringen er at Health Mate **leser** fra Apple Health og tegner det inn i sine egne
grafer uten å laste det opp til Withings. Withings-vekta kom i oktober 2017; alt før det
kom fra en annen app, er synlig i Health Mate og usynlig for `getmeas`.

Signaturen passer: en hard kant framfor en uttynning, kanten på datoen enheten kom, og en
sammenhengende kurve i appen tvers over kanten.

**Konsekvens:** de årene kan ikke hentes gjennom noe API vi rår over. De ligger i Apple
Health på telefonen, og Ekko er det eneste vi har som kan lese dem.

## Kontrakten

`POST /api/apps/healthkit/weight`

**Bygget.** `src/routes/api/apps/healthkit/weight/+server.ts`, med tolkningen i
`$lib/domain/health/healthkit-weight.ts`. `/api/apps/event` finnes også, men tar én
hendelse per kall — 4 000 målinger er 4 000 rundturer, og det er feil verktøy.

### Autentisering

`Authorization: Bearer rsn_…` — samme hemmelighet Ekko allerede bruker mot `/api/apps/*`.
Opprettes i Resonans under `/settings/external-apps`.

### Forespørsel

```json
{
  "samples": [
    {
      "timestamp": "2014-07-01T06:42:00Z",
      "weight": 107.5,
      "fatRatio": 28.4,
      "fatFreeMass": 76.9,
      "sourceName": "Health Mate",
      "sourceBundleId": "com.withings.wiScaleNG",
      "uuid": "9C4D2A61-…"
    }
  ]
}
```

| felt | påkrevd | enhet | merknad |
|---|---|---|---|
| `timestamp` | ja | ISO-8601 UTC | HealthKit-samplets `startDate` |
| `weight` | ja | kilogram | 20–400, ellers forkastes raden |
| `fatRatio` | nei | **prosent, 0–100** | HealthKit gir 0–1. Må ×100 |
| `fatFreeMass` | nei | kilogram | `LeanBodyMass` |
| `sourceName` | nei | tekst | lagres i metadata, gjør en rad sporbar |
| `sourceBundleId` | nei | tekst | samme |
| `uuid` | nei | tekst | HealthKits `UUID`, lagres i metadata |

Maks **500 samples per kall**. Over det: `413`.

Muskelmasse, beinmasse og hydrering finnes ikke som standardtyper i HealthKit. De blir
stående tomme, og det er greit — leseren i Resonans håndterer manglende felt.

### Svar

```json
{
  "received": 500,
  "inserted": 431,
  "skippedExistingDay": 62,
  "skippedInvalid": 7,
  "oldest": "2013-12-08",
  "newest": "2017-10-12",
  "warnings": []
}
```

`skippedExistingDay` er ikke en feil — se dedup-regelen under. `skippedInvalid` skal være
0 i praksis; er den det ikke, si fra, så ser vi på valideringen sammen.

`inserted` er rader skrevet under `healthkit`-sensoren, ikke «nye rader». Sender dere
samme bolk to ganger, får dere samme tall begge gangene — radene oppdateres framfor å
dupliseres, og en 0 ville sett ut som en feil.

`oldest`/`newest` er Oslo-døgnspennet for radene som **faktisk ble skrevet**, ikke for
bolken som kom inn. Ble alt hoppet over, er begge `null`.

`warnings` er setninger, ikke koder — vis dem til brukeren. Den viktigste er
prosentfella: kommer det fettprosenter under 1, sier advarselen at verdien må ganges med
100, og at vekta ble lagret uten den. Tom liste betyr at bolken gikk rent inn.

### Regler på serversiden

1. **Egen sensor.** Radene skrives under provider `healthkit`, ikke under Withings-
   sensoren. Importen er dermed synlig som kilde og kan angres ved å slette én sensors
   hendelser.
2. **Dagnivå-dedup: Withings vinner.** Enhver Oslo-dag som allerede har en vektmåling fra
   en *annen* sensor hoppes over i sin helhet. Fra oktober 2017 skriver Health Mate sine
   egne målinger til Apple Health også, så eksporten inneholder de 1 205 veiingene vi
   allerede har — med tidsstempler som kan avvike noen sekunder. Eksakt-tidsstempel-dedup
   ville sluppet dem gjennom som ekstra rader. Hele lesestien snitter uansett per dag, så
   dagen er den ærlige grensa.
3. **Idempotent.** Samme bolk sendt to ganger oppdaterer framfor å duplisere. Bolkene er
   uavhengige og kan sendes i vilkårlig rekkefølge; ved en avbrutt import er det trygt å
   begynne forfra.
4. **Ingen leser må endres.** Alt i Resonans som leser vekt filtrerer på bruker og
   datatype, ikke på sensor. Radene dukker opp på vektflaten, i målprogresjon, i
   ukeplanen og i widgetene uten en eneste kodeendring i lesestien.

## HealthKit-siden

### Typene

| HealthKit-type | be om enheten | blir til |
|---|---|---|
| `HKQuantityTypeIdentifierBodyMass` | `HKUnit.gramUnit(with: .kilo)` | `weight` |
| `HKQuantityTypeIdentifierBodyFatPercentage` | `HKUnit.percent()` | `fatRatio` **×100** |
| `HKQuantityTypeIdentifierLeanBodyMass` | `HKUnit.gramUnit(with: .kilo)` | `fatFreeMass` |

Fett og lean mass er **egne samples** i HealthKit, ikke gruppert som Withings'
`measuregrps`. Knytt dem til en vektmåling bare når tidsstemplene ligger innenfor
±60 sekunder av hverandre. Kroppssammensetning uten vekt er ubrukelig for oss — den
forkastes uansett på serversiden.

### Stegene

1. Be om lesetilgang til de tre typene.
2. `HKSampleQuery` uten predikat, `limit: HKObjectQueryNoLimit`, sortert stigende på
   `startDate`.
3. Lokal dedup: dropp samples med identisk verdi (avrundet til 0,1 kg) på samme minutt.
   Apple Health samler opp kopier fra hver app som har skrevet den samme veiingen.
4. Del i bolker på 500 og POST sekvensielt. Stopp ved 4xx, prøv igjen med backoff ved
   5xx.
5. Vis brukeren hva som faktisk ble sendt — antall, eldste og nyeste dato. Ikke bare
   «ferdig».

**Ikke bygg løpende synk.** Withings dekker alt fra oktober 2017. En `HKObserverQuery`
her ville bare produsert rader som blir hoppet over av dedup-regelen.

## Feller

**`HKUnit.percent()` gir 0,223 for 22,3 %.** Sender dere 0,223 som `fatRatio`, regner
Resonans fettmassen til 0,18 kg. Vi validerer 1–75 og forkaster resten, så feilen blir
synlig framfor stille — men den er verdt å teste før dere sender noe.

**Lesetilgang i HealthKit er usynlig for appen.** Appen kan ikke se om brukeren avslo:
et avslag gir et tomt resultat, akkurat som «ingen data». Derfor punkt 5 over — rapporter
alltid hva som ble funnet, og la null treff se ut som et spørsmål, ikke som suksess.

**`startDate` er tidspunktet, ikke `endDate`.** For en vektmåling er de like, men bruk
`startDate` konsekvent så det ikke oppstår sprik hvis en kilde skriver et intervall.

**Tidssoner.** Send UTC. Resonans grupperer på Oslo-døgn selv, og en dato uten tidssone
havner på feil dag rundt midnatt.

## Verifisering

Etter importen skal `/tema/vekt` i Resonans vise `historyStart` i 2013, og milepælkortet
skal kunne referere til perioder før 2017. Vi ser på det tallet fra vår side og bekrefter.

## Arbeidsdeling

**Resonans bygger:** `POST /api/apps/healthkit/weight`, `healthkit` i app-registeret,
dagnivå-dedup mot eksisterende vektrader, validering og enhetskonvertering, og tester for
de rene delene.

**Ekko bygger:** HealthKit-tillatelse, spørringen, lokal dedup, bolking og opplasting, og
statusvisningen til brukeren. **Bygget** — `ekko/Ekko/Ekko/Services/WeightBackfillPlan.swift`
(ren logikk, med tester), `HealthKitWeightBackfill.swift` (spørring og opplasting),
`Views/WeightBackfillSettingsSection.swift` (knappen i Innstillinger). Oppsummeringen på
appsiden: `ekko/HEALTHKIT_VEKT_BACKFILL.md`.

**Avklares sammen:** ingenting kritisk. Si fra hvis 500 per bolk er upraktisk fra
appsiden — taket er vårt valg og kan justeres.
