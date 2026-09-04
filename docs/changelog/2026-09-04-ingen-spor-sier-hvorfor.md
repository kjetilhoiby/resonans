# «Ingen brukbart spor» sier nå hvorfor

Dato: 2026-09-04
Status: ferdig

## Kontekst

Tørrkjøringen mot det ekte arkivet virket:

```
1012 ville blitt skrevet · 0 fantes fra før · 6 uten spor · 1 holdt ute
Tempo-kontroll mot 10 km på 52:30.
```

Tallene summerer (1012 + 6 + 1 = 1019), og den ene som ble holdt ute var
nøyaktig den forventede: 2. august 2019, 3,83 km på 15:22 (4:01/km) mot en
kurve som tilsier 19:00.

Men de **seks uten spor** var ikke til å granske. Lista navnga dem — og det var
navnene som avslørte problemet:

| Dato | Navn | Fil |
|---|---|---|
| 17. feb. 2026 | Morgenmølle | `.fit.gz` |
| 10. feb. 2026 | Formiddagsmølle | `.fit.gz` |
| 3. feb. 2026 | Morgenmøll 2 | `.fit.gz` |
| 3. feb. 2026 | Morgenmøll | `.fit.gz` |
| 16. aug. 2014 | Afternoon Ride | `.fit.gz` |
| 30. juni 2014 | Evening Walk | `.fit.gz` |

Fire tredemølleøkter (**mølle**) har ikke GPS — forventet. Men de er fra 2026
og burde hatt PULS, og en sykkeltur fra 2014 burde hatt GPS. Alle seks kom ut
som samme ord: `ingen-spor`. **En diagnose som ikke skiller årsaker er ikke en
diagnose**, og her skjulte den tre helt ulike tilstander:

1. en fil uten `record`-meldinger i det hele tatt (bare et sammendrag),
2. en fil med punkter, men uten posisjon (tredemølle),
3. en fil med punkter uten noe av verdi.

Bare den siste ville pekt på parseren.

## Faser

### Fase 1: `parseFit` returnerer diagnosen ved siden av resultatet

`FitParseResult = { workout, contents }`, der `contents` teller
`records`/`withPosition`/`withHeartRate`/`hasSession`.
`describeFitContents` gjør det til én setning: «bare sammendrag, ingen
tidsserie», «2 punkter, men uten posisjon og uten puls», «41 punkter (0 med
posisjon, 41 med puls)».

Posisjon telles bare for punkter med GYLDIG koordinat, så en fil der
semisirkel-konverteringen feilet ville rapportert 0 — ikke antall punkter.

### Fase 2: GPX/TCX teller punktene selv

De parserne rapporterer ikke hvorfor, så `decodeWorkoutFile` teller
`<trkpt`/`<Trackpoint` i teksten når resultatet er null. «ingen punkter i fila»
og «7 punkter i fila, men ingen med posisjon» er ulike svar, og det andre er
det som peker på oss.

### Fase 3: Detaljen følger til rapporten

`ImportOutcome` for `skipped` bærer `detail`, og kortet viser den framfor
`ingen-spor`.

### Fase 4: Blokkeringspanelet blandet inn et funn som ikke blokkerte

Den ene blokkerte raden viste:

> 3.83 km på 15:22 (4:01/km) — din egen kurve tilsier 19:00 **· 57:37 av
> 1:12:59 uten bevegelse (79 %)**

Panelet heter «holdt ute av tempo-kontrollen», og `for-lang`-funnet ble slått
sammen med ' · ' som om det også var en grunn. Nå står bare `for-rask`-funnet
som grunnen, og resten som «— også flagget: …».

Kontrasten er dessuten opplysende i seg selv: 79 % uten bevegelse på den økta
betyr at «4:01/km» er regnet av 15:22 bevegelsestid innenfor 1:12:59 elapsed.
Den er riktig holdt ute, men ikke nødvendigvis som feilmerket sport.

## Beslutninger

- **`existed` kan IKKE avsløre Withings-overlapp**, og en tidligere melding i
  denne tråden sa feilaktig at «0 fantes fra før» var signalet å se etter.
  `findAlreadyImported` er scopet til `sensor_id = <strava_export>` og slår opp
  `metadata->>'stravaActivityId'` — den finner altså bare rader **denne
  importen** selv har skrevet. Overlappet mot Withings fra oktober 2017
  håndteres ved LESING, av klyngingen på to timer i
  `buildUnifiedWorkoutActivities`. En tørrkjøring kan ikke vise det i det hele
  tatt.
- **Tredemølleøkter SKAL gi en økt når de har puls.** `parseFit` returnerer
  null bare når fila har hverken ≥2 posisjoner ELLER noen puls — en økt uten
  GPS men med pulskurve er verdt å ha. At de fire fra 2026 likevel kom ut som
  null betyr at de heller ikke hadde puls i fila, og det er nå synlig i
  rapporten framfor å måtte utledes.
- **Vi teller, vi gjetter ikke.** Diagnosen er tellinger fra fila, ikke en
  antakelse om hva slags økt det var. «Morgenmølle» er et navn brukeren skrev;
  det er ikke data.

## Verifisering

- `npm test`: **4539 tester i 313 filer**, alle grønne. 8 nye: 5 på
  `describeFitContents` (uten tidsserie, uten posisjon og puls, tredemølle med
  puls, bare gyldige posisjoner telles, og rapportering når fila ga en økt) og
  3 på `decodeWorkoutFile` sin grunn for GPX.
- `npm run check`: 0 feil, 0 advarsler.
- Ikke verifisert mot de seks ekte filene — de ligger i brukerens zip, ikke
  her. Neste tørrkjøring sier hva de inneholdt.

## Kjent rest

- De fire 2026-øktene ligger antakelig alt i Resonans fra Withings/Ekko, siden
  synken dekker 2026. Å hoppe over dem koster derfor sannsynligvis ingenting —
  men det er ikke bekreftet.
- De to fra 2014 er i årene importen finnes FOR. Er de tomme også etter
  diagnosen, er de tapt uansett kilde.
