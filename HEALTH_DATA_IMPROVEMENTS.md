# Helsedata-overhaling – Oppsummering

## 🔍 Problemanalyse

### Oppdaget problemer:
1. **Ekstremt lave skrittverdier** - Noen dager viste 12, 23, 31 skritt i stedet for tusenvis
2. **Separate datastrømmer** - Withings sender daglig aktivitet og workouts separat, uten integrasjon
3. **Timezone-problem** - `new Date("2026-04-12")` skapte uforutsigbare datoforskyvninger
4. **Overaggressiv workout-filtrering** - Alle walking workouts ble filtrert bort, selv lange turer
5. **Inkonsistente enheter** - Distanse var om meters eller km avhengig av kilde

### Root cause:
- Dataene fra Withings API var **korrekte** - ikke et parsing-problem
- Withings synkroniserer ikke alltid fullstendig (telefon hjemme, manglende sync, etc.)
- Daglig aktivitet (`getactivity`) og treningsøkter (`getworkouts`) er separate API-endepunkter
- Når brukeren trener uten telefon, får vi workout-data men ikke steps-data

## ✅ Implementerte forbedringer

### 1. API-forbedringer (`/api/tema/[id]/health-stats/+server.ts`)

**Integrert workout-data med daglig aktivitet:**
```typescript
// Grupper workouts per dato
const workoutsByDate = new Map<string, typeof workouts>();

// Estimer skritt fra workouts (1 km ≈ 1300 skritt)
const estimatedStepsFromWorkouts = Math.round(totalWorkoutDistance * 1300);

// Bruk estimert verdi når daglig data er svært lav
const totalEstimatedSteps = day.isLowQuality && estimatedStepsFromWorkouts > day.steps
  ? estimatedStepsFromWorkouts
  : day.steps;
```

**Lagt til kvalitetsindikatorer:**
- `isLowQuality`: Flag for dager med < 100 skritt
- `lowQualityDays`: Antall dager med estimert data
- `totalEstimatedSteps`: Kombinert faktisk + estimert

**Normalisert enheter:**
- Alle distanser konverteres til km konsekvent
- Varighet i minutter (ikke sekunder)

### 2. UI-forbedringer (`TripHealthStats.svelte`)

**Visuell feedback for datakvalitet:**
- Orange bakgrunn for lav-kvalitet dager
- ⚠️ advarselbadge viser antall estimerte dager
- Tooltips forklarer estimeringslogikk
- Estimert verdi vist i parentes: `4206 skritt (~5200)`

**Forbedret workout-visning:**
- Viser dato (ikke bare timestamp)
- Konsistent km-format for distanse
- Varighet i minutter

**Nye CSS-klasser:**
```css
.ths-warning-badge {
  background: #78350f;
  color: #fbbf24;
  /* Tooltip on hover */
}

.ths-daily-item.low-quality {
  background: #1a1007;
  border-color: #78350f;
}

.ths-estimated {
  color: #fbbf24;
  cursor: help;
}
```

### 3. Withings sync-forbedringer (`withings-sync.ts`)

**Fikset timezone-håndtering:**
```typescript
// FØR: new Date("2026-04-12") → uforutsigbar timezone
// ETTER: new Date("2026-04-12T00:00:00.000Z") → alltid UTC midnatt
timestamp: new Date(activity.date + 'T00:00:00.000Z')
```

**Smart workout-filtrering:**
```typescript
// Behold signifikante walks, filtrer bare korte automatiske
const isSignificantWalk = duration > 1800 || distance > 2000; // >30 min ELLER >2 km
```

FØR: Alle walking workouts filtrert bort (100% reject)  
ETTER: Kun korte walks < 30 min OG < 2 km filtrert bort

### 4. Debug-scripts opprettet

**`scripts/debug-withings-steps.mjs`**
- Sjekker hva Withings API faktisk returnerer
- Sammenligner database-data med API-respons
- Viser type og verdi for steps-felt

**`scripts/check-daily-events.mjs`**
- Aggregerer events per dag
- Sjekker for duplikater som må summeres
- Verifiserer at det kun er 1 event per dag

**`scripts/audit-health-data.mjs`**
- Omfattende oversikt over alle helsedata-typer
- Viser activity, workouts, weight, sleep
- Identifiserer gaps og datakvalitetsproblemer

## 📊 Resultater

### Før:
- Dager med 12, 23, 31 skritt vist som fakta
- Ingen indikasjon på datakvalitet
- Workouts ikke koblet til daglig aktivitet
- Timezone-forskyvninger skapte forvirring
- Walking workouts helt usynlige

### Etter:
- Lav-kvalitet dager merket visuelt
- Estimerte verdier fra workouts når aktivitet mangler
- Tydelig indikasjon: "⚠️ 3 estimert"
- Workout-data integrert i daglig visning
- Signifikante walks inkludert i workout-liste
- Konsistente datoer og enheter

## 🔮 Fremtidige forbedringer (ikke implementert ennå)

1. **Deduplisering av workouts** - Sammenlign Withings med GPX/TCX imports
2. **Canonical activity layer** - Merge alle kilder til én unified view
3. **GPS track data** - Import fra GPX for mer detaljert visning
4. **Activity intensity visualization** - Bedre fremstilling av soft/moderate/intense minutter
5. **Weekly/monthly aggregates** - Oppdater aggregation.ts med nye beregninger

## 📁 Endrede filer

1. `/src/routes/api/tema/[id]/health-stats/+server.ts` - API-logikk
2. `/src/lib/components/domain/TripHealthStats.svelte` - UI-komponent
3. `/src/lib/server/integrations/withings-sync.ts` - Sync-logikk
4. `/scripts/debug-withings-steps.mjs` - Debug-tool (ny)
5. `/scripts/check-daily-events.mjs` - Debug-tool (ny)
6. `/scripts/audit-health-data.mjs` - Debug-tool (ny)

## 🧪 Testing

**Kompilering:**
```bash
npm run build  # ✅ No errors
```

**Kjøretidstest:**
- API returnerer forbedret data med kvalitetsflagg
- UI viser advarsler og estimater korrekt
- Timezone-håndtering konsistent
- Workout-filtrering bevarer signifikante walks

## 💡 Læringer

1. **Valider datakilde først** - Problemet var ikke koden, men Withings API-data
2. **Separate datastrømmer må integreres** - Activity og workouts må kobles sammen
3. **Kvalitetsindikatorer er viktige** - Brukere må vite når data er estimert
4. **Timezone er vanskelig** - Alltid bruk eksplisitt UTC når du parser datoer
5. **Smart filtrering > hard filtrering** - Kontekstuell logikk bedre enn absolute regler

---

**Konklusjon:**  
Helsedataen er nå mye mer brukbar og pålitelig. Systemet håndterer ufullstendig data elegant ved å estimere fra alternative kilder og tydelig kommunisere når data er usikker.
