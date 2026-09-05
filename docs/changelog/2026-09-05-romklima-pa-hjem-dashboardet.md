# Romklima på Hjem-dashboardet

Dato: 2026-09-05
Status: ferdig

## Kontekst

Ping (resonans-lab) fikk tre alternative veier til å lese romtemperatur uten
å ta ned panelovner blindt: `climate.py` (Aqara over zigbee2mqtt),
`homekit.py` (Aqara M2 sin HomeKit-bro) og `mill.py` (Mill Gen 3-panelovners
lokale REST-API). Alle tre skriver samme `climate_reading`-event, som
`notifier.py` mapper til `dataType: 'room_climate'` i `sensor_events` — men
ingen flate i Resonans leste den. Data lå trygt i basen, usynlig i UI-et.

Mill-veien ble verifisert mot en ekte ovn 5. september 2026 og satt i drift
samme dag (se `resonans-lab/ping/README.md`).

## Faser

### Fase 1: Ren gruppering (`$lib/domain/home/room-climate.ts`)

`buildRoomClimateSummaries()` grupperer `room_climate`-events per
`data.room`, sortert kronologisk uavhengig av inputrekkefølge. Returnerer per
rom: siste avlesning (temperatur, fuktighet, måltemperatur, varmestatus —
alle utenom temperatur er `null` når kilden ikke sender dem) og en serie på
inntil 60 punkter for en sparkline. 8 tester i
`src/lib/domain/home/room-climate.test.ts`.

### Fase 2: Egen spørring i `dashboard/home/+server.ts`

**Bevisst IKKE lagt inn i den eksisterende 300-rad-cappede events-spørringen**
som apparat-seksjonen bruker. Mill poller hvert minutt; selv med debounce
(se under) ville en delt, cappet spørring gjort at nok romklima-rader kunne
presse apparat-events ut av vinduet på en aktiv dag. Romklima-events er nå
eksplisitt utelatt fra 300-cap-spørringen (`ne(dataType, 'room_climate')`,
med `isNull`-unntak) og hentes i en egen spørring med eget tak (1500 rader).

### Fase 3: «🌡️ Romklima»-seksjon i `HomeDashboard.svelte`

Ett kort per rom, samme visuelle språk som «🔌 Apparater»
(`--bg-card`/`--border-color`/`--accent-primary`): temperatur, fuktighet og
måltemperatur når de finnes, en 🔥 når ovnen varmer nå, og en kompakt
SVG-sparkline med et gulv på 1 °C spenn (samme prinsipp som
`MIN_WEIGHT_AXIS_SPAN_KG` på vektflaten — en stabil uke skal ikke tegnes som
et stup).

### Fase 4 (i `resonans-lab`, ikke dette repoet): Debounce i `mill.py`

Oppdaget mens denne fasen ble bygget: uten en endrings-sjekk sendte
`run_mill` ett event PER poll (hvert 60. sekund), uansett om temperaturen
endret seg. Én ovn i drift ville skrevet ~1440 rader/døgn. Rettet i
`resonans-lab` (PR #229) med `reading_changed()` — sender bare når
temperatur/måltemperatur/varmestatus faktisk er ulik siste SENDTE avlesning.

## Beslutninger

- **Ingen ny undertema-infrastruktur.** Hjem-dashboardet er én flate der nye
  seksjoner legges rett inn (som «Apparater»); `buildSubthemeTiles`-mønsteret
  er kun for Helse.
- **Romnavnet er fritekst, ikke `HomeRoom`-enumet.** `HOME_ROOMS` sine nøkler
  er engelske identifikatorer (`living_room`) med norske labels («Stue») —
  Ping sine romnavn er det brukeren selv skrev i `config.yaml`
  (`mill.heaters[].room`/`climate.sensors`-verdier), og kan hete hva som
  helst («Erle»). Å tvinge dem inn i enumet ville feilet stille for enhver
  tekst som ikke matcher en label ordrett.
- **Ingen egen `/rom/[navn]`-side ennå** for lengre historikk — kortet på
  dashboardet var det som svarte på det umiddelbare spørsmålet (leser Ping
  data i det hele tatt). Nevnt som mulig videre arbeid, ikke bygget.
- **`current_power` fra Mill vises ikke** — feltets enhet (watt? andel av
  duty cycle?) er ikke bekreftet, og et feilmerket tall i UI er verre enn et
  som mangler.

## Verifisering

- `npm test`: 4013 tester, alle grønne (283 filer).
- `npm run check`: 0 feil, 0 advarsler.
- `src/lib/server/sensor-event-access.test.ts`: fortsatt grønn — ingen ny rå
  lesing utenfor det eksisterende, begrunnede unntaket for
  `dashboard/home/+server.ts`.
- Ikke verifisert visuelt mot ekte data i nettleser ennå (krever et deploy og
  faktiske romklima-rader i prod-basen — Mill-ovnen «Erle» begynte å skrive
  rader 5. september, så data finnes, men kortet er ikke sett i praksis).
