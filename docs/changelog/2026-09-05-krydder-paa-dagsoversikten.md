# Krydder på dagsoversikten

Dato: 2026-09-05
Status: ferdig

## Kontekst

Lørdag 5. september 2026 kl. 10:00 kom denne pushen for første gang:

> **Daglig oversikt**
> Planlagt: 0 · Åpne: 0 · Overliggere: 1

Tre tellinger, to av dem null, og ikke ett ord om hva det ene punktet var. For å
finne ut om varselet var verdt å få, måtte brukeren åpne appen — altså gjorde
varselet ingen jobb.

To spørsmål, og begge hadde et konkret svar.

### Hvorfor NÅ? Klokka ble punktlig

Varselet er ikke nytt. `runDayPlanningAndCloseNudges` har hatt digest-grenen
lenge, og lørdag er `weekendMode: 'digest'` med `digestTimeWeekend: '10:00'`.
Grenen sto stille fordi gaten var en **eksakt** streng-sammenligning:

```ts
if (mode === 'digest' && local.hm === digestTime) {
```

`/api/cron/day-planning-nudges` går `0 * * * *`. Med GitHub Actions som klokke
kom tikket når det kom. Målt på forrige lørdag, 29. august, over
`/api/diagnostikk`:

```
2026-08-29T08:07:48Z  /api/cron/day-planning-nudges  success
```

08:07 UTC er 10:07 Oslo. `'10:07' === '10:00'` er usant, og digesten falt
gjennom — hver lørdag, i månedsvis. GitHub Actions' femminutters-plan traff den
lørdagen på :07, :25, :33, :41, :48 og :54; minutt 00 var ikke blant dem.

Den interne dispatcheren (`ENABLE_CRON_DISPATCHER`, 1.–2. september) tikker hvert
minutt og self-fetcher over loopback. Samme jobb i dag:

```
2026-09-05T08:00:02Z  /api/cron/day-planning-nudges  success
```

`'10:00' === '10:00'`. Varselet hadde ligget der hele tiden og ventet på en
klokke som traff.

### Og to av fire grener kunne aldri fyre

Da gaten ble undersøkt, viste det seg at problemet var større enn digesten.
Standardtidene i fila var 07:00 (plan-dag) og 21:00 (avslutt-dag). Standard
stillevindu var `20:00`–`08:00`. Begge tidene lå INNI sitt eget stillevindu, så
`resolveNudgeMode` returnerte `digest` hver gang, og de to interaktive grenene
var strukturelt uoppnåelige med standardinnstillinger.

Med defaults kunne altså denne fila produsere nøyaktig ett varsel: helgedigesten.
Alt annet var dødt, uten at noe feilet.

## Faser

### Fase 1: Tidsregningen ut i en ren modul

Ny `$lib/domain/nudge-schedule.ts`: `isTimeInWindow`, `isWeekend`,
`resolveNudgeMode`, `digestTimeFor`, standardtidene og
`NUDGE_WINDOW_MINUTES`.

Begge feilene var regnefeil i denne logikken, og ingen test kunne nå dem så
lenge den lå inni en løkke over `db.query.users`. Nå står de som
`nudge-schedule.test.ts` — inkludert invarianten **«ingen standardtid ligger i
standard stillevindu»**, som feiler på de gamle verdiene.

### Fase 2: Vindu i stedet for minutt, og dedup som følger med

`local.hm === X` → `isWithinRecentMinutesWindow(local.hm, X, 60)` på alle fire
grenene. En time, fordi jobben er timebasert: da treffer nøyaktig ett tikk et
hvilket som helst konfigurert klokkeslett, uansett om dispatcheren ligger et
minutt eller ti bak — og et brukervalgt 07:30 fanges av 08:00-tikket, som den
eksakte gaten aldri kunne.

Et bredere vindu må dedupliseres. `alreadyNudgedToday` slår opp
`nudge_events` på type + `context->>'dayIso'` — samme mønster som
`grocery_weekly`, ingen ny tabell. Den dekker samtidig høstens dobbelte time ved
sommertidsskiftet, der samme lokale klokkeslett kommer to ganger.

### Fase 3: Stillevinduet flyttet til natta

`20:00`–`08:00` → **`22:00`–`07:00`**. Det er definisjonen av «ikke forstyrr»
som lar begge standardtidene stå: en avslutt-dagen-nudge kl. 21 ER en
kveldsnudge, og et stillevindu som slår den av har misforstått hva den er til
for.

Konsekvens, sagt rett ut: plan-dag (07:00) og avslutt-dag (21:00) begynner nå å
komme på hverdager. De er nye i praksis, ikke i kode.

### Fase 4: Krydder i stedet for tellinger

Ny `$lib/domain/digest-nugget-rules.ts` — ren, testet, og bygget på samme grep
som `weight-nugget-rules.ts` fra 4. september: **regn ingenting nytt, les
motorene som alt lager setninger, og ranger dem for en push framfor for et
kort.**

| Regel | Kilde | Hvorfor den er en nyhet |
|---|---|---|
| `streak-due` | `loadStreaks` → `streakLabel`/`dueLabel` | en frist i dag eller i morgen |
| `load-high` | `describeAcuteChronic` | eneste restitusjonssignal vi har |
| `carryover` | checklisten | navnet på punktet, ikke tellingen |
| `week-change` | vekttrenden | uka som nettopp gikk |
| `week-load` | `describeBudgetStanding` | ukas effort mot båndet |

Serveren (`$lib/server/digest-nugget.ts`) henter gjennom de samme lasterne
flatene bruker, så varselet ikke kan si noe annet enn siden det lenker til.

Google Chat-kortet leder nå med den samme setningen (`highlight`). Tellingene
står igjen under, som fotnoter.

## Beslutninger

- **Stillhet er et gyldig svar.** `buildDigestPush` returnerer `null` når ingen
  regel har noe å si, og den gamle gaten (`plannedItems === 0 || …`) er borte.
  «Dagen er ikke planlagt» er sant hver eneste morgen, og et varsel med en grunn
  som alltid finnes blir bakgrunnsstøy — som blir slått av.
- **Sykdom slår varselet helt av.** Innsjekken (`sick-checkin`) eier den
  morgenen. «Under ukas plan — det er rom igjen» levert til noen med feber er
  ikke en oversikt, det er en oppfordring. Vi leser `getSickState().active`, som
  også dekker det gamle nå-flagget: for et varsel er «er jeg syk nå» det eneste
  spørsmålet som betyr noe.
- **`PUSH_RANK` løser metning, ikke gjentakelse.** Det som fyrer ÉN gang ligger
  øverst (`streak-due`, `load-high`, `carryover`); det som er sant hver morgen
  (`week-change`, `week-load`) hører i andrelinja. Samme lærdom som på vekta,
  der «laveste snittvekt vi har målt» sto identisk hver dag i månedsvis.
- **`streak-due` og `load-high` er med vilje IKKE et ekko-par**, selv om de kan
  se ut til å motsi hverandre («løp i dag» ved siden av «ta en rolig dag»). De er
  to sanne fakta om samme morgen, og kombinasjonen er nøyaktig det brukeren
  trenger for å ta valget selv. Å skjule den ene ville vært å ta valget for hen.
- **Bare `due_soon`, aldri `overdue`.** En brutt rekke er lett å regne, men
  «3 dager på overtid» i en morgenpush er en anklage om noe som alt er avgjort.
  Samme beslutning som at terskelpasseringer på vekta bare feires nedover.
- **Bare nivået `høy` på belastning.** `rolig` og `normal` er sanne hver
  dag og sier ingenting å handle på. De hører på kortet, der de er det motsatte
  hjørnet av samme akse.
- **`week-change` måler trend mot trend, aldri to rå målinger.** Trenden er et
  etterslepende snitt, så etterslepet kansellerer når begge ankrene er
  trendpunkter. To rå målinger sju dager fra hverandre måler forskjellen mellom
  to morgeners væskebalanse, og den er på størrelse med en måneds framgang.
  Samme regel som månedsoppgjøret.
- **Ordene er motorenes egne.** `streakLabel`, `dueLabel`,
  `describeBudgetStanding` og `describeAcuteChronic` brukes ordrett. Rekka heter
  det samme i varselet som på kortet varselet lenker til; to formuleringer av
  «6 dager på rad» driver fra hverandre uten at noen ser det.
- **`describeOpenItems` er delt av alle tre grenene.** Plan-dag, avslutt-dag og
  dagsoversikten sier alle det samme om ulike dager, så halen («fra i går»,
  «i dag») er en parameter framfor tre kopier av setningen. Plan-dag og
  avslutt-dag navngir nå punktene sine av samme grunn som digesten — det ville
  vært rart å vekke to grener med nøyaktig den svakheten som utløste jobben.
- **`weekly-intensity` ble vurdert og valgt bort.** `describeWeeklyIntensity` er
  en dom over tolv uker: den flytter seg månedlig, så den ville stått identisk i
  varselet dag etter dag — metning, som er problemet rangeringen finnes for. Og
  `loadVolumeAndQuality` er tung nok til at den ikke hører i en cron som kan
  ende med å sende ingenting.
- **Konteksten bokfører hvilken regel som vant** (`nugget`, `secondary` i
  `nudge_events.context`). Uten den kan man ikke se i ettertid hvorfor en morgen
  ble stille og en annen ikke.

## Verifisering

- `npm test` — 4593 tester i 316 filer, alle grønne. 39 av dem er nye:
  25 i `digest-nugget-rules.test.ts`, 14 i `nudge-schedule.test.ts`.
- `npm run check` — 0 feil, 0 advarsler.
- Regresjonstesten er kontrollert mot feilen: settes standardstillevinduet
  tilbake til `20:00`–`08:00`, feiler «ingen standardtid ligger i standard
  stillevindu» og «plan-dag og avslutt-dag er interaktive på en hverdag».
- Diagnosen av «hvorfor nå» er lest ut av prod, ikke resonnert fram:
  `/api/diagnostikk?until=2026-08-29T09:00:00Z&minutes=180` viser tikket 08:07:48
  forrige lørdag, mot 08:00:02 i dag.

## Kjent rest

- **Ingen bokføring på tvers av kanaler.** Krydderet på veiingen kan si en rekord
  kl. 07 og dagsoversikten et ukesoppgjør kl. 10, samme morgen. Det er samme hull
  som er notert for vekt-pushen fra før (økter har `workout_notifications`, vekt
  har ingen tabell).
- **Ingen dom mot brukerens egne beste uker.** `week-load` sammenligner mot ukas
  bånd, ikke mot historikken.
- Digesten er fortsatt gatet på `forceDigest`/helg. En hverdagsmorgen med en
  streak som forfaller får ingen oversikt med mindre triagen har slått inn.
