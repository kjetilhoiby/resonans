# SIGNALS.md

Status: Draft v1 (MVP parsing flyt aktiv)
Sist oppdatert: 2026-04-15

## 1. Målbilde

Resonans skal bruke et signal-lag som et semantisk mellomlag mellom rådata og handling:
- UI skal oppleves enkelt og naturlig.
- LLM skal få høyverdi-kontekst med lav token-kost.
- Domenehygiene skal holdes (Hjem != Parforhold, men signaler kan flyte mellom).

Kort sagt:
- Frontstage: enkel, "magisk" opplevelse.
- Backstage: kontrakter, signalproduksjon og evalueringslogikk.

## 2. Arkitekturprinsipp

### 2.1 To lag

1. Kjerne-domener (forhåndsdefinerte)
- health
- economics
- home
- relationship

2. Brukerkomponerte tema/prosjekter
- Tema kan konsumere signaler på tvers av domener.
- Tema skal ikke eie rådata fra andre domener.

### 2.2 Signal-kontrakt

Signaler skal være:
- versjonerte
- forklarbare (context)
- tidsvindusbaserte
- med confidence/severity

Rådata skal normalt ikke deles på tvers av domener.

## 3. Hva er implementert nå

### 3.1 Signal-infrastruktur

Implementert:
- `signal_contracts`
- `domain_signals`
- `theme_signal_links`

Migrasjon/seed:
- `drizzle/0027_domain_signals.sql`
- `scripts/apply-migration-0027.mjs`
- `scripts/seed-signal-contracts.mjs`

### 3.2 Seedede kontrakter (8 stk)

Economics -> Home/Relationship:
1. `economics_budget_pressure_7d`
2. `economics_variable_spend_spike_14d`
3. `economics_fixed_cost_burden_30d`

Home -> Relationship:
4. `home_task_load_imbalance_14d`
5. `home_planning_reliability_14d`
6. `home_overdue_shared_tasks_7d`

Relationship -> Home:
7. `relationship_coordination_readiness_today`
8. `relationship_logistics_stress_index_14d`

### 3.3 Produksjon av signaler

Implementert første producer-jobb:
- `src/lib/server/domain-signals.ts`

Kjøres via:
- `GET /api/cron/domain-signals`
- cron-jobb registrert i `/api/cron/jobs`
- samt in-app scheduler

### 3.4 Tema-kobling av signaler

Implementert:
- API for tema-signaler: `GET/PATCH /api/tema/[id]/signals`
- UI-panel i temaets Data-tab for å aktivere/deaktivere signalinput

## 4. Avklaring: Live-query vs produserte signaler

Vi bruker hybridmodell:

1. Live-signaler (query-on-read)
- Enkle, billige beregninger.
- Godt egnet for detalj/drilldown.

2. Produserte signaler (batch/materialisert)
- Dyre, ofte brukte, eller kompositt-signaler.
- Brukes av flere flater (UI, nudges, LLM).

Tommelfingerregel:
- Hvis en beregning brukes ofte og ikke trenger sekundferskhet -> produser signal.

## 5. Task -> signal (mål-evaluering)

### 5.1 Eksempel

Mål: "Løpe 20 minutter fire ganger per uke"

Bør resolves via signal:
- `activity_run_pr_week` (eller `running_sessions_ge_20m_week`)
- threshold: `4`
- comparator: `>=`
- period: ISO-uke i brukerens tidssone

### 5.2 Viktige definisjoner

For denne måltypen må vi låse:
- hva som teller som `run` (sportType=running)
- min varighet (>= 20 min)
- deduplisering av events
- hvilke ukegrenser som gjelder (timezone-aware)

## 6. Asynk parsing-pipeline for mål/oppgaver

Måltekst og TODO-punkter bør håndteres i 2 faser:

1. Synk (rask UX)
- Lagre brukertekst umiddelbart.
- Vis status: "tolkes" / "setter opp sporing".

2. Asynk (kø)
- Parse intent til struktur.
- Map til signalType + threshold + period.
- Koble mål til evaluering.

## 7. Nåværende kø-status

Ferdig:
- Generisk `background_jobs` kø med claim/retry/backoff.
- Cron/admin prosessering av kø.

Mangler:
- Task-intent parsing er koblet for chat + generell task-API, men ikke nødvendigvis alle spesialflyter.
- LLM fallback er implementert for både mål- og oppgave-parser ved no-match i regelmotor.

## 8. Implementasjonsplan (neste steg)

### Fase A - Parsingjobb for mål (MVP)

1. Ny job-type: `goal_intent_parse` ✅
- Input: `goalId`, `userId`, `rawText`, `themeId`.
- Trigger: enqueue rett etter opprettelse av mål med fri tekst.

2. Ny struktur i mål-metadata ✅
- `intentStatus`: `pending | parsed | failed`
- `intentVersion`
- `parsedIntent` (signalType, threshold, comparator, period, constraints)

3. Worker-logikk 🟡
- Parse med regler + LLM fallback.
- Oppdater målmetadata.
- Opprett/oppdater evalueringstrack.

Status nå:
- Regelbasert parser er implementert for mønster som «X ganger per/pr/i uke» + running/løping.
- Jobben prosesseres i `background_jobs` executor.
- Mål-opprettelse enqueue-er parsingjobb og setter `intentStatus=pending`.
- Mål-UI viser `Tolkes...`, `Aktiv sporing` eller `Trenger avklaring`.
- Ved parse-feil vises også menneskelig feilmelding i målkortet (for eksempel manglende "X ganger per uke").
- Repeat-tolking i lister er nå standardisert på tvers av listeinnganger:
	- ukeplan-action (`addItem`)
	- checklist item API (`POST /api/checklists/[id]/items`)
	- checklist create API (`POST /api/checklists` med `items[]`)
	- støtter mønstre som `X ganger per dag/uke/måned`, `hver dag`, `daglig`.
- Ukentlig evaluering for `activity_run_pr_week` er implementert i signal-producer:
	- teller `running` workouts i inneværende ISO-uke
	- oppdaterer `intentEvaluation` i målmetadata
	- skriver materialisert `domain_signals`-rad for videre konsum i UI/LLM.
- `task_intent_parse` er lagt til i worker og enqueue-es når chat oppretter oppgaver:
	- parser mønstre som `X ganger per dag/uke/måned` og `hver dag`
	- fyller `frequency`, `targetValue` og `unit` på oppgaven ved match.
- `POST /api/tasks` er lagt til for generell oppgaveopprettelse og enqueue-er `task_intent_parse` for ustrukturerte oppgaver.
- LLM fallback er implementert i begge parsere (regelmotor først, deretter LLM ved no-match).

### Fase B - Første målbare task->signal mapping

**Task creation auditert**: Alle oppgaveoppretting-flyter enqueue-er `task_intent_parse`:
- Generell API (`POST /api/tasks`)
- Chat tool (`create_task`)
- Begge sjekker om oppgaven trenger parsing og enqueue-er parse-job asynkront.
- Ukeplan/sjekklistepunkter: oppretter **sjekklistepunkter**, ikke oppgaver (bruker shared list-repeat parser).

Start med 3 robuste signaler:
1. `activity_run_pr_week`
2. `running_minutes_week`
3. `goal_completion_weekly`

Evalueringsjobb:
- Kjør hver time eller ved nye relevante events.
- Reberegn aktiv uke (og ev. forrige uke ved sen synk).

### Fase C - Observability og promotering til signal

1. Logg query-mønstre
- endpoint
- query-hash/familie
- latency
- calls

Status nå:
- Enkel operasjonell observability for `goal_intent_parse` er lagt til i `/api/cron/background-jobs` respons:
	- volum per status (queued/running/retry/completed/failed)
	- outcomes (matched/unmatched)
	- topp unmatched-reasons
	- topp failure-errors
- Nytt bruker-skopet debug-endepunkt: `GET /api/goals/intent-jobs?limit=20` for siste parse-jobs med payload/resultat.
- Tilsvarende operasjonell observability er lagt til for `task_intent_parse`.
- Nytt bruker-skopet debug-endepunkt: `GET /api/tasks/intent-jobs?limit=20`.
- Task parse error display er implementert i ukeplan-UI:
	- Viser `Tolkes...` / `Aktiv sporing` / `Trenger avklaring` badges for oppgaver
	- Viser menneskelig feilmelding når parse feiler (samme mapper som for mål)
	- Tasks metadata-felt lagrer intentStatus og intentError for persistens
- Task evaluation implementert:
	- Evaluerer oppgaveprogress for hver uke sammenlignet med frekvensmål
	- Lagrer evaluering (currentValue, targetValue, met) i task metadata.intentEvaluation
	- Cron-endepunkt `/api/cron/task-evaluation` evaluerer alle oppgaver for alle brukere hver gang den kjøres
	- UI viser evaluering som "X/Y denne uka (Z%) · pågår/oppnådd"
- Domain signal producer utvidet med task-signal:
	- Nytt signal: `task_completion_weekly`
	- Beregner ukentlig fullføringsgrad for aktive weekly-oppgaver med targetValue
	- Oppdaterer både `domain_signals` og `tasks.metadata.intentEvaluation` i samme kjøring
	- Kjøres via eksisterende `/api/cron/domain-signals`
- Observability utvidet:
	- `/api/cron/domain-signals` returnerer nå `producerBreakdown` med antall produserte signaler per producer-type.
	- `/api/cron/domain-signals?hours=168` returnerer også `observability` med aggregater for:
		- `taskCompletionWeekly` (`task_completion_weekly`)
		- `activityRunWeekly` (`activity_run_pr_week`)
	  - inneholder total, antall brukere, truthy/falsy outcomes, severity-fordeling og latestObservedAt.
	- Nytt debug-endepunkt: `GET /api/signals?signalType=task_completion_weekly&limit=20&hours=168`
	  - viser siste signalrader for innlogget bruker
	  - inkluderer summary per signalType (count + latestObservedAt)

Produktstatus:
- Ukeplan viser nå strukturert task-frekvens tydeligere i listen, for eksempel `4 ganger denne uka` i stedet for bare rå `weekly`.
- Ukeplan gjengir nå parse-status og feilmeldinger for oppgaver, parallelt med målsidestatus

2. Sett promoteringsterskler
- høy frekvens + moderat/høy latency
- brukes i >= 2 flater
- tåler ikke å beregnes hver request

3. Oppgrader kandidater til predefinerte signaler

### Fase D - UX-lag ("magisk")

1. Kilde-oppsett via flyt
- "Hva vil du bruke dette til?"
- anbefalte default-koblinger

2. Progressive disclosure
- avanserte valg skjules bak "Tilpass mer"

3. Effekt-språk
- vis menneskelig nytte, ikke intern signalteknikk

## 9. Suksesskriterier

Teknisk:
- mål med fri tekst går gjennom async parse og får strukturert evaluering
- minst 1 ukebasert aktivitetsmål resolves via signal

Produkt:
- bruker kan opprette mål uten å forstå signalterminologi
- systemet oppleves raskt selv når parsing/evaluering skjer i bakgrunn

LLM:
- promptkontekst bruker aktive, kuraterte signaler
- lavere tokenbruk og mer konsistente forslag

## 10. Foreslått første konkrete leveranse

Leveransepakke 1:
1. `goal_intent_parse` job-type i `background-jobs` executor ✅
2. enqueue i mål-opprettingsflyt ✅
3. enkel parser for mønsteret "X ganger per uke" ✅
4. signalet `activity_run_pr_week` med threshold-evaluering ✅
5. statusvisning i UI: "tolkes" -> "aktiv sporing" ✅
