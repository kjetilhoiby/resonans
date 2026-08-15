# «Skjul økt» overlever synken

Dato: 2026-08-15
Status: ferdig

## Kontekst

En treningsøkt fra Withings — 0,32 km på 5 timer, registrert fordi en treåring
startet sporingen på klokka mens den lå på gulvet — kom tilbake i aktivitetslista
hver natt, selv etter at brukeren trykket «Skjul».

Skjulingen virket. `POST /api/workouts/[activityId]/dismiss` satte
`metadata.dismissed = true`, `activity-layer` filtrerte klynga bort, og økta
forsvant fra flaten. Så skrev synken raden på nytt.

`SensorEventService` sin upsert (`upsert_sensor_datatype_timestamp`) satte
`metadata = excluded.metadata` — altså **hele** metadata-objektet fra synken, som
ikke vet noe om brukerens valg. `dismissed` ble strøket, og økta dukket opp igjen.

To ting gjorde feilen vanskelig å se:

- **Den er usynlig i basen.** Raden ser helt riktig ut etterpå; det finnes ingen
  feilmelding, ingen logglinje og ingen forskjell på «brukeren skjulte aldri
  denne» og «brukeren skjulte den, og vi kastet valget».
- **Den inkrementelle Withings-synken henter sju dagers overlapp hvert femte
  minutt** for å fange retroaktive revisjoner. «Hver natt» var derfor et
  underdrivende symptom — valget overlevde i praksis til neste synk-kjøring, og
  det brukeren la merke til var bare at økta var tilbake neste gang hen så etter.
  Alle økter yngre enn sju dager kunne ikke skjules i det hele tatt.

Feilen traff mer enn `dismissed`. Fire metadata-nøkler settes utelukkende av
eksplisitte brukerhandlinger, og alle fire ble strøket på samme måte:

| Nøkkel | Settes av | Betydning |
|--------|-----------|-----------|
| `dismissed` | `POST .../dismiss` | Hele økta er skjult |
| `sourceRejected` | `POST .../dismiss?scope=source` | Én kilde-registrering er avvist |
| `preferGps` | `POST .../source-role` | Denne kilden vinner på distanse/tempo/høyde |
| `preferHr` | `POST .../source-role` | Denne kilden vinner på puls |

Kilde-rollene forfalt altså like stille som skjulingen, bare uten et symptom
noen ville koblet til synken.

## Faser

### Fase 1: Brukerens nøkler navngis ett sted

`src/lib/domain/sensor-event-metadata.ts` (ny): `USER_OWNED_METADATA_KEYS` med
begrunnelsen, og `mergeUserOwnedMetadata` som ren funksjon. Den rene funksjonen
speiler SQL-uttrykket, slik at semantikken — brukerens nøkler vinner, synken får
revidere sine egne felt, en fjernet nøkkel kommer ikke tilbake — kan testes uten
database.

### Fase 2: Upserten løfter valgene tilbake

`sensor-event-service.ts` bygger `metadata` i ON CONFLICT DO UPDATE som

```sql
excluded.metadata || jsonb_strip_nulls(jsonb_build_object(
  $1::text, sensor_events.metadata->$2::text, …))
```

Synken skriver fortsatt sin egen metadata i sin helhet; brukerens nøkler legges
tilbake over. `jsonb_strip_nulls` fjerner nøkler den gamle raden ikke hadde —
`jsonb_build_object('dismissed', NULL)` gir `{"dismissed": null}`, og en
eksplisitt null ville sett ut som en verdi for en leser som gjør `? 'dismissed'`.

`write()` gikk samtidig fra JS-verdier til `excluded.*`, som er nøyaktig de samme
radene. De to skrivestiene hadde ellers ulike `set`-klausuler for samme operasjon,
og det er nettopp slik den ene rekker å drive fra den andre.

## Beslutninger

- **Brukerens valg gjelder AKTIVITETEN, ikke payloaden.** En revidert
  distanse eller en ny trackpoint-telling er ikke en grunn til å gjenåpne en økt
  brukeren har skjult. Synken får revidere alt den selv eier.
- **Hviteliste, ikke svarteliste.** Nøklene som bevares er navngitt. En ny
  nøkkel fra en integrasjon skal ikke måtte huske å melde seg ut; det er den
  brukerstyrte nøkkelen som er unntaket, og den er sjelden.
- **`::text` på begge sider av `->` er påkrevd, ikke pynt.** Operatoren er
  overlastet for `jsonb -> text` og `jsonb -> integer`, så en utypet parameter
  kan gi «operator is not unique» fra Postgres. Enhetstestene ville ikke fanget
  det, siden vi ikke mocker databasen — samme klasse feil som
  `data || $1::jsonb`-konkateneringen i HRV-flettingen.
- **Ingen automatisk filtrering av selve søppeløkta.** En 5-timers økt på 320 m
  passerer dagens støyfiltre (`sportType === 'unknown'`, og under to minutter uten
  spor). Fristelsen er å legge på en regel om urimelig lav fart. Den er avvist av
  samme grunn som automatisk kutting av glemt sporing ble revet ut igjen, se
  `2026-08-10-glemte-trackeren.md`: en sjelden hendelse skal ikke behandles som en
  systematisk skjevhet, og en fartsgrense ville tatt gåturer, fjellturer og
  økter der sporingen brøt sammen. Riktig svar er at brukeren skjuler den én
  gang — og at skjulingen så holder.
- **Ingen datamigrasjon.** Ingenting er ødelagt i basen; valgene ble kastet, ikke
  korrumpert. Brukeren trykker «Skjul» én gang til, og denne gangen står det.

## Verifisering

- `npm test`: 3420 tester i 249 filer, alle grønne. Sju nye i
  `sensor-event-metadata.test.ts`.
- `npm run check`: 0 feil, 0 advarsler.
- **Kjørt mot en ekte Postgres 16**, siden hele oppførselen bor i SQL som
  enhetstestene ikke rører. Feilen ble først reprodusert med den gamle klausulen
  (`metadata = excluded.metadata` → `dismissed` borte), deretter ble den nye
  verifisert med bundne parametere:
  - skjult økt overlever re-synk ✓
  - synken får revidere sine egne felt (`totalTrackPoints` 0 → 4,
    `duration` 18060 → 18120) ✓
  - gjenåpning holder — en slettet nøkkel gjenopplives ikke ✓
  - rad med `metadata = NULL` kaster ikke ✓
  - ingen «operator is not unique» med `::text`-castene ✓
