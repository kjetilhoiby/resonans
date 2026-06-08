# Designsystem-strategi

## Problemet

Appen har duplisert styling og komponenter på tvers av forskjellige dashboards:
- HealthDashboard har `.hd-goals-section`, `.hd-category-card` osv
- EconomicsDashboard har `.ed-category-card`, `.ed-goal-card` osv  
- ThemePage har `.data-section`, `.goal-card` osv

Alle disse har **identisk eller nesten identisk styling**:
```css
background: #141414;
border: 1px solid #232323; /* eller ingen border */
border-radius: 18px;
padding: 16px;
display: flex;
flex-direction: column;
gap: 12px;
```

**Konsekvensen**: 
- Stilendringer må gjøres flere steder
- Inkonsistens når vi oppdaterer én plass men glemmer andre
- `/design/+page.svelte` er ikke en ekte levende stilguide - komponenter implementeres utenfor den

## Løsningen: Tre-stegs strategi

### Steg 1: Kortsiktig refaktorering (nå)
**Mål**: Få eksisterende dashboards til å bruke felles komponenter

**Tiltak**:
- Refaktorer EconomicsDashboard til å bruke Section-komponenten
- Fjern alle `.ed-category-card` og `.ed-goal-card` klasser
- Fjern borders for konsistens
- Bruk `<Section title="...">...</Section>` istedenfor custom div-wrapper

**Resultat**: Mindre duplisering, konsistent styling på tvers av Health og Economics

---

### Steg 2: Etabler designsystem-prosess (neste)
**Mål**: Gjør `/design/+page.svelte` til den faktiske kilden for komponenter

**Prinsipper**:
1. **Design først**: Når vi trenger ny styling, starter vi i `/design/+page.svelte`
2. **Dokumenter i bruk**: Hver komponent i `$lib/components/ui/` MÅ vises i design-siden
3. **Levende dokumentasjon**: Design-siden er ikke bare eksempler - det er faktisk kode vi bruker

**Workflow**:
```
Trenger ny komponent?
  ↓
Lag den i /lib/components/ui/
  ↓
Legg til eksempel i /design/+page.svelte
  ↓
Bruk den i appen
```

**Regel**: "Hvis det ikke finnes i `/design`, skal det legges til der før det brukes i produksjon"

---

### Steg 3: Strukturert component library (langsiktig)
**Mål**: Full separasjon mellom base, composed og domain components

**Struktur**:
```
src/lib/components/
├── ui/           # Base components
│   ├── Button.svelte
│   ├── Section.svelte
│   ├── Card.svelte
│   ├── Input.svelte
│   └── GoalRing.svelte
│
├── composed/     # Sammensatte komponenter
│   ├── GoalCard.svelte      (Section + GoalRing + actions)
│   ├── MetricCard.svelte    (Section + GoalRing + metadata)
│   └── CategoryList.svelte  (Section + bar charts)
│
└── domain/       # Domain-spesifikke dashboards
    ├── HealthDashboard.svelte
    ├── EconomicsDashboard.svelte
    └── RelationshipDashboard.svelte
```

**Gevinster**:
- Klar separasjon av ansvar
- Lettere å teste base components isolert
- Composed components kan gjenbrukes på tvers av domener
- Domain components blir tynnere - kun dataflyt og layout

---

## Designprinsipper (fra /design/+page.svelte)

**Seksjoner** (Section.svelte):
- `background: #141414` (mørkegrå)
- `border-radius: 18px` (avrundet)
- **INGEN border/hårlinje** (renere look)
- `padding: 16px`
- Valgfri tittel (h2, 0.88rem, #e7e7e7)

**Kort inne i seksjoner**:
- `background: #0d0d0d` (enda mørkere for kontrast)
- `border-radius: 12px` (litt mindre radius)
- Ingen border
- Brukes for individuelle items i en liste

**Fargepalett**:
- Bakgrunn: `#0f0f0f` (page), `#141414` (sections), `#0d0d0d` (cards)
- Tekst: `#e7e7e7` (titler), `#ccc` (body), `#777`/`#555` (meta)
- Accent: `#7c8ef5` (primær blå), `#5fa0a0` (teal), `#e07070` (rød)

---

## Implementasjonsstatus

### ✅ Fullført
- [x] Section.svelte base component opprettet
- [x] HealthDashboard refaktorert (borders fjernet)
- [x] ThemePage goals duplikatvisning fjernet
- [x] **Steg 1**: EconomicsDashboard refaktorert til Section
- [x] **Steg 2**: "Layout & Structure" seksjon lagt til i /design/+page.svelte
- [x] **Steg 2**: Section, ScreenTitle, CompactRecordList dokumentert i design
- [x] **Steg 2**: ChatInput dokumentert i design under Chat-bobler
- [x] **Steg 2**: Audit av alle UI-komponenter
- [x] **Steg 3**: Component library restrukturering fullført
- [x] **Steg 3**: Opprettet ui/, composed/, domain/ mapper
- [x] **Steg 3**: Flyttet 11 komponenter til riktig mappe
- [x] **Steg 3**: Oppdatert alle imports i routes og komponenter
- [x] **Steg 3**: Opprettet index.ts barrel exports for alle mapper

### 📋 Neste steg
- [ ] Dokumenter composed komponenter (GoalCard, TriageCard) i /design
- [ ] Etabler workflow-dokumentasjon for nye komponenter
- [ ] Vurder om sheets/overlays skal flyttes til egen ui/sheets/-mappe

## Komponentstruktur (etter Steg 3)

### ui/ - Base components (16 komponenter)
**Layout & Structure:**
- Section ✓ (dokumentert i /design)
- ScreenTitle ✓ (dokumentert i /design)
- CompactRecordList ✓ (dokumentert i /design)
- ThemeRail

**Data Visualization:**
- GoalRing ✓ (dokumentert i /design)
- PeriodPills ✓ (dokumentert i /design)
- StreakBadge ✓ (dokumentert i /design)
- RelationSparkline ✓ (dokumentert i /design)
- WidgetCircle
- CompactTrendChart

**Interaction:**
- ChatBubble ✓ (dokumentert i /design)
- ChatInput ✓ (dokumentert i /design)

**Sheets & Overlays:**
- ChatSheet
- ChecklistSheet
- WidgetConfigSheet
- TransactionList

### composed/ - Composed components (5 komponenter)
**Goal Components:**
- GoalCard (Section + GoalRing + actions)
- DynamicWidget (WidgetCircle + goal data)

**List Components:**
- TriageCard (kompakt konversasjonsvisning)
- ChecklistWidget (sjekkliste med streaks)
- TaskList (oppgaveliste)

### domain/ - Domain dashboards (6 komponenter)
**Dashboards:**
- HealthDashboard (helse-metrics og mål)
- EconomicsDashboard (økonomi-kategorier og mål)
- SensorDashboard (sensor-data og mål)

**Complex Views:**
- ThemePage (tema med chat, goals, sub-dashboards)
- HomeScreen (widgets, triage, sjekklister)
- SensorPane (detaljert sensor-visning)

## Import-mønstre

### Fra routes
```svelte
// Domain components
import HomeScreen from '$lib/components/domain/HomeScreen.svelte';
import HealthDashboard from '$lib/components/domain/HealthDashboard.svelte';

// Composed components  
import GoalCard from '$lib/components/composed/GoalCard.svelte';
import TriageCard from '$lib/components/composed/TriageCard.svelte';

// Base components
import Section from '$lib/components/ui/Section.svelte';
import GoalRing from '$lib/components/ui/GoalRing.svelte';
```

### Innad i domain/ komponenter
```svelte
// Relatİve paths til søsken-mapper
import CompactRecordList from '../ui/CompactRecordList.svelte';
import GoalRing from '../ui/GoalRing.svelte';
import TriageCard from '../composed/TriageCard.svelte';
```

### Innad i composed/ komponenter
```svelte
// Importer kun fra ui/
import GoalRing from '../ui/GoalRing.svelte';
import Section from '../ui/Section.svelte';
```

### Alternativt: Barrel exports
```svelte
// Du kan også bruke barrel exports via index.ts
import { Section, GoalRing } from '$lib/components/ui';
import { GoalCard } from '$lib/components/composed';
import { HealthDashboard } from '$lib/components/domain';
```

---

## Vedlikehold

**Når du legger til ny styling**:
1. Sjekk først om den finnes i `/design/+page.svelte`
2. Hvis nei, legg den til der først
3. Dokumenter i denne filen hvis det er en ny pattern

**Når du ser duplisert CSS**:
1. Flytt det til en reusable component i `$lib/components/ui/`
2. Oppdater `/design/+page.svelte` med eksempel
3. Refaktorer eksisterende bruk til å bruke den nye komponenten

**Når du endrer base styling**:
1. Endre i base component (f.eks. Section.svelte)
2. Sjekk at /design/+page.svelte reflekterer endringen
3. Test at alle brukssteder ser riktige ut
