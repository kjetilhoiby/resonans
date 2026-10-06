# Kontrakt: Akser → Resonans (tidslinje og steder)

Dato: 2026-10-06
Status: **bygget i Resonans** (fase 1, 6. oktober 2026). Akser-klienten er skrevet
(`resonans-lab/akser`, `AkserKit/Sources/Akser/Resonans/`), men ikke bygget eller kjørt ennå. Planen og
beslutningene bak står i `docs/changelog/2026-10-06-akser-integrasjon.md`.

Koden: validering i `$lib/domain/movement/` (`timeline.ts`, `places.ts`), lagring i
`$lib/server/movement/akser-store.ts`, endepunktene under `src/routes/api/apps/akser/`.

## Kort sagt

Akser (`resonans-lab/akser`) sporer posisjon i bakgrunnen og bygger en tidslinje av
**opphold** og **reiser**, der hver reise er delt i **etapper** med transportform. Tidslinjen
bygges i etterkant fra rå GPS-punkter som aldri forlater telefonen. Det er den ferdige
tidslinjen Akser sender hit, én Oslo-dag om gangen, og hver opplasting **erstatter** dagen.

Fire regler bærer resten:

1. **Rå GPS sendes aldri.** Bare utledede opphold og reiser, og stedenes koordinater.
2. **En dag erstattes i sin helhet.** Akser bygger dagen på nytt når algoritmen endres, når
   brukeren retter, og når en fasit-økt kommer inn. Starttidspunkter flytter seg da, og
   ID-er ville gitt duplikater. Serveren trenger derfor ingen stabile ID-er på opphold og reiser.
3. **En Akser-reise blir aldri en `workout`.** Samme tur skrives alt av opptil tre kilder
   (klokka, Dropbox, Ekko). En fjerde ville blitt talt med i kilometer, effort og streaks.
4. **En ukjent verdi avvises, den gjettes ikke.** En transportform eller et sted serveren ikke
   kjenner gir en feil på dagen, ikke en stille default.

## Autentisering

Som Ekko: `GET /api/apps/authorize?app=akser` åpnes i `ASWebAuthenticationSession`, og
Resonans svarer med en redirect til `akser://auth?secret=rsn_…`. Hemmeligheten lagres i
Keychain og sendes som `Authorization: Bearer rsn_…`.

Det krever:

- en oppføring `akser` i `APP_REGISTRY` (`src/lib/server/app-registry.ts`):
  `deepLinkScheme: 'akser'`, `sensorProvider: 'akser'`, `sensorType: 'location_tracker'`,
  `sensorSubtype: 'iphone'`;
- URL-skjemaet `akser` i Akser (`CFBundleURLTypes`).

Base-URL er `https://resonans.apps.hoi.by`. (Ekko faller i dag tilbake på en Vercel-adresse
som ikke finnes lenger; ikke kopier den.)

## Endepunkter

| Metode | Sti | Hva |
|---|---|---|
| `GET` | `/api/apps/akser/status?from=&to=` | Hvilke dager Resonans har, og fra hvilken generering |
| `PUT` | `/api/apps/akser/places` | Hele stedslista |
| `POST` | `/api/apps/akser/timeline` | 1–31 dager, hver erstatter det som lå der |
| `DELETE` | `/api/apps/akser/timeline?date=YYYY-MM-DD` | Slett én dag |
| `DELETE` | `/api/apps/akser/timeline?all=true` | Slett alt fra Akser |
| `GET` | `/api/apps/workouts?days=` | **Finnes alt.** Fasit for transportform (se under) |

Rekkefølgen ved en synk er **steder først, så dager**. En dag som peker på et sted
serveren ikke har fått, avvises.

### `GET /api/apps/akser/status`

```json
{
  "ok": true,
  "placesUpdatedAt": "2026-10-06T09:12:00+02:00",
  "days": [
    { "date": "2026-10-05", "generatedAt": "2026-10-06T06:01:00+02:00", "detectorVersion": "2026.10.1" }
  ]
}
```

Akser bruker svaret til å finne dager som mangler eller er generert av en eldre detektor,
samme mønster som `/api/apps/healthkit/coverage`. `from`/`to` er Oslo-datoer; default er
siste 60 dager fram til i dag, og vinduet er høyst 400 dager.

### `PUT /api/apps/akser/places`

```json
{
  "places": [
    {
      "id": "6f1c…",
      "name": "Hjemme",
      "category": "home",
      "lat": 59.93801,
      "lon": 10.76602,
      "radiusMeters": 120,
      "named": true,
      "archived": false
    }
  ]
}
```

- **Hele lista hver gang.** Et sted som mangler i lista arkiveres hos oss, det slettes ikke:
  gamle dager peker fortsatt på det.
- `category` er en av Aksers `PlaceCategory`: `home`, `work`, `gym`, `shop`, `restaurant`,
  `transport`, `recreation`, `friend`, `family`, `unknown`. Andre verdier gir 400.
- `named: false` er Aksers automatiske «Nytt sted». De lagres, men vises ikke med navn og
  kobles ikke mot Ekkos steder.
- Koordinatene trengs her, i motsetning til i tidslinjen. Uten dem kan Resonans ikke koble et
  Akser-sted mot et Ekko-sted, og ikke få en hjemadresse.

### `POST /api/apps/akser/timeline`

```json
{
  "days": [
    {
      "date": "2026-09-28",
      "generatedAt": "2026-09-29T06:12:00+02:00",
      "detectorVersion": "2026.10.1",
      "entries": [
        {
          "kind": "stay",
          "startedAt": "2026-09-28T00:00:00+02:00",
          "endedAt": "2026-09-28T08:03:00+02:00",
          "placeId": "6f1c…"
        },
        {
          "kind": "journey",
          "startedAt": "2026-09-28T08:03:00+02:00",
          "endedAt": "2026-09-28T08:25:00+02:00",
          "fromPlaceId": "6f1c…",
          "toPlaceId": "a90e…",
          "distanceMeters": 7240,
          "legs": [
            {
              "mode": "e_bike",
              "modeSource": "label",
              "confidence": 0.5,
              "startedAt": "2026-09-28T08:03:00+02:00",
              "endedAt": "2026-09-28T08:25:00+02:00",
              "distanceMeters": 7240,
              "labelRef": "c3d2…"
            }
          ]
        },
        {
          "kind": "stay",
          "startedAt": "2026-09-28T08:25:00+02:00",
          "endedAt": "2026-09-28T16:40:00+02:00",
          "placeId": null,
          "center": { "lat": 59.912, "lon": 10.748 }
        }
      ]
    }
  ]
}
```

**Felt:**

- `date` er en **Oslo-dato**. Alle tidspunkter er ISO 8601 med offset.
- `entries` er dagens fulle tidslinje, sortert og uten overlapp. Et opphold **eller en reise**
  over midnatt **klippes** til dagen av Akser og står da i begge dagene. En klippet reise og
  dens etapper får distansen fordelt etter tid.
- `generatedAt` er når Akser bygde dagen. Er det vi har lagret nyere, ignoreres opplastingen
  (`stale`), slik at et gammelt forsøk som kommer fram sent ikke overskriver en rettelse.
- `detectorVersion` er fritekst og lagres bare, så en endring i algoritmen kan spores. Akser
  bumper den (`TimelineDetector.version`) når deteksjonen endres, og bygger dager som står med
  en eldre versjon i statussvaret på nytt.
- Et opphold har `placeId` når det ligger på et kjent sted. Ellers har det `center`, **avrundet
  til tre desimaler** (~100 m). Det er det eneste koordinatet i tidslinjen, og grunnen til at
  det er med er at et ukjent sted er nettopp det ferie- og hytteflatene trenger.
- `mode` er en av: `walking`, `running`, `cycling`, `e_bike`, `driving`, `transit`, `unknown`.
  `still` og `noise` er Aksers interne verdier og sendes aldri.
- `modeSource` sier hvor transportformen kom fra: `user` (brukeren rettet), `label` (en
  overlappende økt fra Resonans) eller `auto` (Aksers klassifiserer). Akser velger i den
  rekkefølgen.
- `labelRef` er `id` fra `/api/apps/workouts` når `modeSource` er `label`. Den er en
  opplysning, ikke en nøkkel: en klynges id kan flytte seg når en ny kilde lander, så Akser
  matcher økter på tid hver gang dagen bygges.
- `confidence` er Aksers egen grove tillit (0–1). For `user` og `label` sendes det Akser
  hadde før overstyringen.

**Svar:** 200 med ett resultat per dag. Én dårlig dag stopper ikke de andre.

```json
{
  "ok": true,
  "results": [
    { "date": "2026-09-28", "status": "stored", "stays": 3, "journeys": 2 },
    { "date": "2026-09-29", "status": "stale" },
    { "date": "2026-09-30", "status": "rejected", "error": "unknown_place", "message": "entries[2].placeId finnes ikke i stedslista" }
  ]
}
```

| `status` | Betyr | Akser gjør |
|---|---|---|
| `stored` | Dagen er erstattet | ingenting |
| `stale` | Vi har en nyere generering | regner dagen som levert |
| `rejected` | Valideringsfeil, dagen er urørt | logger `message`; prøver ikke igjen før dagen er bygget på nytt |

Feilkoder: `invalid_date` (også samme dato to ganger i ett kall), `invalid_entry` (et felt
mangler eller har feil form — meldingen navngir det), `outside_day` (en oppføring ligger
utenfor dagen), `overlap`, `unknown_mode`, `unknown_place`, `invalid_leg` (en etappe utenfor
sin reise, eller slutt før start). Selve konvolutten feil (ikke JSON, over 31 dager) gir 400
for hele kallet.

Tidspunkter **må** ha offset (`Z` eller `+02:00`). Uten den tolkes de i serverens tidssone,
som er UTC i drift — et opphold kl. 08 ville landet kl. 10. Avviste dager skrives i
`lastError` på sensoren, så de synes i monitoreringen.

## Fasit: økter fra Resonans

Akser henter `GET /api/apps/workouts?days=` og bruker øktene som etiketter på overlappende
etapper. Lista er deduplisert på tvers av alle kilder (Ekko, klokka, Strava, Dropbox), og
rettelser gjort i Ekko er alt med.

| `sportType` i Resonans | Akser-etikett |
|---|---|
| `running`, `trail_running` | `running` |
| `cycling` | `cycling` |
| `e_bike` | `e_bike` |
| `walking`, `hiking` | `walking` |
| `indoor_running` og annet innendørs | ingen – ingen forflytning |
| alt annet (ski, svømming, yoga, …) | ingen – ikke en transportform |

- **En etikett er en egen kilde, ikke en brukerrettelse.** Den skrives ikke som
  `SegmentTransformation`, og den hentes på nytt hver gang dagen bygges. Retter Ekko økta,
  følger etiketten med.
- **Overlapp** måles som for Aksers rettelser: etappen ligger minst 80 % inne i økta, og
  dekker minst 50 % av den.
- **Start og slutt tas ikke fra økta.** Ekkos tider er knappetrykk, og «den glemte
  trackeren» finnes fordi stoppet ofte kommer for sent. Økta sier hva, Akser sier når.

## Åpne spørsmål

- **`center` på ukjente steder** er det eneste koordinatet i tidslinjen. Avrundingen til
  ~100 m er et forslag, ikke en beslutning.
- **Hvor ofte laster Akser opp?** Klienten synker når appen åpnes og når den går i
  bakgrunnen, høyst hver 30. minutt, og på «Synk nå». Bare ferdige dager (i går og bakover);
  de sju siste bygges hver gang, eldre dager bare når Resonans mangler dem eller har dem fra en
  eldre detektor. Backfillen tar 31 dager per runde. Synk ved bakgrunnsoppvåkning fra
  posisjon er ikke bygget.
- **Tesla som fasit for bil** krever et nytt endepunkt og er ikke med her.
