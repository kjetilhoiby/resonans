# Øktanalyse fra Ekko

Kontrakten for `analysis`-feltet på `POST /api/apps/upload`. Serversiden bor i
`src/lib/domain/health/workout-analysis.ts`, Ekko-siden i `ResonansAPI.uploadGPX`.

## Hvorfor feltet finnes

**Dette er Resonans' eneste kilde til geografi i en økt.** Bakker, runder og strekk
finnes ikke i vurderingen med mindre de kommer herfra.

Resonans hadde en periode sin egen deteksjon over trackPoints. Den er fjernet: to
motorer som leter etter «en bakke» i samme spor blir aldri enige, og Ekkos versjon
er bedre på alle måter — den har navn og brukerens egen historikk. For strekk var
det uansett umulig i prinsippet, som `RunFeature` sier det selv: et strekk «finnes
i historikken og i hodet».

Konsekvensen er at **hullene i Ekkos deteksjon blir hull i vurderingen**. To er
kjent i dag:

- `lapDetectionActive` krever ingen valgt rute, ingen intervalløkt og ingen
  oppvarming — så runder telles bare i fri rundbanemodus.
- Bakkesegmenter finnes bare på **lagrede ruter**.

Sender Ekko ingenting, sier vurderingen ingenting om terreng. Den har fortsatt
distanse, tid, puls, kilometersplitter, effort og mål.

## Format

Ett valgfritt multipart-felt, `analysis`, med JSON som tekst.

```json
{
  "version": 1,
  "features": [
    {
      "kind": "hill",
      "name": "Dreperen",
      "startName": "Østensjøvannet",
      "endName": "Ulsrud",
      "startOffsetSec": 842,
      "durationSec": 131,
      "distanceMeters": 480,
      "elevationGainM": 42,
      "avgHeartRate": 168,
      "maxHeartRate": 179,
      "history": {
        "completions": 14,
        "medianDurationSec": 143,
        "medianAvgHeartRate": 174,
        "bestDurationSec": 128
      }
    }
  ],
  "laps": [
    {
      "index": 1,
      "distanceMeters": 400,
      "durationSec": 96,
      "avgHeartRate": 162,
      "history": { "completions": 30, "medianDurationSec": 101 }
    }
  ],
  "hillReps": [
    {
      "index": 1,
      "durationSec": 62,
      "distanceMeters": 210,
      "avgHeartRate": 171,
      "peakHeartRate": 182,
      "secondsInZone": [0, 0, 12, 38, 12]
    }
  ]
}
```

Alle tre listene er valgfrie. Er alle tomme, lagres økta uten analyse.

### `features`

| Felt | Krav | Merknad |
|---|---|---|
| `kind` | **påkrevd** | `hill` \| `track` \| `stretch`. Ukjent verdi → elementet forkastes |
| `name` | **påkrevd** | Tom/blank → forkastet. Et navnløst strekk er ikke til å skille fra terrenget serveren finner selv |
| `startName`, `endName` | valgfri | For rettede strekninger: «Østensjøvannet → Ulsrud» |
| `startOffsetSec` | valgfri | Sekunder fra øktas start. Plasserer strekningen i sporet |
| `durationSec`, `distanceMeters`, `elevationGainM` | valgfri | |
| `avgHeartRate`, `maxHeartRate` | valgfri | Utenfor 20–250 forkastes som sensorfeil |
| `history` | valgfri | Krever `completions`; uten den forkastes hele historikken |

**`avgPaceSecPerKm` sendes ikke** — serveren regner det av varighet og distanse.
To felt som kan motsi hverandre er ett felt for mye.

### `laps`

`index` (fylles inn av serveren hvis den mangler), `distanceMeters`,
`durationSec`, `avgHeartRate`, `history`.

### `hillReps`

Speiler `HillRep`. `secondsInZone` må ha nøyaktig lengde 5 (Z1..Z5) og ingen
hull — en delvis fordeling forkastes i sin helhet, fordi et hull ville blitt
lest som «null sekunder i Z3».

## Hva serveren gjør med dårlig input

Aldri feile hele opplastingen. GPX-en er det viktige, analysen er pynt oppå.

- Ugyldig JSON → analysen droppes, økta lagres
- Ett ødelagt element → det elementet droppes, resten beholdes
- For lange lister → kappes (40 features, 100 runder, 60 drag)
- Navn over 120 tegn → kappes

Alt som forkastes logges på serveren **og** returneres i svaret:

```json
{
  "ok": true,
  "eventId": "…",
  "analysis": { "features": 3, "laps": 8, "hillReps": 0 },
  "analysisWarnings": ["features: forkastet 1 ugyldig(e) element(er)"]
}
```

Sjekk `analysis` i svaret under utvikling. Er den `null` der du sendte noe, kom
ingenting gjennom — og uten dette feltet ville det sett ut som at Resonans bare
ignorerer analysen.

## Versjonering

`version` defaulter til 1. Feltene er additive: en eldre app som mangler et nytt
felt får `null` der, ikke en feil. Legger du til et felt, legg det i
`workout-analysis.ts` med en parser og en test — ikke bare i appen.
