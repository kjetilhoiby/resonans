# Svarteliste for treningsøkter

Dato: 2026-08-16
Status: ferdig

## Kontekst

Søppeløkta (0,32 km over fem timer, sporing startet av et uhell) kom tilbake
igjen — denne gangen etter at brukeren hadde **slettet den hos Withings**.

Det avdekket noe eget, og noe verre enn metadata-feilen fra dagen før:
**Resonans fjerner aldri rader en kilde slutter å returnere.** Synken er
additiv. En sletting ved kilden propagerer altså ikke i det hele tatt — raden
fra en tidligere synk blir bare stående.

Til sammen har den samme økta nå kommet tilbake på tre ulike måter i løpet av
én uke:

1. Synken overskrev `metadata` ved upsert, så `dismissed` forsvant
   (`2026-08-15-skjul-okt-overlever-synken.md`).
2. Brukeren slettet økta hos Withings — ingen effekt, se over.
3. En rad med revidert starttidspunkt ville fått ny id og ikke arvet flagget
   i det hele tatt.

Fellesnevneren: `metadata.dismissed` sier «skjul denne **raden**». Brukeren
mener «denne **økta** skjedde ikke». Det er to ulike utsagn, og flagget bor
dessuten på et sted synken eier og skriver.

## Faser

### Fase 1: En tabell utenfor sensor_events

`workout_suppressions` (migrasjon `0059`): `user_id`, `start_time`,
`sport_family`, `source`. Ingen synk skriver her — det er hele poenget.

Matching skjer på **tidspunkt + sportsfamilie**, ikke på rad-id, nettopp for å
være uavhengig av hvilken kilde som beskriver økta. En rad som dukker opp igjen
med ny id treffer fortsatt.

### Fase 2: Toleransevinduet

`SUPPRESSION_TOLERANCE_MINUTES = 30`, i `$lib/domain/health/workout-suppression.ts`
med tester. Avveiningen står i koden, men kort:

- For smalt fanger ikke en retroaktiv revisjon fra Withings, eller en annen
  kilde som startet sporingen noen minutter unna. Da er økta tilbake — som er
  det svartelista finnes for å hindre.
- For bredt skjuler en ekte økt. Klyngevinduet i aktivitetslaget er to timer,
  og det var fristende å speile. Men klyngevinduet **slår sammen** økter (en
  økt vises fortsatt, bare som del av en annen), mens svartelista **fjerner**
  dem. Samme tall, mye høyere pris for å ta feil.

### Fase 3: Filtrering ett sted

Vakten står i `buildUnifiedWorkoutActivities` — den ene funksjonen alt går
gjennom. `canonical_workouts` bygges av den, og CTL/ATL/TSB, effort, løpemål,
autohaking og streaks leser derfra. Én sjekk dekker hele kjeden.

### Fase 4: Familien må være den samme funksjonen

Her lå den skjulte fella. `activity-layer.ts` hadde sin **egen** lokale
`sportFamily`, og den er ikke enig med `workoutSportFamily` i
`$lib/domain/health/workout-sport.ts`: `hill` blir `running` i den ene og `hill`
i den andre, `løp` blir `løp` i den ene og `running` i den andre.

Skriver man en svartelisting med den ene og filtrerer med den andre, treffer
den aldri — og feilen gir ingen feilmelding. Økta bare kommer tilbake, som er
umulig å skille fra «svartelista virker ikke». Funksjonen er derfor eksportert
som `clusterSportFamily` og brukes av begge sider, med en kommentar om hvorfor
den ikke er den andre.

### Fase 5: En vei tilbake

`GET/DELETE /api/helse/trening/skjulte`. Uten dette er svartelista en enveisdør:
en skjult økt forsvinner fra alle lister og kan ikke klikkes på for å angres, så
et feiltrykk ville vært usynlig og permanent. En bruker som ikke tør trykke
«Skjul» har ikke funksjonen.

## Beslutninger

- **Begge sperrene beholdes, de erstatter ikke hverandre.**
  `metadata.dismissed` er rad-nivå og respekteres av lesere som går utenom
  aktivitetslaget (`tracks/repository.ts` filtrerer på det direkte).
  Svartelistingen er økt-nivå og overlever synken. `setWorkoutDismissed` skriver
  begge i samme kall; ett trykk, to sperrer.
- **Svartelisting bare for `scope=activity`.** `?scope=source` avviser én
  kilde-registrering og skal nettopp ikke skjule økta — svartelister vi der,
  forsvinner en økt brukeren bare ville bytte kilde på.
- **Vi sletter fortsatt ingenting.** Rader beholdes; de blir usynlige og teller
  ikke. Det gjør angring mulig og holder importer idempotente.
- **Ingen automatisk sletting av rader kilden ikke lenger returnerer.** Det var
  det andre mulige svaret på «jeg slettet den i Withings». Avvist: en synk med
  et smalere vindu, en API-feil eller en midlertidig tom respons ville da slettet
  ekte historikk, og en additiv synk er nettopp det som gjør backfill trygt. En
  svarteliste er den ikke-destruktive veien til samme utfall.
- **Fortsatt ingen fartsbasert støyfiltrering.** Uendret fra de to foregående
  rundene, og av samme grunn.

## Verifisering

- `npm test`: 3437 tester i 251 filer, alle grønne. Ti nye i
  `workout-suppression.test.ts`, som dekker revidert starttidspunkt, kantene på
  toleransen, familieskillet og gjenoppstått rad med ny id.
- `npm run check`: 0 feil, 0 advarsler.
- **Migrasjonen kjørt mot ekte Postgres 16**, to ganger etter hverandre
  (idempotens), med kontroll av at unik-indeksen tåler gjentatte trykk på
  «Skjul», at løping og sykling på samme klokkeslett er to rader, og at
  `ON DELETE CASCADE` rydder svartelista når brukeren slettes.

## Gjenstår

Ingen flate viser svartelista ennå — bare endepunktene. `/settings/snoozes`
(«Skjulte forslag») er mønsteret å følge om den skal få en side.

## Etterspill: Ekko-reeksport (2026-08-19)

Brukeren eksporterte økta fra Ekko på nytt, og den kom tilbake — en fjerde vei
inn, og den første som gikk gjennom en helt annen sensor.

Svartelista fanget den slik den var ment å gjøre (verifisert: Ekko-eksporten
startet fire minutter unna Withings-raden og traff toleransevinduet). Men to
bivirkninger lå UTENFOR aktivitetslaget og ble derfor ikke filtrert:

- **`POST /api/apps/upload` pushet økta til Strava** uansett. Det er den ene
  bivirkningen brukeren ikke kan angre fra Resonans: en økt hen har sagt at ikke
  skjedde, lagt ut på en offentlig treningsprofil.
- **`POST /api/apps/strava/sync` var verre.** Backfillen plukker de siste N
  `workout`-radene rått, uten å gå gjennom aktivitetslaget, så den så verken
  svartelista ELLER `metadata.dismissed`. Den siste delen er en eldre feil enn
  svartelista — en skjult økt kunne publiseres av en knapp som het «synk», og
  det har vært tilfelle hele tiden.

Begge er nå gatet på `isWorkoutSuppressedForUser` (og `dismissed`). Toleransen
uttrykkes ikke i SQL: spørringen er et indeks-prefilter, og avgjørelsen tas av
den samme `isWorkoutSuppressed` aktivitetslaget bruker.

Opplastingssvaret bærer `hidden: true`, fordi en re-eksport ellers ser helt
vanlig ut for appen — brukeren får `ok: true` og lurer med rette på hvor økta ble
av.

**Raden skrives fortsatt.** Å avvise skrivingen ble vurdert og forkastet:
skrivestien skal være additiv og idempotent (det er den samme egenskapen som gjør
backfill trygt og `wasExisting` meningsfull), og en avvist opplasting ville sett
ut som en feil i Ekko. Riktig lag er å skrive og filtrere, og å stoppe det som
rekker utenfor.

### Verifisering av etterspillet

Kjørt ende-til-ende mot ekte Postgres 16 med full schema og dev-serveren: en
svartelistet Withings-økt seedet, deretter en Ekko-GPX for samme økt lastet opp
på `/api/apps/upload` med start fire minutter unna.

- Svaret ga `hidden: true`, `ok: true`, `inserted: true` ✓
- Raden ble skrevet (to rader i `sensor_events`, to ulike sensorer) ✓
- `GET /api/apps/workouts` returnerte 0 økter ✓
- `canonical_workouts` tom, ingen dagsrad → ingen CTL/TSB-påvirkning ✓
- `workout_notifications` tom → ingen push ✓
- Skjulte-økter-lista viste ÉN oppføring, ikke to — det er én økt ✓
- Etter «Gjenopprett»: én aktivitet med begge kildene klynget
  (`['withings','ekko']`, `evidenceCount: 2`), canonical og dagsrad tilbake ✓
