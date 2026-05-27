# Ekko ↔ Resonans: Hybride treningsprogrammer (Fase 3)

Spec for integrasjon mellom Ekko-iOS-appen og Resonans-backenden for LLM-genererte
hybridprogrammer (styrke + løping). Komplementerer fase 1 (GPS-uploads) og fase 2
(strength_workout-events).

> **Status:** v1, mai 2026. Endepunkter under `/api/apps/programs/*` på Resonans.

---

## 1. Autentisering

Alle endepunktene bruker eksisterende OAuth-koblet Bearer-token (`rsn_...`).

```
Authorization: Bearer rsn_<base64url>
```

Samme token som `/api/apps/upload` og `/api/apps/event`. Token er bundet til
brukeren via tabellen `user_api_secrets` i Resonans og refreshes ikke — Ekko
beholder samme token mellom kjøringer.

| HTTP-kode | Når brukes den |
|-----------|----------------|
| `401` | Token mangler, er revoked eller utløpt. Ekko må re-autentisere via `/api/apps/authorize`. |

---

## 2. Endepunktsoversikt

| Metode | Path | Beskrivelse |
|--------|------|-------------|
| `POST` | `/api/apps/programs/generate` | Generer + lagre nytt hybridprogram (synkront LLM-kall). |
| `GET` | `/api/apps/programs` | Liste over brukerens programmer (kort sammendrag). |
| `GET` | `/api/apps/programs/:id` | Fullt program med alle uker, økter og øvelser. |
| `GET` | `/api/apps/programs/:id/today` | Dagens planlagte økt (eller null hvis ingen). |
| `POST` | `/api/apps/programs/:id/complete-session` | Kobl en planlagt økt til et fullført `sensorEvent` og kjør progresjon. |
| `POST` | `/api/apps/programs/:id/status` | Endre status (`active`/`paused`/`completed`/`archived`). |
| `DELETE` | `/api/apps/programs/:id` | Slett program og alt tilhørende (cascade). |

---

## 3. Datamodell — det Ekko bør speile lokalt

```
TrainingProgram
  id                 UUID
  userId             string
  name               string
  goal               string
  durationWeeks      int        // 1..16
  sessionsPerWeek    int        // 1..7
  status             enum       // 'active'|'paused'|'completed'|'archived'
  includeStrength    bool
  includeRunning     bool
  startDate          date       // YYYY-MM-DD, uke 1 starter denne dagen
  createdAt          datetime
  updatedAt          datetime
  generatedWith      json?      // { model, promptVersion, generatedAt, inputs }
  weeks              ProgramWeek[]

ProgramWeek
  id                 UUID
  weekNumber         int        // 1-basert
  deload             bool
  notes              string?
  sessions           ProgramSession[]

ProgramSession
  id                 UUID
  weekNumber         int        // duplisert for lett tilgang
  dayNumber          int        // 1=mandag .. 7=søndag, unik i uken
  kind               enum       // 'strength' | 'run'
  name               string     // f.eks. "Styrke A" / "Rolig 5k"
  restSeconds        int?       // hvile mellom sett (styrke)
  notes              string?
  plannedExercises   PlannedExercise[]?   // hvis kind='strength'
  plannedRun         PlannedRun?          // hvis kind='run'
  completion         SessionCompletion?   // null = ikke fullført

PlannedExercise
  id                 UUID
  order              int
  exerciseName       string     // EN AV DE 5 TILLATTE
  sets               int        // 1..8
  repsTarget         int?       // reps-baserte øvelser
  durationSecondsTarget int?    // tidsbaserte øvelser
  weightHint         string?    // fritekst, f.eks. "10kg" / "kroppsvekt"
  notes              string?

PlannedRun
  runType            enum       // 'easy'|'tempo'|'intervals'|'long'
  targetDistanceMeters    int?
  targetDurationSeconds   int?
  intervals          [{ reps, distanceMeters?, durationSeconds?, restSeconds }]?
  warmupSeconds      int?
  cooldownSeconds    int?
  paceHintSecPerKm   int?       // valgfri, kun hvis brukeren har gitt nivå
  hrZoneHint         string?    // f.eks. "Z2"
  notes              string?

SessionCompletion
  id                 UUID
  plannedSessionId   UUID
  sensorEventId      UUID?      // FK til sensor_events (workout eller strength_workout)
  completedAt        datetime
  actuals            json?      // snapshot: { kind, duration, distance, exercises, ... }
```

---

## 4. Tillatte verdier — Ekko bør validere defensivt

### 4.1 De 5 styrkeøvelsene

```
"Utfall"                              // reps-basert, tillater weightHint
"Armhevinger"                         // reps-basert, vektløs
"Planke"                              // tidsbasert (sekunder)
"Tåhevinger"                          // reps-basert, tillater weightHint
"Sakte senking fra pullup-stang"      // tidsbasert (sekunder)
```

Eksakt skrivemåte. Resonans avviser `POST /generate` med `422
program_validation_failed` hvis LLM-en finner på andre øvelser.

### 4.2 De 4 løpsøkt-typene

```
"easy"        // rolig løp, distance eller duration
"tempo"       // tempo-økt, duration på tempo-delen + warmup/cooldown
"intervals"   // intervaller, krever ikke-tom intervals-array
"long"        // langtur, distance eller duration
```

### 4.3 Grenser

| Felt | Min | Max |
|------|-----|-----|
| `durationWeeks` | 1 | 16 |
| `sessionsPerWeek` | 1 | 7 |
| Styrkeøkter per uke | 0 | 3 |
| Øvelser per økt | 1 | 6 |
| `sets` per øvelse | 1 | 8 |
| `repsTarget` | 1 | 50 |
| `durationSecondsTarget` | 1 | 600 |

---

## 5. Endepunktene i detalj

### 5.1 `POST /api/apps/programs/generate`

Synkron generering — LLM-kall + persistering i én request. Forventet
responstid ~10–30 sekunder for et 8-ukers program. Ekko bør vise spinner og
sette en raus klient-timeout (foreslår 60 s).

**Request:**

```json
{
  "goal": "Halvmaraton om 12 uker, men jeg vil holde styrken min også",
  "durationWeeks": 12,
  "sessionsPerWeek": 4,
  "runningKmPerWeek": 25,
  "experience": "intermediate",
  "includeStrength": true,
  "includeRunning": true,
  "startDate": "2026-06-01",
  "name": "Halvmaraton + styrke"
}
```

Alle felt utenom `goal` er valgfrie. Defaults:
- `durationWeeks=8`, `sessionsPerWeek=4` (hvis hybrid), eller `3` (kun ett av delene).
- `includeStrength=true`, `includeRunning=true`.
- `startDate`=i dag.

**Response 200:**

```json
{
  "ok": true,
  "programId": "f2c3...",
  "model": "gpt-4o",
  "program": {
    "id": "f2c3...",
    "name": "Halvmaraton + styrke",
    "goal": "Halvmaraton om 12 uker, men jeg vil holde styrken min også",
    "durationWeeks": 12,
    "sessionsPerWeek": 4,
    "status": "active",
    "includeStrength": true,
    "includeRunning": true,
    "startDate": "2026-06-01",
    "createdAt": "2026-05-27T13:42:11.000Z",
    "updatedAt": "2026-05-27T13:42:11.000Z",
    "generatedWith": {
      "model": "gpt-4o",
      "promptVersion": "2026-05-ekko-hybrid-v1",
      "generatedAt": "2026-05-27T13:42:09.121Z",
      "inputs": { "goal": "...", "durationWeeks": 12, "sessionsPerWeek": 4, "experience": "intermediate", "includeStrength": true, "includeRunning": true }
    },
    "weeks": [
      {
        "id": "w1-...",
        "weekNumber": 1,
        "deload": false,
        "sessions": [
          {
            "id": "s1-...",
            "weekNumber": 1, "dayNumber": 1,
            "kind": "strength",
            "name": "Styrke A",
            "restSeconds": 90,
            "plannedExercises": [
              { "id": "e1", "order": 1, "exerciseName": "Utfall",        "sets": 3, "repsTarget": 10, "weightHint": "kroppsvekt" },
              { "id": "e2", "order": 2, "exerciseName": "Armhevinger",  "sets": 3, "repsTarget": 8 },
              { "id": "e3", "order": 3, "exerciseName": "Planke",       "sets": 3, "durationSecondsTarget": 30 },
              { "id": "e4", "order": 4, "exerciseName": "Tåhevinger",   "sets": 3, "repsTarget": 15 },
              { "id": "e5", "order": 5, "exerciseName": "Sakte senking fra pullup-stang", "sets": 3, "durationSecondsTarget": 8 }
            ],
            "completion": null
          },
          {
            "id": "s2-...",
            "weekNumber": 1, "dayNumber": 3,
            "kind": "run",
            "name": "Rolig 5k",
            "plannedRun": {
              "runType": "easy",
              "targetDistanceMeters": 5000,
              "paceHintSecPerKm": 360,
              "hrZoneHint": "Z2"
            },
            "completion": null
          },
          {
            "id": "s3-...",
            "weekNumber": 1, "dayNumber": 5,
            "kind": "run",
            "name": "Intervaller 5×800",
            "plannedRun": {
              "runType": "intervals",
              "warmupSeconds": 600,
              "cooldownSeconds": 600,
              "intervals": [
                { "reps": 5, "distanceMeters": 800, "restSeconds": 120 }
              ],
              "paceHintSecPerKm": 300
            },
            "completion": null
          },
          {
            "id": "s4-...",
            "weekNumber": 1, "dayNumber": 7,
            "kind": "run",
            "name": "Langtur",
            "plannedRun": { "runType": "long", "targetDistanceMeters": 12000, "hrZoneHint": "Z2" },
            "completion": null
          }
        ]
      }
    ]
  }
}
```

Programmet inneholder alle 12 uker. Eksempelet over er kuttet til uke 1 for
lesbarhet.

**Feilkoder:**

| Status | `code` | Når |
|--------|--------|-----|
| `400` | — | `goal` mangler / `includeStrength=false && includeRunning=false` / ugyldig JSON. |
| `401` | — | Mangler/ugyldig Bearer-token. |
| `422` | `program_validation_failed` | LLM-en brøt constraints. Response har `issues: string[]`. Ekko bør retry én gang. |
| `502` | `program_generation_failed` | LLM-kallet feilet (OpenAI nede / timeout). Retry m/ backoff. |
| `500` | `internal_error` | Database-feil eller annet uforventet. |

### 5.2 `GET /api/apps/programs`

```json
{
  "programs": [
    {
      "id": "f2c3...",
      "name": "Halvmaraton + styrke",
      "goal": "...",
      "durationWeeks": 12,
      "sessionsPerWeek": 4,
      "status": "active",
      "startDate": "2026-06-01",
      "includeStrength": true,
      "includeRunning": true,
      "createdAt": "2026-05-27T13:42:11.000Z",
      "completedSessions": 3,
      "totalSessions": 48
    }
  ]
}
```

Tom array hvis brukeren ikke har programmer.

### 5.3 `GET /api/apps/programs/:id`

Returnerer fullt program — samme `program`-payload som `POST /generate`,
inkludert hver `completion` for de økter som er fullført.

**404:** `{ "error": "Program not found", "code": "program_not_found" }`

### 5.4 `GET /api/apps/programs/:id/today`

Default basert på serverens dato (Europe/Oslo). For testing kan Ekko sende
`?date=YYYY-MM-DD`.

**Response (har økt i dag):**

```json
{
  "ok": true,
  "weekNumber": 2,
  "programStartDate": "2026-06-01",
  "session": {
    "id": "s14-...",
    "weekNumber": 2, "dayNumber": 1,
    "kind": "strength",
    "name": "Styrke A",
    "restSeconds": 90,
    "plannedExercises": [
      { "id": "e1", "order": 1, "exerciseName": "Utfall", "sets": 3, "repsTarget": 11, "weightHint": "kroppsvekt" }
    ],
    "completion": null
  }
}
```

**Response (ingen økt i dag — hviledag eller programmet ikke startet):**

```json
{ "ok": true, "session": null, "weekNumber": null, "programStartDate": null }
```

### 5.5 `POST /api/apps/programs/:id/complete-session`

Kalles ETTER at Ekko har postet selve økt-eventet (GPX-upload eller
`strength_workout`-event). `sensorEventId` er id-en Resonans returnerte fra
det forrige kallet (`/api/apps/upload` eller `/api/apps/event`).

**Request:**

```json
{
  "plannedSessionId": "s14-...",
  "sensorEventId": "evt-abc-123",
  "completedAt": "2026-06-08T07:43:00Z"
}
```

`sensorEventId` og `completedAt` er valgfrie. Hvis utelatt bruker server
`now()` og kobler ingen sensorEvent (kan settes senere med ny POST — endepunktet
er idempotent per `plannedSessionId`).

**Response:**

```json
{
  "ok": true,
  "completion": {
    "id": "c-...",
    "plannedSessionId": "s14-...",
    "sensorEventId": "evt-abc-123",
    "completedAt": "2026-06-08T07:43:00.000Z",
    "actuals": {
      "kind": "strength",
      "duration": 2400,
      "totalSets": 15,
      "totalReps": 145,
      "totalVolume": 0,
      "exercises": [
        { "name": "Utfall", "sets": [
          { "reps": 11 }, { "reps": 11 }, { "reps": 11 }
        ]}
      ]
    }
  },
  "plannedSession": {
    "id": "s14-...", "kind": "strength", "weekNumber": 2, "dayNumber": 1
  },
  "progression": {
    "applied": true,
    "summary": [
      "Utfall: traff target → neste uke 12 reps",
      "Planke: traff target → neste uke 35s"
    ]
  }
}
```

`progression.summary` er liste over endringer som ble gjort på senere uker —
nyttig som debug-info i Ekko, men trygt å skjule for sluttbruker.

**Feilkoder:**

| Status | `code` | Når |
|--------|--------|-----|
| `400` | — | `plannedSessionId` mangler. |
| `404` | `session_not_found` | `plannedSessionId` eksisterer ikke, eller hører ikke til denne brukeren / dette programmet. |

### 5.6 `POST /api/apps/programs/:id/status`

```json
{ "status": "paused" }
```

`status` ∈ `{active, paused, completed, archived}`.

**Response:** `{ "ok": true, "status": "paused" }`

### 5.7 `DELETE /api/apps/programs/:id`

Sletter program + alle uker, økter, øvelser og completion-koblinger
(cascade). `sensorEvents` slettes IKKE — bare koblingen via `sensorEventId`
i completion settes til null før cascade. Det reelle treningseventet
overlever som data i brukerens timeline.

**Response:** `{ "ok": true }` — `404` hvis programmet ikke finnes.

---

## 6. Full eksempelflyt

### Steg 1: Generer program

```
POST /api/apps/programs/generate
Authorization: Bearer rsn_...

{
  "goal": "Halvmaraton om 12 uker + holde styrken",
  "durationWeeks": 12,
  "sessionsPerWeek": 4,
  "experience": "intermediate"
}
```

→ Får `programId=f2c3...` og fullt program.

### Steg 2: Hver morgen — hva er på programmet i dag?

```
GET /api/apps/programs/f2c3.../today
```

Anta svaret er en styrkeøkt med Utfall (3×10), Armhevinger (3×8), Planke
(3×30s).

### Steg 3: Bruker gjør styrkeøkten i Ekko

Ekko poster først selve økt-eventet:

```
POST /api/apps/event
Authorization: Bearer rsn_...

{
  "app": "ekko",
  "eventType": "activity",
  "dataType": "strength_workout",
  "timestamp": "2026-06-08T07:00:00Z",
  "dedupeKey": "ekko-strength-2026-06-08-0700",
  "data": {
    "duration": 2400,
    "totalSets": 9,
    "totalReps": 81,
    "totalVolume": 0,
    "avgHeartRate": 118,
    "maxHeartRate": 142,
    "exercises": [
      { "name": "Utfall", "sets": [
        { "reps": 10, "completedAt": "2026-06-08T07:02:00Z" },
        { "reps": 10, "completedAt": "2026-06-08T07:05:00Z" },
        { "reps": 10, "completedAt": "2026-06-08T07:08:00Z" }
      ]},
      { "name": "Armhevinger", "sets": [
        { "reps": 8 }, { "reps": 8 }, { "reps": 8 }
      ]},
      { "name": "Planke", "sets": [
        { "durationSeconds": 30 }, { "durationSeconds": 30 }, { "durationSeconds": 30 }
      ]}
    ]
  }
}
```

→ Får `eventId=evt-abc-123`.

### Steg 4: Marker programmets økt som fullført

```
POST /api/apps/programs/f2c3.../complete-session

{
  "plannedSessionId": "s14-...",
  "sensorEventId": "evt-abc-123"
}
```

→ Resonans:
1. Snapper opp `actuals` fra sensorEventet.
2. Kjører progression: traff alle target → bumper Utfall til 11 reps, Armhevinger til 9 reps, Planke til 35s i uke 3 (uke 2 var allerede generert, bumpen treffer NESTE uke uten deload).
3. Returnerer `progression.summary` for transparens.

### Steg 5: Hopp til løpsøkten om to dager

`GET /api/apps/programs/f2c3.../today` → planlagt: `intervals` 5×800m, paceHint 5:00/km.

Ekko laster opp GPX:

```
POST /api/apps/upload (multipart)
  app=ekko
  sportType=running
  sessionId=ekko-run-2026-06-10-...
  file=<gpx-data>
```

→ Får `eventId=evt-def-456`.

Deretter:

```
POST /api/apps/programs/f2c3.../complete-session
{ "plannedSessionId": "s16-...", "sensorEventId": "evt-def-456" }
```

→ `actuals.kind="run"`, distance + pace fra GPX, progression skalerer
neste ukes intervaller eller easy/long.

---

## 7. Progresjonsregler

Server-side i `applyProgression()`. Endringer bare på FREMTIDIGE ikke-deload
uker. Allerede fullførte uker eller deload-uker røres ikke.

**Styrke:**
- Treff target på alle sett (reps ≥ repsTarget eller durationSeconds ≥ durationSecondsTarget for hvert sett):
  - reps-basert: +1 rep på neste ukes target.
  - tidsbasert: +5 sekunder på neste ukes target.
- Bommet på minst ett sett: hold neste ukes target uendret.
- Caps: `repsTarget ≤ 50`, `durationSecondsTarget ≤ 600`.

**Løp:**
- Beregn completionFraction = faktisk distanse/varighet ÷ target.
- ≥ 0.95: skaler neste uke målet med ×1.05.
- 0.80–0.95: hold uendret (×1.0).
- < 0.80: skaler ned (×0.9) for å gjenoppta progresjon trygt.
- For intervaller: ingen automatisk justering i v1 (kompleks).

---

## 8. Rate limits og kostnad

- `/generate` er det eneste dyre endepunktet. ~$0.05–0.15 per program
  (GPT-4o, 1–3k input + 4–10k output tokens for 8-ukers program).
- Ingen hard rate limit i v1, men Ekko bør:
  - Vise eksplisitt bekreftelse før kallet ("Generere nytt program?").
  - Disable knappen mens kallet pågår (10–30s).
  - Cache `program`-svaret klient-side; ikke generer på nytt unødvendig.
- For å bytte modell senere: backend leser `EKKO_PROGRAM_MODEL` env-var.
  Default = `gpt-4o`. Endring krever ikke kode-endring i Ekko.

---

## 9. Idempotens og robusthet

- `complete-session` er idempotent per `plannedSessionId`: gjenta kallet
  oppdaterer eksisterende completion, lager ikke ny.
- `generate` er IKKE idempotent — hvert kall lager nytt program. Ekko må
  hindre at brukeren trykker "Generer" to ganger på rad.
- Sletting av et `sensorEvent` (f.eks. fra Resonans-UI) setter
  `completion.sensorEventId` til null men beholder `actuals`-snapshot, så
  progresjonsdata overlever.

---

## 10. Endringer fremover

Hvis vi senere utvider:

- Flere styrkeøvelser → oppdater `STRENGTH_EXERCISES` i
  `src/lib/server/programs/constants.ts`, generator-prompten og denne
  speccen samtidig.
- Flere løpsøkt-typer (f.eks. `progression`, `hill_repeats`) → oppdater
  `RUN_TYPES`-arrayet og validatoren.
- Sykling / sykkelprogrammer → ny `kind` enum + ny sport-validator.
- Bytte LLM → `EKKO_PROGRAM_MODEL` env-var, ingen klientendring.

For alle endringer i tillatte øvelser/typer: Ekko-klienten bør oppdatere
sin defensive validering så den fanger backend-svar med eldre/nyere navn.
