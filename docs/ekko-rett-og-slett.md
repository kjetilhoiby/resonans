# «Rett og slett» — kontrakt mot Ekko

Status: begge sider bygget (17. august 2026).

## Problemet

Felttest 17. august 2026: en elsykkeltur til jobb ble lagret som **løping**, og «tidenes
raskeste 5 km» — 12:25, mot verdensrekordens 12:35 — havnet i Ekko, Resonans og Strava.

Å rydde det krevde et curl-kall mot et admin-endepunkt. Og swipe-slettingen i Ekkos Feed
slettet bare den lokale JSON-fila: økta sto urørt i Apple Helse og i Resonans, med
rekorden intakt. **En sletting som bare gjelder ett av tre steder er verre enn ingen
sletting, fordi den ser ferdig ut.**

## Retting er hovedveien, sletting den smale

Turen skjedde. 8,3 km elsykkel er ekte data — det var merkelappen som var feil, og en
retting beholder dem. Sletting hører til ekte søppel: en fantomøkt på halvannet minutt,
et GPS-hopp.

Derfor er `PATCH` den brede stien og `DELETE` den smale, både i API-et og i menyen.

## Endepunktene

Begge tar Ekkos `sessionId` (den samme UUID-en `POST /api/apps/upload` fikk), og treffer
**bare rader Ekko selv skrev** — matchet på `data.sessionId`.

### Rett idretten

```
PATCH /api/apps/workouts/<sessionId>
{ "sportType": "eBiking" }
```

`sportType` normaliseres serverside (`normalizeSportType`), akkurat som i opplastingen, så
appen sender sin egen `rawValue` og slipper å kjenne Resonans' kanoniske navn (`e_bike`).
En ukjent idrett gir **400** med lista over kjente — en idrett ingen leser kjenner ville
fått økta til å forsvinne fra alle familiefiltre uten at noe sa fra.

```jsonc
{
  "matched": 1,              // antall Ekko-rader som ble rettet
  "sensorEvents": 1,
  "sportType": "e_bike",     // kanonisk form, etter normalisering
  "reprojectedFrom": "2026-08-17T00:00:00.000Z",
  "notCleaned": ["…"]        // lag Resonans bevisst ikke rører — vis dem
}
```

### Slett økta

```
DELETE /api/apps/workouts/<sessionId>
```

```jsonc
{
  "matched": 1,
  "sensorEvents": 1,
  "canonicalWorkouts": 1,
  "workoutNotifications": 1,
  "reaggregatedFrom": "2026-08-17T00:00:00.000Z",
  "looksMislabelled": ["<eventId>"],  // hvorfor den ble mistenkt; påvirker ingenting
  "notCleaned": ["…"]
}
```

### `matched: 0` er ikke en feil

Da svarer endepunktet **404**, og appen skal lese det som «Resonans hadde ingen rader for
denne økta» — ikke som at handlingen feilet. En økt som aldri ble lastet opp finnes ikke
der, og en feilmelding for det får brukeren til å tro at rettingen ikke gikk gjennom.

## Hva som ryddes, og hva som ikke gjør det

| Lag | Ved retting | Ved sletting |
|-----|-------------|--------------|
| `sensor_events` | `data.sportType` skrives om | slettes |
| `canonical_workouts` | reprojiseres (effort, bestEfforts, familie) | slettes |
| `workout_notifications` | står — turen finnes fortsatt | slettes |
| `sensor_aggregates` | reaggregeres fra døgnstart | reaggregeres |
| rekorder, VO2max, EF, formkurve | selvheler (regnes fra canonical ved lesing) | selvheler |

**Autohaking og målprogresjon rulles ikke tilbake.** Vi haker aldri av automatisk — å
slutte å hake for mye er trygt, å fjerne opptjent framgang er det ikke. Det står i
`notCleaned`.

**Andre kilder står igjen.** Beskriver Withings-klokka eller en GPX i Dropbox den samme
turen, er de ikke våre å rette herfra; dedupliseringen tar dem fra da av.

**Strava eier sin egen kopi.** Den må rettes i Strava, og Ekko sier det i kvitteringen —
også når alt annet gikk bra. En rekord som er borte i tre apper og står i den fjerde er
nettopp forvirringen 17. august skapte.

## Ekko-siden

`WorkoutCascade` (`Ekko/Services/WorkoutCascade.swift`) kjører de tre lagene og bygger
kvitteringen. To ting er verdt å vite:

- **Apple Helse kan ikke endre aktivitetstypen på en lagret økt.** En retting der er
  slett + skriv på nytt (`HealthKitExporter.reexport`), og vi kan bare slette det appen
  selv har skrevet — som er nettopp disse radene (`HKMetadataKeyExternalUUID` =
  `sessionId`).
- **Rekkefølgen er motsatt i de to.** Retting skriver lokalt først, så et senere feilet
  steg lar deg prøve igjen. Sletting sletter lokalt sist, for forsvinner kortet først og
  Resonans feiler, finnes det ikke lenger noe å trykke «slett» på.

Kvitteringen nevner **hvert lag som ikke ble endret**, med grunnen. En avslått
Helse-tilgang som bare havnet i loggen ville sett ut som at rettingen gikk gjennom overalt
— presis den feilen dette er bygget for å gjøre umulig.

## Vedlikeholdsveien

`POST /api/helse/trening/slett-okt?date=YYYY-MM-DD[&sport=running]` finnes fortsatt for
rader Ekko ikke skrev (klokka, Dropbox). `dryRun` er sant som standard. Den deler kjeden
med endepunktene over (`$lib/server/workouts/workout-cleanup.ts`) — to implementasjoner av
«rydd etter en økt» ville drevet fra hverandre, og den ene ville glemt et lag.
