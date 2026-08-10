# «Glemte trackeren» — kontrakt mot Ekko

Status: Resonans-siden er klar. Ekko-siden er ikke bygget.

## Problemet

Glemmer man å avslutte sporingen, teller den døde halen fullt ut. En el-sykkeltur på
9,07 km sto som 2 t 20 min og fikk effort 114 der svaret var ~20 — MET-stien er rent
lineær i varighet, og økta hadde ingen puls, så det fantes ingen annen dom. Samme tall
priser aktivitetsforbruket, så én glemt sporing forurenser ukas effort,
akutt/kronisk-dommen, dagsforbruket og fuel-nudgen samtidig.

## Hvorfor forslag og ikke automatikk

Resonans rettet dette automatisk i én dag. Den utgaven er revet ut igjen.

Målt mot prod ville den endret **96 økter** for en feil som skjer et par ganger i året, og
den tok feil på de fleste av dem:

| Økt | Opptak | Automatikken sa | Hva det egentlig var |
|---|---|---|---|
| Løping 24. mars | 56 min | 8 min | Sporingen brøt sammen underveis — bare 1,25 km av sporet har brukbar tid |
| Fjelltur 23. juli | 3 t 18 min | 1 t 39 min | Bratt terreng er sakte. 0,3 m/s opp en ur er ekte gange |
| Løping 11. apr | 1 t 3 min | 12 min | Samme som 24. mars |

Ingen av dem var en glemt sporing. Lærdommen: **en sjelden katastrofe skal ikke behandles
som en systematisk skjevhet.** En feil gjetning skal koste et forslag du avviser, ikke et
tall du må oppdage.

Derfor: Resonans rører ingenting. Den sier fra når det ser ut som sporingen ble glemt, og
brukeren bestemmer — i Ekko, der sporet finnes og der Apple Helse og Strava kan rettes i
samme håndbevegelse.

## Kontrakten

### Forslaget kommer i svaret på opplastingen

`POST /api/apps/upload` returnerer et felt til:

```jsonc
{
  "ok": true,
  "type": "workout",
  "eventId": "…",
  "distance": 9070,
  "duration": 8400,

  // null i det store flertallet av tilfellene.
  "forgottenTracking": {
    "cutAtIso": "2026-08-10T10:27:03.000Z",  // siste punkt med vedvarende bevegelse
    "keptSeconds": 1623,                      // varigheten økta ville fått
    "droppedSeconds": 6777,                   // hva som kuttes bort
    "droppedShare": 0.807,
    "family": "ebike"
  }
}
```

`forgottenTracking` er **et forslag om noe som ikke er gjort**. Økta er lagret som den ble
spilt inn — hele halen, uendret varighet, uendret effort.

### Slik ser det ut i Ekko

Etter lagring, når feltet er satt:

> **Glemte du å stoppe sporingen?**
> Turen ser ut til å ha stoppet 12:27. De siste **1 t 53 min** er stillstand.
> [Kutt til 27 min] [Behold]

«Behold» skal være et likeverdig valg, ikke en avvisning man må lete etter. Vi kan ta feil.

### Slik anvendes den

Ekko gjør korreksjonen **lokalt** og laster opp på nytt:

1. Kutt `session.points` til og med `cutAtIso`.
2. Sett `endedAt` til samme tidspunkt. (`SessionFinalizer` gjør allerede noe liknende for
   parkerte økter — den setter sluttid til siste registrerte punkt.)
3. Skriv om HealthKit-samplet. Uten dette spriker Apple Helse fra Resonans, og
   `GET /api/apps/healthkit/coverage` svarer ut fra en varighet som ikke finnes lenger.
4. Rett Strava-aktiviteten, eller send `skipStrava=true` og la den stå.
5. Last opp på nytt med **samme `sessionId`**.

**Ingen nytt endepunkt trengs.** Opplastingen bruker
`conflictMode: 'upsert_sensor_datatype_timestamp'`, og et hale-kutt lar `startTime` stå —
så eventet **oppdateres** i stedet for å dupliseres. Skrivingen enqueuer
projeksjonsrefresh, effort regnes om, og alt nedstrøms følger med.

Det er hele poenget med å gjøre korreksjonen ved å kutte sporet framfor å lagre en
overstyring: `data.duration` blir *sann*, og da trenger ingen leser å vite at en
korreksjon har skjedd.

### Fella: bare hale-kutt er trygt

Kutter du **starten**, endres `parsed.startTime`, og upserten treffer en annen nøkkel. Da
får du en ny rad ved siden av den gamle, og turen telles to ganger. Trenger vi det, må det
løses eksplisitt — `metadata.dedupeKey` (`ekko::<sessionId>`) skrives allerede, men brukes
ikke til konfliktløsning i dag.

### Varsling dobles ikke

`workout_notifications` har én rad per kilde i klynga, og bokføringen skjer før utsending.
En re-opplasting av samme økt gir derfor ikke et nytt varsel.

## Hva som avgjør forslaget

`suggestForgottenTracking` i `$lib/domain/health/moving-time.ts`. Kortversjonen av
grensene, og hvorfor de er der:

- **Farten måles som forflytning mellom vinduets endepunkter**, ikke som sporlengde mellom
  nabopunkter. Sporlengde summerer GPS-støyen.
- **To porter, begge må åpne.** Den fine (10 s, terskel per sportsfamilie) spør «var jeg i
  bevegelse nå». Den grove (120 s) spør «kom jeg noen vei». Et rødlys består den grove og
  felles av den fine; innendørs GPS-drift er motsatt.
- **Kuttpunktet krever vedvarende bevegelse** — over halve det siste minuttet. Uten det
  landet kuttet nede i garasjen: multipath ga en enkelt spike på 4 m/s, og gåturen inn på
  kontoret rett etterpå bestod den grove porten.
- **Sykkelterskelen er 2,5 m/s, ikke Stravas ~1,4.** Gange ligger på 1,2–1,7 og kommer
  faktisk noen vei; ekte sykling ligger på 4–8. Porten står midt i gapet, så gåturen fra
  garasjen kuttes med.
- **Minst 10 minutter og 15 % av økta.** Et forslag som dukker opp på hver tur blir
  bakgrunnsstøy, og bakgrunnsstøy blir slått av.
- **Løping har ikke sykkelens gap.** Rask gange (1,7 m/s) og sliten jogg (1,8) er ikke til
  å skille på fart alene, så terskelen står på 0,7 og en gåtur hjem kuttes ikke. Kjent rest.
