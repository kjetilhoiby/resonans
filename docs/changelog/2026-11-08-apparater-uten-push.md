# Apparatene uten push

Dato: 2026-11-08
Status: ferdig

## Kontekst

Ping melder vaskemaskin, oppvaskmaskin og tørketrommel inn til Resonans
(`/api/apps/event`, `app: 'ping'`). Fram til nå sendte Resonans push (og Google
Chat som reserve) på tre tidspunkter:

- når et apparat **startet** («Vaskemaskin startet — ferdig ca. 14:30»)
- når **programmet ble kjent igjen** av profilmatchingen («Vaskemaskin: Bomull 60»)
- når det var **ferdig** («Vaskemaskin er ferdig! 1t 52min, 0,9 kWh»)

Heime har nå tatt over ansvaret for maskinene, og varslene kom dobbelt.
Brukeren ville ha pushen ut av Resonans, men beholde loggen.

## Faser

### Fase 1: pushen ut, loggen inne

- `ping-notifications.ts` sender ikke lenger noe. Det som er igjen,
  `afterPingEvent`, legger husarbeidet på hjem når en syklus er ferdig
  (`addChoresForCycle`), som før.
- `/api/apps/event` skriver fortsatt hver hendelse til `sensor_events`.
  Programgjenkjenningen kjører og lagres fortsatt som `appliance_match`, men
  varsler ikke.
- `applianceCycles` er fjernet fra typen på `users.notificationSettings`. Gamle
  rader kan bære nøkkelen, men ingenting leser den.

## Beslutninger

- **Fjernet, ikke skrudd av.** Det fantes en `applianceCycles.enabled`-bryter i
  `notificationSettings`, men ingen flate satte den. Og den sto foran
  husarbeidet: en avskrudd bryter ville også stoppet husarbeidsregistreringen.
  To apper som varsler om samme maskin er det som ble ryddet bort, så en
  bryter for å slå det på igjen hører hjemme i Heime.
- **Husarbeidet er ikke lenger gatet på varslingsinnstillingen.** Det er en
  registrering, ikke et varsel.
- **Google Chat-reserven gikk ut sammen med pushen.** Den sendte bare når
  pushen ikke nådde fram, altså samme varsel i en annen kanal.

## Verifisering

- `npm test`: 5 572 grønne. `npm run check`: 0 feil.
- Ingen test dekket pushen; det finnes ingen ny ren logikk å teste.
