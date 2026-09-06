# Importen reprojiserer én gang, ikke én gang per rad

Dato: 2026-09-05
Status: ferdig

## Kontekst

Strava-arkivimporten gikk «veldig sakte». Den åpenbare mistenkte var utpakkingen
— gunzip og parsing per fil — men den ble målt og frikjent: **41 ms per batch på
tjue filer**, altså rundt to sekunder for hele arkivet. Tre størrelsesordener fra
å forklare noe.

Tallet som forklarte det lå i jobbkøen. Fire feilede
`workout_projection_refresh`-rader fra importforsøket sto med tidsstempler
**05:52:42, 05:53:00, 05:53:17 og 05:53:25** — omtrent atten sekunder mellom
hver. Det er ikke fire tilfeldige feil; det er én jobb kjørt om og om igjen, rygg
mot rygg, gjennom hele importen.

## Årsaken

`SensorEventService.write` gjør to ting når en `workout`-rad skrives:

1. legger en projeksjonsjobb i kø (`enqueueWorkoutProjectionRefresh`), og
2. kjører den **med en gang** (`runWorkoutProjectionInline`).

Steg 2 er riktig for én fersk økt: brukeren har nettopp avsluttet en tur og skal
se den i streaks og formkurve uten å vente på cron. Men vinduet er
`timestamp − 2t → nå`, så for en økt fra 2012 er reprojeksjonen **fjorten år med
canonical-rader**. Og importen kaller `write` per rad.

Debouncen i `enqueueWorkoutProjectionRefresh` skulle fanget dette — den slår
sammen vinduer inn i en eksisterende jobb. **Men den slår bare sammen jobber som
fortsatt står `queued`**, og inline-kjøringen tar jobben ut av `queued` i samme
øyeblikk den opprettes. Rad nummer to finner derfor ingenting å slå seg sammen
med og lager en ny jobb. Mekanismen som skulle gjort tusen skrivinger til én
reprojeksjon, gjorde dem til tusen — nettopp fordi den andre halvdelen av samme
funksjon var for rask.

Det forklarer også hvorfor *skrivingen* så treg ut: reprojeksjonene kjører i
bakgrunnen mot den samme tilkoblingspoolen (`DB_POOL_MAX`, 10), så hver insert
sto og ventet på en ledig tilkobling. Symptomet peker på parseren; årsaken lå i
et bakgrunnskall ingen ventet på.

## Faser

### Fase 1: `projectionMode` på skriveveien

`SensorEventWriteOptions` har nå `projectionMode?: 'inline' | 'queued'`, med
`inline` som standard — vanlige økter oppfører seg nøyaktig som før.

`queued` fjerner **bare** inline-kjøringen. Jobben legges fortsatt i kø, så
ingenting går tapt om importen brytes midtveis (og det gjør den: skjermen låser
seg, nettet ryker). Og da virker debouncen etter hensikten: alle radene som
skrives mens den forrige jobben kjører, slås sammen til én.

Endringen gjelder både `write` og `writeMany`, og modusen står i
`[sensor-event-service]`-logglinja, så det er lesbart hvilken vei en skriving
tok.

### Fase 2: importen ber om `queued`

`strava-import.ts` sender `{ conflictMode: 'ignore', projectionMode: 'queued' }`.
Ingen andre kallsteder er rørt.

## Beslutninger

- **Køen beholdes, bare kjøringen utsettes.** Alternativet — å hoppe over
  `enqueue` helt og gjøre én reprojeksjon til slutt — er sårbart nettopp der
  importen er sårbar: klienten kjører ~51 runder, og et avbrudd i rund 30 ville
  etterlatt tretti runder skrevne økter uten en eneste projeksjon i kø, og uten
  noe som sier fra. En rad i `background_jobs` er den eneste
  huskelappen som overlever en lukket fane.
- **Ingen «siste runde»-flagg fra klienten.** Det var det andre alternativet, og
  det finnes ikke en siste runde: resume gjør at importen kan avsluttes hvor som
  helst og gjenopptas senere. Debouncen trenger ingen å fortelle seg når den er
  ferdig.
- **Standarden er uendret.** En import er et unntak, ikke en ny norm. En
  `projectionMode` som defaultet til `queued` ville tatt bort den ferske økta fra
  formkurven for alle andre kallsteder — Ekko-opplastingen, Withings-synken,
  Dropbox-importen — for å løse et problem bare arkivimporten har.
- **Ingen ny enhetstest.** Endringen er en gren på et opsjonsfelt i en
  DB-koblet klasse; det finnes ingen ren funksjon å teste, og en test som
  mocker `db` for å telle kall på `runWorkoutProjectionInline` ville testet at
  koden er skrevet slik den er skrevet. Begrunnelsen ligger i kommentarene
  begge steder i stedet, med målingen i seg.

## Verifisering

- `npm test`: 4562 tester i 315 filer, alle grønne.
- `npm run check`: 0 feil, 0 advarsler.
- De fire feilede jobbene fra forsøket 5. september står fortsatt i
  `/api/diagnostikk` (fingerprint `db632c7f` ×3 og `5acf44d8`, 616 tegn hver) —
  de er ikke ryddet, og er referansepunktet neste kjøring måles mot: fire jobber
  på 43 sekunder skal bli vesentlig færre.

## Kjent rest

- **Feilteksten på de fire jobbene er ikke lest.** 616 tegn er langt kortere enn
  de gamle 2000-tegns `refreshForRange`-feilene (`a27126f1`/`7eb896ab`), altså
  antakelig en annen feil. `/api/diagnostikk` gir bare fingeravtrykk; teksten
  krever `GET /api/admin/logs?grep=[background-jobs]`.
- **Poolmetningen er ikke bevist, bare sannsynliggjort.** At radene lå atten
  sekunder fra hverandre — omtrent lengden på én full-historikk-reprojeksjon —
  er en sterk indikasjon, ikke en måling. Neste import er målingen: blir
  radene raske, var det dette.
