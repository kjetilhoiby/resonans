# Søvnlogger: dagsøvn og urolige netter

Dato: 2026-08-03
Status: ferdig

## Kontekst

Etter ernæringsloggeren ba bruker om «samme runden på søvn» — med mulighet for å
logge manuelt at man sov på dagtid, at man ikke fikk sove, eller at man våknet og
ikke fikk sove igjen.

Kartleggingen viste at det første tilfellet **allerede var bygget**, og mer enn
det: `logNap`/`deleteNap` i `server/integrations/sleep-goals.ts`, endepunktet
`/api/soevn/nap`, verktøyet `log_nap` i chatten og i assistentens delte verktøy,
og `isNapSleepEvent` som eksplisitt lar `data.isNap` fra manuell registrering
vinne over inferensen. `SleepDashboard` viste dem allerede med «Registrert
manuelt» / «Oppdaget automatisk».

Det som manglet var **en knapp**. Flaten hadde ingen inngang til en skrivesti som
var live i to andre kanaler.

De to andre tilfellene fantes ikke.

## Beslutninger

**Forstyrrelser er ikke `dataType: 'sleep'`.** Det er den viktigste avgjørelsen
her. Alt nedstrøms som leser `'sleep'` antar at hendelsen har en varighet:
`toSleepNights` dropper events uten brukbar varighet, `aggregateWeeklyData`
snitter `sleepDuration`, og `isNapSleepEvent` klassifiserer på lengde. En «fikk
ikke sove»-hendelse har ingen varighet, og å gi den `sleepDuration: 0` ville
dratt nattsnittet ned — altså ødelagt nøyaktig det tallet man ser etter når man
sover dårlig.

Så: `dataType: 'sleep_disturbance'`, med `disturbanceKind` og valgfrie
`awakeMinutes` og `note`. Metrikken ligger i `metrics.sleepDisturbances`, ved
siden av `metrics.sleep`, ikke inni den.

**Nattnøkkelen er datoen du våkner.** Konvensjonen finnes alt i
`buildSleepNightSeries` (`night.end ?? night.start`), og forstyrrelsene må ligge på
samme nøkkel for å kunne stilles ved siden av nattlengden. «Fikk ikke sove» kl.
23:30 den 3. og «våknet» kl. 03:00 den 4. hører derfor begge til natta
`2026-08-04`. Grensa er 18:00 norsk tid.

**Minutter er valgfritt.** Man registrerer «fikk ikke sove» klokka tre om natta
eller neste morgen med halvåpne øyne. `awakeMinutes: null` betyr «vet ikke», og
det skilles fra 0 — som betyr at man våknet og sov igjen med en gang. Å kreve et
tall ville gjort registreringen til en oppgave, og et gjettet tall forgifter
ukesstatistikken. Verktøybeskrivelsen sier det eksplisitt til modellen.

**Egen sensor, ikke migrering av den gamle.** Forstyrrelser får
`manual`/`sleep_log`; naps beholder den eldre `manual_nap`/`manual_log`. Provider-
strengen er kosmetisk, og skrivestien for naps er live i både chat-verktøyet og
assistenten — å endre den for konsistens ville vært risiko uten gevinst.

**Endepunktet ligger under `/api/soevn/`,** ved siden av nap-endepunktet, framfor
under `/api/helse/` som CLAUDE.md ellers foreskriver. De to hører sammen: begge er
manuell søvnregistrering, og å splitte dem over to prefikser ville bare gjort dem
vanskeligere å finne.

**Urolige netter overstyrer varigheten på søvnflisen.** Sju timer der to netter
var våkenliggende er ikke sju gode timer, så to eller flere urolige netter setter
tonen til varsel selv når snittet er bra. Én natt demper «positiv» til «nøytral».
Uten varighet fra Withings, men med loggede netter, viser flisen antallet i
stedet for å stå tom.

## Kjent unøyaktighet

`metrics.sleepDisturbances.nights` kan telle en natt i to uker. Aggregeringen
deler hendelser på *tidsstempel*, mens en natt går over midnatt: natta
søndag→mandag har innsovningen i én ISO-uke og oppvåkningen i den neste. Effekten
er ±1 natt ved ukesgrenser.

Ikke rettet, fordi en korrekt løsning krever at aggregeringen henter hendelser per
*natt*-vindu i stedet for per periode-vindu — en endring i kontrakten til hele
aggregeringen, for et selvrapportert mykt tall. **Flaten er upåvirket:** den
kaller `groupDisturbancesByNight` rett på hendelsene, så det brukeren ser per natt
er alltid riktig. Dokumentert i docstringen til `computeSleepDisturbanceMetrics`.

## Filer

- `src/lib/domain/sleep/disturbance.ts` *(ny)* — typer, `nightKeyForTime`,
  gruppering per natt, setningsbygging. 27 tester.
- `src/lib/domain/sleep/disturbance-metrics.ts` *(ny)* — `metrics.sleepDisturbances`.
  16 tester.
- `src/lib/server/sleep/disturbance-log.ts` *(ny)* — loggen.
- `src/lib/server/sleep/aggregate-refresh.ts` *(ny)* — brukes av både forstyrrelse-
  og nap-endepunktet.
- `src/routes/api/soevn/forstyrrelse/+server.ts` *(ny)* — POST/GET/DELETE.
- `src/lib/components/domain/sleep/SleepLogger.svelte` *(ny)* — tre handlinger.
- `src/lib/components/domain/sleep/SleepDisturbanceList.svelte` *(ny)*.
- `src/lib/ai/tools/log-sleep-disturbance.ts` *(ny)* — registrert i `/api/chat`.
- `src/routes/api/soevn/nap/+server.ts` — oppdaterer nå aggregatene, som
  forstyrrelsene. Uten det så flaten uendret ut til neste cron-kjøring.
- `subtheme-tiles.ts`, `health-overview.ts`, `sleep-dashboard.ts`,
  `SleepDashboard.svelte`, `aggregation.ts`, `/design`.

## Verifisering

- `npm run check`: 0 feil, 0 advarsler.
- `npm test`: 2091 grønne (fra 2052), 39 nye.

**Mot en ekte database** (lokal PostgreSQL 16):

- «Fikk ikke sove» 2. aug. 23:30 norsk med 45 min våken → 201, sensoren
  `manual`/`sleep_log` opprettet, `dataType: 'sleep_disturbance'`.
- «Våknet» 3. aug. 03:00 norsk uten minutter → 201, `awakeMinutes` fraværende.
- Dagsøvn 25 min → 200, `isNap: true` på en `sleep`-event, altså utenfor
  nattsnittet.
- Avvisninger: ukjent kind 400, `awakeMinutes: 9000` 400, tidspunkt i framtiden 400.
- Søvn-payloaden grupperte begge forstyrrelsene på **samme natt**
  (`natt til 2026-08-03`, `innsovning=1 oppvaakning=1 min=45`) selv om de ligger i
  ulike ISO-uker — som er hele poenget med nattnøkkelen.
- `metrics.sleepDisturbances` skrevet på uke, måned og år.
- `/tema/søvn?tab=data` og `/design` i Chromium: ingen konsollfeil, ingen 4xx.

**Ikke verifisert:** chat-verktøyet mot en ekte modell — agentmiljøet har ingen
gyldig `OPENAI_API_KEY`. Verktøydefinisjonen og `execute` er testet gjennom samme
kodesti som endepunktet, men ikke om GPT-4o velger `log_sleep_disturbance` framfor
`log_nap` for «jeg sov dårlig i natt». Beskrivelsene skiller dem eksplisitt.

## Bevisst ikke bygget

Meninger om søvn. Sent måltid mot søvnkvalitet er den mest verdifulle
sammenhengen Resonans kan se — nå finnes begge sidene: måltidstidspunkt med slot
fra ernæringsloggen, og urolige netter herfra. Men et signal som fyrer på tre
netters data er støy. Grunnlaget bygges opp nå; signalet venter til det finnes
uker.
