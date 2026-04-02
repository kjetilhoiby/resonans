# Refaktoring Verifisering — Test Liste

**Dato:** 2. April 2026  
**Branch:** `refactor-domain-skill-tool-flow`  
**Commits:** 6 checkpoints (a5cceda → 748f899)  
**Phase:** Complete (Phases 1-6 implemented & committed; Phases 7-8 skipped for architectural stabilization)

---

## Sammendrag av Endringer

### ✅ Phase 1: Widget Skill Extraction
- **Commit:** `a5cceda`
- **Files:** 8 changed, 290 insertions(+), 203 deletions(-)
- **Changes:**
  - Created `src/lib/skills/widget-creation/service.ts` (centralized CRUD layer)
  - Moved `WidgetDraft` type to `src/lib/artifacts/widget-draft.ts`
  - Updated 8 files to use service functions instead of inline queries
  - **Impact:** Widget operations now route through single service; no duplication

### ✅ Phase 2: Tool-Layer Modularization + Prompt Routing
- **Commits:** `ced7b96`, `375dcd3`
- **Changes:**
  - Added `detectPromptFocusModules()` to `src/lib/server/openai.ts`
  - Integrated per-message focus module routing into chat endpoint
  - **Focus modules:** health, economics, widgets, themes, planning
  - **Impact:** System prompt now dynamically adapts to user input domain

### ✅ Phase 3: Flow-Layer for Widget Creation
- **Commit:** `7b72277` (pre-summarization)
- **Files:** `src/lib/flows/widget-creation/flow.ts`
- **Changes:**
  - `WidgetCreationFlow` state machine with 8 states
  - `createWidgetFlowFromDraft()` and `markWidgetFlowCreated()` helpers
  - Flow metadata integrated into chat responses
  - **Impact:** Widget creation state now explicit and traceable

### ✅ Phase 4: Chat Router Layer
- **Commit:** `7b72277` (pre-summarization)
- **Files:** `src/lib/server/chat-router.ts`
- **Changes:**
  - `routeChatRequest()` function analyzes input → domains + skills + hints
  - Returns `ChatRoutingDecision` object used by orchestration layer
  - **Impact:** Explicit routing decisions enable future tool/domain constraints

### ✅ Phase 5: Domain Modules
- **Commit:** `ea8f411`
- **Files:** 3 new files in `src/lib/domains/`
- **Changes:**
  - `src/lib/domains/health/index.ts` — Health metrics + validation + triggers  
  - `src/lib/domains/economics/index.ts` — Spending categories + query helpers
  - `src/lib/domains/index.ts` — Domain metadata and resolution helpers
  - **Impact:** Domain semantics centralized; easy to query valid metrics/categories

### ✅ Phase 6: System Prompt Modularization
- **Commit:** `748f899`
- **Files:** 5 new/changed in `src/lib/server/prompts/`
- **Changes:**
  - `BASE_PROMPT` — identity, tone, core principles
  - `DOMAIN_PROMPTS` — health, economics, widgets, planning, themes, ai_registration
  - `buildModularSystemPrompt()` — assembles base + active domains + skills + hints
  - **Impact:** System prompt is now composable; easier to adjust per domain

---

## Test Categories

### 1. Widget Creation Flow (Phase 1 & 3)

**Description:** Verify widget proposal, creation, and configuration work end-to-end.

#### Test 1.1: Widget Proposal
- [ ] User sends: "Vis meg søvn per dag siste 30 dager"
- [ ] System calls `propose_widget` tool (NOT create_widget)
- [ ] Response includes:
  - `widgetProposal` object in metadata
  - `widgetFlow` object with state='draft_created'
  - Live preview of expected data
  - Formatted suggestion card with config options
- [ ] Type check: `widgetProposal` type matches `src/lib/artifacts/widget-draft.ts`

#### Test 1.2: Widget Creation
- [ ] User clicks "Opprett" on proposal card
- [ ] System calls `create_widget` with draft parameters
- [ ] Widget appears on home screen
- [ ] Response includes `widgetFlow` with state='created' + widgetId
- [ ] Database query confirms widget pinned to user

#### Test 1.3: Widget Configuration
- [ ] User sends: "Sett terskelen til 8 timer søvn"
- [ ] System calls `get_widgets` first to find widgetId
- [ ] Then calls `update_widget` with thresholdSuccess=8
- [ ] Widget updates on home screen immediately
- [ ] New configuration persists across sessions

#### Test 1.4: Service Layer Consistency
- [ ] Verify `listUserWidgets()` returns same results as direct DB query
- [ ] Verify `createUserWidget()` respects validation constants
- [ ] Verify decimal handling (decimal strings → client numbers)
- [ ] Verify similar widget detection works (no duplicates created)

### 2. Chat Router & Routing Decisions (Phase 4)

**Description:** Verify `routeChatRequest()` correctly identifies domains and skills.

#### Test 2.1: Health Domain Routing
- [ ] Input: "Hvordan går det med søvnen?" → domains includes 'health'
- [ ] Input: "Jeg veier 82 kg i dag" → domains includes 'health'
- [ ] Input: "Hvor mange liter vann skal jeg drikke?" → domains includes 'health'
- [ ] Verify `focusModules` array includes detected modules

#### Test 2.2: Economics Domain Routing
- [ ] Input: "Hva er saldoen min?" → domains includes 'economics'
- [ ] Input: "Hvor mye brukte jeg på mat i januar?" → domains includes 'economics'
- [ ] Input: "Vis utgifter siden siste lønn" → domains includes 'economics'
- [ ] Verify domains + payPeriod hints are correct

#### Test 2.3: Widget Skill Detection
- [ ] Input: "Lag widget for dagligvareforbruk" → skills includes 'widget_creation'
- [ ] Input: "Vis meg forbruk per dag" → skills includes 'widget_creation'
- [ ] Verify hints suggest `propose_widget` flow

#### Test 2.4: Multi-Domain Requests
- [ ] Input: "Jeg løp 5 km i dag og brukte 150 kr på mat" → domains = ['health', 'economics']
- [ ] Verify both domain prompts included in system prompt
- [ ] Verify skills correctly detect multiple relevant tools

### 3. Domain Layer Validation (Phase 5)

**Description:** Verify domain modules provide correct mappings and validation.

#### Test 3.1: Health Metrics
- [ ] `detectHealthMetric("vekt")` returns 'weight'
- [ ] `detectHealthMetric("søvn")` returns 'sleepDuration'
- [ ] `isValidHealthMetric('weight')` returns true
- [ ] `isValidHealthMetric('invalid')` returns false
- [ ] `HEALTH_METRICS` has all expected metrics with units

#### Test 3.2: Economics Categories
- [ ] `detectSpendingCategory("dagligvare")` returns 'dagligvare'
- [ ] `detectSpendingCategory("pizza")` returns 'mat'
- [ ] `isValidSpendingCategory('bolig')` returns true
- [ ] `ALL_VALID_CATEGORIES.length` >= 14

#### Test 3.3: Query Parameter Building
- [ ] `buildHealthQueryParams('weight', 'latest')` returns correct params for query_sensor_data
- [ ] `buildEconomicsQueryParams('amount', 'current')` returns payPeriod='current'
- [ ] Parameters structure matches tool expectations

### 4. System Prompt Modularization (Phase 6)

**Description:** Verify prompt assembly is correct and complete.

#### Test 4.1: Base Prompt Presence
- [ ] `BASE_PROMPT` includes identity ("Resonans AI")
- [ ] `BASE_PROMPT` includes tone principles (kortfattet, uformell, etc.)
- [ ] `BASE_PROMPT` includes core tasks (5 tasks listed)

#### Test 4.2: Domain Prompt Inclusion
- [ ] `DOMAIN_PROMPTS.health` mentions query_sensor_data
- [ ] `DOMAIN_PROMPTS.economics` mentions query_economics
- [ ] `DOMAIN_PROMPTS.widgets` describes propose/create flow
- [ ] All domain prompts have practical examples

#### Test 4.3: Prompt Assembly
- [ ] Input: "Vis meg søvn" → prompt includes BASE + health domain
- [ ] Input: "Hva bruker jeg på mat?" → prompt includes BASE + economics domain
- [ ] Input: "General question" → prompt includes BASE only
- [ ] Verify no duplicate sections in assembled prompt

#### Test 4.4: Chat Endpoint Integration
- [ ] Verify `buildModularSystemPrompt(routingDecision)` accepts routing object
- [ ] Verify system message includes base + domain + skill hints
- [ ] Verify memory/goals/date context still appended correctly

### 5. Type Safety & Compilation (All Phases)

**Description:** Verify refactoring introduced no type regressions.

#### Test 5.1: Compilation
- [ ] Run `npm run check` → no new errors in refactored files
- [ ] Verify pre-existing errors remain unchanged (baseline)
- [ ] All `.ts` files in refactored paths compile without errors

#### Test 5.2: Import Chains
- [ ] `src/lib/skills/widget-creation/service.ts` imports resolve
- [ ] `src/lib/artifacts/widget-draft.ts` imports resolve
- [ ] `src/lib/domains/` imports resolve correctly
- [ ] `src/lib/server/prompts/` imports resolve correctly
- [ ] `src/lib/flows/widget-creation/flow.ts` imports resolve

#### Test 5.3: Function Signatures
- [ ] `createUserWidget(userId, input)` signature matches all call sites
- [ ] `buildModularSystemPrompt(routing)` accepts ChatRoutingDecision
- [ ] `routeChatRequest(input)` returns expected structure

### 6. Chat Endpoint Functionality (Integration Tests)

**Description:** End-to-end tests of chat flows using all refactored components.

#### Test 6.1: Simple Health Query
- [ ] Chat input: "Hvordan går det med søvnen?"
- [ ] Expected flow:
  1. Router detects 'health' domain
  2. System prompt includes health block
  3. Tool decision: call query_sensor_data
  4. Response includes sleep trend + context
- [ ] Verify no 404 errors, response completes

#### Test 6.2: Widget Creation → Update Sequence
- [ ] Chat input: "Lag widget for dagligvareforbruk"
- [ ] Expected flow:
  1. Router detects 'widgets' + 'economics' domains
  2. System prompt includes both domain blocks
  3. LLM calls `propose_widget`
  4. System returns draft + flow in metadata
- [ ] Follow-up: "Gjør det ukentlig isteden"
  1. Router detects 'widget_change' intent
  2. System calls `update_widget`
  3. Configuration persists

#### Test 6.3: Multi-Domain Conversation
- [ ] Chat input: "Jeg løp 3 km i dag og skal spare 500 kr denne måneden"
- [ ] Expected flow:
  1. Router detects ['health', 'economics', 'planning'] domains
  2. System prompt includes all 3 domain blocks
  3. LLM may call multiple tools (record_workout, income_summary, create_goal)
  4. All tool responses integrated correctly

#### Test 6.4: Error Handling
- [ ] Invalid widget params → tool returns error, LLM recovers with clarification
- [ ] Failed query_sensor_data → graceful fallback message
- [ ] Database error on widget create → user-friendly error message

### 7. Database Integrity (All Phases)

**Description:** Verify data consistency after refactoring.

#### Test 7.1: Widget Table
- [ ] All widget records have valid metricType
- [ ] Decimal values store correctly (no precision loss)
- [ ] Foreign key references to users valid
- [ ] Timestamps correct

#### Test 7.2: Message Metadata
- [ ] `widgetProposal` in metadata is valid WidgetDraft structure
- [ ] `widgetFlow` in metadata is valid WidgetCreationFlow structure
- [ ] Goal/theme metadata still stored correctly
- [ ] Query: `SELECT COUNT(*) FROM messages WHERE metadata IS NOT NULL` > 0

### 8. Backward Compatibility

**Description:** Verify no breaking changes to existing functionality.

#### Test 8.1: Existing Widgets Still Load
- [ ] Navigate to home screen → all previous widgets render correctly
- [ ] Widget data calculations unchanged
- [ ] Widget styling/layout unchanged

#### Test 8.2: Existing Chat History
- [ ] Old messages load without error  
- [ ] Old tool_calls still parse correctly
- [ ] Message metadata backward compatible

#### Test 8.3: User Preferences
- [ ] Theme selection respected
- [ ] Settings page loads
- [ ] User-specific data queries still work

---

## Deployment Checklist

### Pre-Merge
- [ ] All 8 test categories pass
- [ ] No new TypeScript errors
- [ ] All 6 commits are clean and atomic
- [ ] Branch is rebased on latest main
- [ ] Full smoke test on staging/preview URL (if available)

### Post-Merge
- [ ] Monitor production error logs for 24h
- [ ] Verify chat widget creation works for 3+ users
- [ ] Check database query performance (no slowdowns)
- [ ] Spot-check new domain/prompt logic is being used

---

## Commit Reference

| Commit | Phase | Description |
|--------|-------|-------------|
| `a5cceda` | 1 | Widget Skill Extraction |
| `ced7b96` | 2 | Prompt Focus Routing |
| `375dcd3` | - | Documentation Update |
| `7b72277` | 3-4 | Flow Layer + Chat Router |
| `ea8f411` | 5 | Domain Modules |
| `748f899` | 6 | Prompt Modularization |

---

## Notes

- **Phases 7-8 (Cleanup/Docs):** Deferred post-validation. Full architectural simplification achievable but requires additional refactoring not critical for MVP.
- **Token expense:** High throughput required for multi-phase implementation; recommend breaking into smaller sessions for team environments.
- **Architecture stability:** All layers now in place; future enhancements (domain-specific prompt blocks, skill constraints, flow orchestration) are non-breaking additions to existing structure.

---

## Sign-Off

Refactoring completed: **2. April 2026, ~09:30 UTC**  
Ready for review and testing.
