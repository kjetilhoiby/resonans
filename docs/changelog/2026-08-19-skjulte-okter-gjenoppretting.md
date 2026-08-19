# Skjulte økter: en liste for gjenoppretting

Dato: 2026-08-19
Status: ferdig

## Kontekst

Brukeren dismisset en økt ved et uhell, og oppdaget mangelen som sto igjen fra
`2026-08-16-svarteliste-for-okter.md`: svartelista hadde endepunkter, men ingen
flate. En skjult økt forsvinner fra alle lister — så det finnes ingenting å
klikke på for å angre. Et feiltrykk var i praksis permanent.

Én ting var avgjørende for at lista skulle virke i det hele tatt: **skjuling
setter i dag to ulike sperrer**, og de har ikke vært der like lenge.

- `metadata.dismissed` på raden — finnes i prod nå.
- En rad i `workout_suppressions` — deployes først med denne PR-en.

Alt som er skjult i prod fram til deploy har derfor **bare** flagget. En liste
som bare leste svartelista ville vist tom skjerm for nettopp den økta brukeren
hadde mistet — og det var det konkrete tilfellet.

## Faser

### Fase 1: En leser som dekker begge sperrene

`$lib/server/workouts/hidden-workouts.ts`. Leser `sensor_events` med
`dismissed`/`sourceRejected` satt, OG `workout_suppressions`, og fletter dem.

En økt som holdes av begge vises som **én** rad med `holds: ['flag',
'suppression']`. To rader for samme økt ville sett ut som to skjulte økter, og
brukeren ville trykket «Gjenopprett» to ganger uten å forstå hvorfor.

Flere kilder for samme økt slås sammen på tid + familie — samme nivå som
klyngingen — ellers ville en tur fra klokka og fra Ekko vist som to.

En svartelisting uten matchende rad står alene i lista. Det er en ekte tilstand:
kilden kan ha sluttet å sende økta.

### Fase 2: Gjenoppretting fjerner begge

`restoreHiddenWorkout` går gjennom `setWorkoutDismissed`, som rydder flagget,
svartelistingen, projeksjonen og dagsraden i én operasjon. Er handtaket en ren
svartelisting (ingen rad igjen), slettes bare den — og projeksjonen bygges
likevel, slik at en rad som senere dukker opp fra kilden havner i formkurven med
det samme.

### Fase 3: `/settings/skjulte-okter`

Følger `/settings/snoozes` som mønster, men **ikke** dens CSS: den siden
hardkoder lyse farger (`#555`, `#eee`, `white`), i strid med at appen alltid er
mørk. Den nye siden bruker tokens fra `AppPage`. Lenket fra innstillinger.

Kilde-avviste registreringer står i egen seksjon med egen forklaring: der er
selve økta fortsatt synlig, bare uten tallene fra den ene kilden. Å blande dem
med skjulte økter ville gjort begge uforståelige.

## Beslutninger

- **Badge-ene forklares i klartekst.** «Svartelistet» og «Skjult» ser ut som
  synonymer, men betyr ulike ting for om økta kan komme tilbake. Uforklart er
  forskjellen støy; forklart er den svaret på «hvorfor kom den tilbake sist».
- **Ingen sletting fra denne flaten.** Den viser og gjenoppretter. En
  slette-knapp her ville vært den destruktive operasjonen hele denne serien har
  avvist tre ganger.
- **`hidden-workouts.ts` i `knownRawReaders`** med begrunnelse: spørsmålet «hva
  har jeg skjult?» kan ikke besvares av det dedupliserte laget, siden det
  filtrerer nettopp bort disse radene. Vakten fanget fila, som den skal.
- **`normalizeDistanceMeters` eksportert** framfor en tredje kopi. Lista må vise
  samme tall som feeden.

## Verifisering

- `npm test`: 3437 tester i 251 filer, grønne. `npm run check`: 0 feil.
- **Kjørt ende-til-ende mot en ekte Postgres 16 med full schema** (drizzle push,
  pgvector installert) og dev-serveren, med fire seedede tilstander: en økt
  skjult av bare flagget (dagens prod-tilstand), en holdt av flagg + svarteliste,
  en kilde-avvist, og en synlig kontroll-økt.
  - Lista viste de tre skjulte og **ikke** kontroll-økta ✓
  - Flagg-bare-økta ble merket «Skjult», flagg+svarteliste «Svartelistet» ✓
  - Gjenoppretting av flagg-bare-økta fjernet flagget og lot de andre stå ✓
  - Gjenoppretting av den svartelistede fjernet **begge** sperrene ✓
  - Gjenoppretting av kilde-avvisningen fjernet `sourceRejected` ✓
  - Tom tilstand viser «Ingen skjulte økter» ✓
- Skjermdump tatt av den ekte siden (430×900, dark) og kontrollert mot
  designsystemet.
