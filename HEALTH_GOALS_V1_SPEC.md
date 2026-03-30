# Health Goals v1 - Data Model Specification

**Created:** 2026-03-30  
**Status:** Implementation Phase

## Executive Summary

Migrate health goals (running, weight) from the goal-tracks system (stored in `memories` table) to the proper `goals` domain table. This unifies goal management and removes architectural confusion about "where goals live".

## Key Decisions

1. **Drop seasonal profile entirely** - forecasting/modeling belongs in a separate system, not goal creation
2. **Running goals are date-bounded** - specify period explicitly (startDate → endDate + targetValue)
3. **Weight goals have baseline** - track from starting point (startDate + startValue → targetDate + targetValue)
4. **Goal-tracks become internal** - derived from goals for dashboard calibration, not user-editable
5. **Health dashboard displays goals** - reads from goals table, doesn't own goal creation

## Data Model

### Goals Table Schema Extensions

The existing `goals` table needs to support baseline values for trajectory goals:

```typescript
// Existing schema (no migration needed, use metadata)
export const goals = pgTable('goals', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  categoryId: text('category_id'),
  themeId: uuid('theme_id').references(() => themes.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  description: text('description'),
  targetDate: timestamp('target_date'),
  status: text('status').notNull().default('active'), // 'active' | 'completed' | 'archived'
  metadata: jsonb('metadata'), // Extended to store metricId, startValue, startDate, unit
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
```

### Goal Metadata Structure

#### Running Goal (Level/Target)
```typescript
{
  metricId: 'running_distance',
  startDate: '2026-03-30', // Period start
  endDate: '2026-04-06',   // Period end (optional, inferred from window if missing)
  targetValue: 25,          // Target km for period
  unit: 'km',
  kind: 'level',            // Type of goal
  window: 'week'            // Time window (week, month, quarter, year)
}
```

#### Weight Goal (Trajectory)
```typescript
{
  metricId: 'weight_change',
  startDate: '2026-03-30',  // Baseline date
  startValue: 85,           // Baseline weight (kg)
  targetDate: '2026-05-30', // Target achievement date
  targetValue: 80,          // Target weight (kg)
  unit: 'kg',
  kind: 'trajectory',       // Indicates baseline → target progression
  window: 'custom'
}
```

### Goal Examples

**Running Goal - Weekly:**
- title: "Løpe 25 km denne uken"
- description: "Ukentlig løpemål for 30. mars - 6. april 2026"
- targetDate: 2026-04-06
- metadata: `{metricId: 'running_distance', startDate: '2026-03-30', endDate: '2026-04-06', targetValue: 25, unit: 'km', kind: 'level', window: 'week'}`

**Weight Goal - 2 Months:**
- title: "Gå ned til 80 kg"
- description: "Vektmål fra 85 kg til 80 kg over 2 måneder"
- targetDate: 2026-05-30
- metadata: `{metricId: 'weight_change', startDate: '2026-03-30', startValue: 85, targetDate: '2026-05-30', targetValue: 80, unit: 'kg', kind: 'trajectory', window: 'custom'}`

## UI Flow

### HealthDashboard Changes

**Before (Current):**
- Manual input fields for week/quarter/year running goals
- Manual input fields for 2mo/2yr weight goals + seasonal profile
- Saves to `/api/goal-tracks/[metricId]` (memories table)

**After (v1):**
- Reads active goals from goals table filtered by `themeId = 'helse'`
- Displays goal progress using existing GoalRing component
- "Nytt mål" button opens goal creation form (reuse existing goal UI)
- Inline edit/archive via goals API, not dashboard-specific endpoints

### Goal Creation Flow

1. User clicks "Nytt mål" in health dashboard
2. Form shows:
   - **Mål-type:** [Løpedistanse | Vekt]
   - **Tittel:** auto-generated or custom
   - **Periode:** (for running) [Uke | Måned | Kvartal | År | Egendefinert]
   - **Startdato:** (default today)
   - **Sluttdato:** (auto-filled based on period, editable in egendefinert)
   - **Målverdi:** (target km or kg)
   - For weight goals only:
     - **Startvekt:** (baseline kg)
3. Saves to goals table via `/api/goals` endpoint
4. Goals server creates corresponding goal-track automatically (internal)

## API Changes

### New/Modified Endpoints

**POST /api/goals** (existing, enhanced)
- Accepts health goal creation with metadata structure above
- Automatically creates goal-track via `upsertGoalTrack` for dashboard calibration
- Returns created goal with ID

**GET /api/goals?themeId=helse&status=active**
- Returns active health goals for current user
- Includes metadata with metricId, baseline values, target values

**DELETE /api/goals/[id]** or **PATCH /api/goals/[id]** (may need to create)
- Archive or update existing goals

### Deprecated (Phase Out)

- `/api/goal-tracks/running_distance` - becomes read-only or internal
- `/api/goal-tracks/weight_change` - becomes read-only or internal
- Manual goal-track editing UI in HealthDashboard

## Migration Strategy

### Phase 1: Schema Extension (No Migration Needed)
- Metadata field already exists as `jsonb`
- Document metadata structure in TypeScript types

### Phase 2: UI Changes
1. Remove seasonal profile inputs from HealthDashboard
2. Remove running/weight manual input fields
3. Add goal list display reading from goals table
4. Add "Nytt mål" button linking to goal creation form

### Phase 3: Data Migration (Optional)
- Existing goal-tracks in memories table can remain for historical context
- New goals created via proper goals table
- Consider one-time migration script if needed to convert goal-tracks → goals

### Phase 4: Deprecation
- Mark /api/goal-tracks endpoints as internal-only after 30 days
- Remove manual track editing UI completely

## Implementation Checklist

- [x] Add TypeScript types for health goal metadata
- [x] Extend goals.ts createGoal to handle health metadata structure
- [x] Remove seasonal profile from HealthDashboard.svelte
- [ ] Remove manual goal input fields from HealthDashboard
- [x] Add goals query to HealthDashboard data loading
- [x] Display goals as read-only cards with status
- [ ] Add goal creation form (or link to existing goal UI)
- [ ] Update goal-tracks.ts to become internal/derived function
- [ ] Integration test: create running goal → verify goal-track created
- [ ] Integration test: create weight goal → verify baseline stored

## Success Criteria

1. Health dashboard reads goals from `goals` table, not `memories`
2. Users can create running goals with explicit date ranges
3. Users can create weight goals with baseline values
4. Seasonal profile is removed from UI
5. Goal-tracks are automatically derived, not manually edited
6. Single source of truth for "what are my goals?"

## Notes

- Keep existing goal-tracks.ts for internal calibration purposes
- GoalRing component can continue using goal-tracks for visualization
- Eventually consider merging goal-track generation into dashboard query layer
