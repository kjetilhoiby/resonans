# Synkfeil som sier fra

Dato: 2026-09-03
Status: ferdig

## Kontekst

SpareBank1 sluttet å synke 30. august. Det ble oppdaget 2. september, ved at en
`/api/health`-sjekk gjort av en helt annen grunn viste `status: failing` — og da
hadde tre døgn med banktransaksjoner manglet uten at noe hadde sagt fra.

Ferskhetssjekken var det ENESTE signalet som var rødt. De tre andre løy, hver på
sin måte:

- **`sensors.lastError` sa `null`.** Feltet skrives av SpareBank1, Withings og
  Spond bare med verdien `null`, og bare ved suksess. Det er altså
  skrive-ved-suksess: verdien fra sist synken gikk bra blir stående gjennom en
  hvilken som helst senere feil. Varselteksten i `monitoring-service.ts`
  skriver `lastError: null` ordrett, og det leses som «ingen feil».
- **`cron_executions` sa `success`.** `withCronTracking` klassifiserte bare på
  en `error`-nøkkel på TOPPNIVÅ. «For hver bruker»-synkene fanger feilen per
  bruker, legger den i `results[]` og teller den i `failed` — så en kjøring der
  alle brukerne feilet ble bokført som vellykket.
- **`failingJobs` var tom**, siden den leser `cron_executions`.

Den ekte feilmeldingen fantes ett sted: `console.error` i cron-endepunktets
catch. Altså i ringbufferen (`log-buffer.ts`), som er per prosess og tømmes ved
restart — og det hadde vært to redeploys i mellomtiden. **Beviset var borte før
noen lette etter det.** Årsaken til at synken stoppet 30. august er derfor
fortsatt ukjent, og kan ikke gjenfinnes.

## Faser

### Fase 1: Klassifiseringen ut av wrapperen, og gjort ærlig

Ny ren modul `$lib/server/monitoring/cron-result.ts` med `classifyCronResult`,
9 tester. `withCronTracking` kaller den.

Tre former godtas nå, og alle tre er etablerte i repoet fra før:

| Form | Hvem returnerer den |
|---|---|
| `{ error: … }` | jobber som rapporterer delvis feil på toppnivå |
| `{ failed: n }` | de åtte «for hver bruker»-synkene |
| `{ success: false }` | `rescuetime-sync`, `economics-dedup` |

De to siste er verdt å merke seg: `rescuetime-sync` og `economics-dedup` setter
alt `success: failed === 0`. De har altså sagt fra hele tiden, til en wrapper
som ikke hørte etter.

### Fase 2: `lastError` skrives ved fall, og ryddes ved suksess

Ny `$lib/server/sensors/sync-status.ts` med `recordSensorSyncFailure`. Koblet
inn på de tre inngangene — `syncAllSparebank1Data`, `syncAllWithingsData`,
`syncSpondData` — som tynne wrappere rundt en intern `run*Sync`, framfor å
pakke fem hundre linjer inn i en try-blokk.

Withings og Spond skrev ikke `lastError: null` ved suksess i det hele tatt. Den
halvdelen måtte med i samme slengen: begynner man å skrive en feil uten å rydde
den, blir feilen fra i forrige uke stående lenge etter at den er rettet — og et
varsel som ikke kan skru seg av, blir slått av.

## Beslutninger

**Regelen er et bevisst SUPERSETT av den gamle.** Alt som før ble `partial`,
blir det fortsatt — også `{ error: null }`, der den gamle regelen så på
nøkkelens tilstedeværelse og ikke verdien. Å stramme inn samtidig ville betydd
at noe sluttet å varsle, og en monitorering skal kunne skjerpes uten at man i
samme endring må bevise at ingenting faller ut. En falsk `partial` koster et
blikk; en falsk `success` kostet tre døgn.

**`recordSensorSyncFailure` kaster aldri.** Den kalles fra en catch-blokk, og
kastet den selv, ville den erstattet den ekte feilen med sin egen. En
feilsøking som starter med feil melding er verre enn en som starter med ingen.

**Feilmeldingen kappes på 500 tegn.** Feltet leses i et Google Chat-varsel og i
`/api/health?debug=true`. En HTML-feilside limt inn der er ikke et signal.

**Oppslaget filtrerer på `isActive`,** samme filter som `checkSensorFreshness`.
Feilen skal lande på nøyaktig den raden varselet leser — ikke på en gammel,
deaktivert sensor ved siden av.

**RescueTime, Dropbox, Tesla og Google Sheets er ikke rørt.** De gjorde dette
riktig hele tiden. Dette er de tre som manglet.

## Verifisering

- `npm run check` — 0 errors, 0 warnings.
- `npm test` — 4205 tester i 294 filer, alle grønne (9 nye).
- `npm run build` — grønt.
- Testene dekker eksplisitt formen som feilet i prod: `{ success: true,
  succeeded: 0, failed: 1, results: [{ success: false, error: … }] }` →
  `partial`.

## Kjent rest

- **Ingenting hindrer at det skjer igjen i en ny integrasjon.** En ny synk kan
  glemme `recordSensorSyncFailure` like stille som disse tre gjorde. Vakten mot
  rå sensorlesing (`sensor-event-access.ts`) er mønsteret som ville dekket det.
- Feilen som stoppet SpareBank1 30. august er ikke funnet, og kan ikke finnes —
  se Kontekst.
