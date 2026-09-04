# Rekordlenka og triagen ved import

Dato: 2026-09-04
Status: ferdig

## Kontekst

Distanserekord-kortet listet fem tider uten en vei videre. Brukeren så
«10 km · 52:00» og «4 km · 4:00/km» og kunne ikke etterprøve noen av dem:

> «Persen min på mila er 52 minutter i nedoverbakke. 4k på 4:00/k også veldig
> suspekt. Tror ingen av de der står. Hvis jeg får med kart og en måte å klikke
> meg fra rekordliste til konkret aktivitet, kan jeg se kartet og avgjøre om
> trackingen er feil sport eller bare bør holdes utenfor canon.»

Det er den riktige mekanismen, og bedre enn den automatiske tempo-vakta som ble
foreslått: en terskel satt av oss ville blitt kalibrert mot en fart vi ikke har
noe grunnlag for å anslå, og en økt kastet ut av canon på et gjett er verre enn
en rekord brukeren selv kan avvise. Samme skille som «et forslag, aldri en
korreksjon» i `moving-time.ts`.

Samtidig står arkivimporten fra Strava og venter. 1120 aktiviteter fra 2012 og
utover skal inn, og de radene lander rett i lister som er «min over alt» eller
«snitt over alt».

## Faser

### Fase 1: Rekordlista lenker til økta

`src/lib/server/training-dashboard.ts`,
`src/lib/domain/health/distance-records.ts`,
`src/lib/components/domain/health/DistanceRecordsCard.svelte`.

**Loaderen sendte ALDRI en id som kunne lenkes til.** `RecordWorkout.activityId`
er dokumentert som «`sensor_events.id` for klyngen», men `loadDistanceRecords`
satte `activityId: row.id` — altså `canonical_workouts.id`, en helt annen uuid.
`/aktivitet/[id]` slår opp `sensor_events` med `dataType = 'workout'`, så en
lenke bygget av den verdien ville gitt 404 uten forklaring. Feilen var usynlig
så lenge ingen lenket noe sted.

Riktig id er klyngens ELDSTE evidence-event (`evidence[0].eventId`), som er
nøyaktig det `buildUnifiedWorkoutActivities` bruker (`events[0].id`) —
rekordlista og aktivitetslista peker derfor samme sted.

`activityId` er nå `string | null` gjennom hele kjeden. Rader uten evidence
(skrevet før projeksjonen bar feltet) vises som rad UTEN lenke; en lenke som
ikke virker er verre enn ingen.

Aktivitetssida trengte ingen endring — kart, kilometersplitter, pulsfordeling og
«Skjul økt» ligger alt der.

### Fase 2: Triage ved import

`src/lib/domain/health/import-triage.ts` (+ tester),
`scripts/triage-strava-export.mjs`.

Fire akser, og de har HVER SIN skade nedstrøms — det er derfor de er fire og
ikke ett kvalitetstall:

| Akse | Hva som er galt | Hvem som betaler |
|------|-----------------|------------------|
| for-rask | feil sport, GPS-hopp, kjøring | distanserekorder — permanent, «min» glemmer ikke |
| for-langsom | gåtur merket som løp | tempo- og EF-trender |
| for-kort | GPS-fragment, glemt start | øktantall, streaks, «nr. 50 i år» |
| for-lang | glemt å stoppe sporingen | effort (`data.duration` er elapsed) |

Målt på eksporten, med 10 km på 52:00 som referanse:

```
for-rask        8 / 556
for-langsom     9 / 586
for-kort       34 / 1120
for-lang       48 / 1120
```

De fire øverste på for-rask-lista er 21,4 km på 2:49/km, 22,1 km på 3:10/km,
2,5 km på 2:48/km og 3,8 km på 4:01/km — altså sykkelturer merket `Run`, og
nøyaktig de radene som ville blitt stående som rekorder. De tre nederste ligger
innenfor ett sekund per km av brukerens egen kurve; de er grensetilfeller, og de
koster ingenting fordi lista RANGERER framfor å bestå/stryke.

## Beslutninger

- **Tempo-referansen er en PARAMETER, aldri en konstant.** Et hardkodet tempo
  arver stille feilen i den kroppen det en gang ble satt for — samme lærdom som
  `MET_CALIBRATION`, der 2,5 svarte til en HRR modellen aldri hadde ment.
  `--pr meter:sekunder`; uten den er for-rask-aksen AV framfor å gjette.
- **Riegel (`T2 = T1 × (D2/D1)^1.06`) framfor en terskel per distanse.** Fire
  tall kan drive fra hverandre; én eksponent kan det ikke. Men Riegel er
  validert fra ~1500 m og opp, og ekstrapolert NEDOVER spår den for treg tid —
  en helt normal 400-meter ville blitt flagget. `MIN_PACE_AXIS_METERS` (1500)
  gjør at korte distanser bare dømmes av for-kort-aksen. En flat terskel flagget
  20 økter med 14 falske positive der Riegel flagger 8.
- **For-rask gjelder BARE løping.** Farten på sykkel avgjøres av terreng, vind og
  motor — samme begrunnelse som at tempo-rekorden i krydderet er løping alene.
- **For-langsom måles på BEVEGELSESTID, for-lang på gapet mot elapsed.** Bruker
  begge elapsed, blir en løpetur med et langt kaffestopp stemplet «gåtur», og
  den ene raden får to funn som beskriver samme sak. Mangler bevegelsestid, sier
  setningen det i klartekst framfor å la et elapsed-tempo se ut som en måling.
- **`MAX_STOPPED_SHARE` (0,3) er høyere enn `NOTABLE_STOPPED_SHARE` (0,2).** Der
  er spørsmålet «var det mye stopp i denne økta», som er interessant på en flate
  du alt har åpnet; her er det «glemte jeg å stoppe klokka», og bylufting med
  lyskryss ligger fint over 20 %. `suggestForgottenTracking` er fortsatt den
  finere målingen — den leser sporet — men den krever trackPoints, og denne
  aksen skal virke før én fil er lastet ned.
- **Distansegulvet er sport-avhengig, og familier uten oppføring dømmes ikke.**
  800 m på sykkel er en tur som ble avbrutt, 800 m til fots er en tur rundt
  kvartalet som fant sted. Å gjette et gulv for «tennis» er å finne opp en regel.
- **Ranger, ikke bestå/stryk.** Modulen kaster ingenting; den sorterer på hvor
  langt utenfor raden ligger og sier hva funnet KOSTER (`consequence`). Uten den
  setningen er «severity 0,68» et tall uten en handling bak.
- **Dekningen rapporteres per akse.** «0 funn» og «0 vi kunne se etter» er ulike
  svar, og bare det andre betyr at eksporten mangler et felt — uten tallene ser
  en eksport uten bevegelsestid ut som en ren eksport. Samme regel som
  `socialFilterable` og `curveSample.eligible`.

### Feller i selve eksporten

- **Overskriftene er IKKE unike.** «Totaltid» og «Distanse» står to ganger i
  Stravas CSV: den første er en visningsstreng (minutter, km), den andre
  råverdien (sekunder, meter). Kolonnene slås derfor opp på INDEKS, og den SISTE
  forekomsten er den vi vil ha. Et oppslag på navn gir én av dem, og hvilken
  avhenger av parseren — «45» lest som meter ville sett ut som et GPS-fragment.
- **Aktivitetstypen er på brukerens SPRÅK**, ikke en api-verdi: `Løpetur`,
  `El-sykkeltur`, `Langrenn`. Kartet er mot norsk tekst, og en ukjent type
  sendes videre uendret — `workoutSportFamily` gir `other`, og de
  sport-avhengige aksene holder da kjeft.

## Verifisering

- 20 nye tester på `import-triage.ts`, 3 på `activityId` gjennom
  `distance-records.ts`. `npm test`: 4411 tester i 305 filer, alle grønne.
- `npm run check`: 0 feil, 0 advarsler.
- Skriptet kjørt mot den ekte eksporten (1120 aktiviteter): tallene over.

## Kjent rest

- Ingen flate leser triagen ennå — den er et skript. Den hører i importflyten
  når den bygges.
- `for-lang` kan ikke skille «glemte å stoppe» fra «gikk tur med hunden midt i»
  uten sporet; `suggestForgottenTracking` er koblingen som mangler.
- Ingen sammenligning mot brukerens egen tempo-historikk (bare mot ÉN
  referanse). En referanse per distanse ville fanget en 5 km-rekord satt på
  sykkel som en 10 km-referanse slipper gjennom.
