# Mølleøkter fra Ekko (TCX uten posisjoner)

Status: implementert (september 2026). Kontrakt mellom `resonans` og `resonans-lab/ekko`
(`TREADMILL_SPEC.md` på Ekko-siden). Endrer du den ene siden, hold den andre i sync.

## Hva Ekko sender

Samme `POST /api/apps/upload` som for en tur ute, med to forskjeller:

| Felt | Ute | Mølle |
| --- | --- | --- |
| `file` | `track.gpx` | `track.tcx` |
| `sportType` | `running`, … | `treadmill` |

TCX-en har ett `<Trackpoint>` per sample **uten `<Position>`**, med `Time`,
kumulativ `DistanceMeters`, `AltitudeMeters` og `HeartRateBpm` når pulsen finnes.

- **Distansen er Ekkos, ikke GPS.** Den er integralet av farten brukeren taster inn
  (det mølla viser), skalert til det mølla sa ved slutt hvis brukeren kalibrerte.
- **Høyden er utregnet**: startverdi + distanse × stigning. Den stiger aldri ned, så
  `elevation` blir summen av stigningen — det mølla ville kalt høydemeter.

## Hva Resonans gjør med den

- `normalizeSportType` gjør `treadmill` til **`indoor_running`**, som alt er i
  løpefamilien, har tittel («Løpetur») og Strava-type (`Run`). `treadmill` hadde ingen av
  delene og var sin egen familie.
- `parseTcx` leser tid, puls og høyde fra **alle** punktene. `trackPoints` er fortsatt
  bare punktene med posisjon — altså tom for en mølleøkt, som er det ærlige svaret for
  kart og sporanalyse.
- Strava får fila i formatet den kom i (`data_type=tcx`) og `trainer=1` for alle
  `indoor_*`-typer, så økta vises som innendørs uten kart.

## Kjente begrensninger

- **Pulsserien lagres ikke i Resonans**, bare snitt/maks/min: serien bor i `trackPoints`,
  som krever posisjon. Strava får hele serien fra fila.
- **`/api/apps/strava/sync` (etterpåsynk) hopper over mølleøkter**: den bygger GPX fra
  lagrede `trackPoints`, og de er tomme. Auto-pushen ved opplasting er veien til Strava.
- Eldre Ekko-økter lagret som `treadmill` før normaliseringen er ikke skrevet om.
