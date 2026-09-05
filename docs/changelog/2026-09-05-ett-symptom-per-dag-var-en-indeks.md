# Ett symptom per dag var en indeks, ikke en beslutning

Dato: 2026-09-05
Status: ferdig

## Kontekst

Symptomkortet på Helse sto med «Ømme lunger» (startet i dag) og «Slimhoste»
(startet tre dager før). Brukeren la til «Tett nese» og fikk en HTTP 500 rett i
ansiktet:

```
HTTP 500: Failed query: insert into "sensor_events" ("id", "user_id", "sensor_id",
"person_id", "event_type", "data_type", "timestamp", "data", "metadata", "created_at")
values (default, $1, $2, default, $3, $4, $5, $6, $7, default) returning … (6bd12174)
```

Meldingen er avkortet nøyaktig der årsaken sto. Den var en duplikatnøkkel.

`sensor_events` har en delvis unik indeks —
`sensor_events_sensor_datatype_timestamp_unique` på
(`sensor_id`, `data_type`, `timestamp`) for alt som ikke er bank. Både
`symptom-log.ts` og `sick-log.ts` stemplet radene sine med *startdagen*
(`${dayKey}T12:00:00Z`) på den ene delte `tilstand_flag`-sensoren. Dermed leste
indeksen som en forretningsregel ingen hadde bestemt: **ett symptom per dag**.

Og flere symptomer samme dag er ikke kanten — det er normalen. Hele grunnen til
at symptomer ble en egen logg framfor felter på sykeperioden, var at man har
flere samtidig. Den første som ble skrevet den dagen vant, den andre fikk en 500,
og flaten hadde ingen vei rundt: den samme dagen ville feilet igjen ved hvert
forsøk.

Feilen kom seint fordi den krever to registreringer på én dato. De første
symptomene ble lagt inn på ulike dager, og da virket alt.

## Endringen

`timestamp` er registreringstidspunktet, i begge loggene. Det er dessuten det
doc-kommentarene i begge filene alt PÅSTO — «tidsstempelet er et
registreringstidspunkt og ikke en sykedag» — mens koden gjorde noe annet.
Sannheten om hvilke dager en rad dekker har hele tiden ligget i
`data.startDate`/`data.endDate`, og ingen leser rørte tidsstempelet.

- `src/lib/server/health/symptom-log.ts`: `timestamp: now` ved opprettelse.
- `src/lib/server/health/sick-log.ts`: samme, av samme grunn. To perioder med
  samme startdato er sjeldnere enn to symptomer samme dag, men fullt mulig —
  bryteren i `ReadinessStrip` skriver en periode som starter i dag, og et
  sykdomsvarsel som tilbakedaterer lander gjerne på en dag som alt har en. Samme
  500, uten en vei rundt.
- **Rettinger flytter ikke tidsstempelet.** Update-stiene satte det på nytt fra
  startdatoen. En rettet startdato er ikke en ny registrering, og et stempel som
  fulgte startdagen kunne dessuten flytte raden oppå en annen rads plass i
  indeksen — altså den samme 500-en, denne gangen ved redigering.

## Beslutninger

- **Ingen migrasjon.** Gamle rader beholder dagsstemplene sine. Leserne går på
  `data.startDate`, så de er uendret, og en ny rad med `now` kolliderer ikke med
  en gammel på kl. 12.
- **Ikke `conflictMode: 'ignore'`.** Det ville byttet 500-en mot en stille
  no-op — et symptom som så ut som lagret og ikke var det. Med et
  registreringstidspunkt krever en kollisjon at to skrivinger treffer samme
  millisekund på samme sensor, og det finnes ingen kallsti som gjør det: alle
  seks kallstedene til `saveSymptom`/`endSymptom` bruker sin egen `new Date()`,
  og innsjekken oppretter høyst ett nytt symptom per forespørsel.
- **Vinduene måles nå på registreringstidspunktet.** `SYMPTOM_LOOKBACK_DAYS` og
  `SICK_LOOKBACK_DAYS` filtrerer på `timestamp`, så en tilbakedatert rad faller
  nå *innenfor* vinduet selv om den startet før det — motsatt av dagsstempelet,
  og riktigere. En åpen periode eldre enn vinduet unnskylder uansett ingenting
  (`MAX_OPEN_SICK_DAYS` er 14).

## Verifisering

- `npm run check` — 0 feil.
- `npx vitest run` — 4576 tester i 315 filer, alle grønne. Ingen test dekket
  fella: kollisjonen bor i en databaseindeks, og vi mocker ikke DB. Regelen er
  derfor skrevet inn i CLAUDE.md og i filhodene, der neste datatype på
  tilstand-sensoren vil se den.
- `npm run build` — grønn.
