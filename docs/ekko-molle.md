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
- **Pulskurven og fartskurven lagres i `data.samples`** (`time`, kumulativ `dist`, `ele`,
  `hr`), nedsamplet som sporet. Bare skrevet når sporet er tomt. Typen og leseren bor i
  `$lib/domain/health/workout-samples.ts`.
- Strava får fila i formatet den kom i (`data_type=tcx`) og `trainer=1` for alle
  `indoor_*`-typer, så økta vises som innendørs uten kart.

## Hvem leser `samples`

Et sample er et sporpunkt uten posisjon, pluss `dist`. `track-stats` og
`workout-analytics` bruker `dist` når **alle** punktene har den, i stedet for haversine.
Dermed virker de samme funksjonene på begge:

| Leser | Hvordan |
| --- | --- |
| Øktsiden (`/aktivitet/[id]`), fanen Graf | `profilePoints = profileSeries(trackPoints, samples)` — fart, høyde, puls, kilometersplitter, pulsfordeling. Kartet leser fortsatt bare `trackPoints`. |
| Øktanalysen (soner, tidsdeling, beste innsats, GAP) | `analysisSeriesSql` i `server/workouts/analysis-series.ts` — ett SQL-fragment for projeksjonen, reanalyze, analyse-endepunktet og athlete-context. |
| Etterpåsynken til Strava (`/api/apps/strava/sync`) | `buildIndoorTcx` bygger en TCX av samplene når sporet er tomt. |

**Ikke legg samples inn i `trackPoints`.** Kart, klyngespor, «glemte trackeren» og
pulstillit leser feltet som et GPS-spor.

## Kjente begrensninger

- Øktvurderingen (`workout-assessment`) får fortsatt bare `trackPoints`, så den ser ikke
  pulskurven for en mølleøkt — bare snitt/maks.
- Eldre Ekko-økter lagret som `treadmill` før normaliseringen er ikke skrevet om, og har
  ingen samples.
