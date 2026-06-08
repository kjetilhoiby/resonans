# Domain + Signal Contract v1

Status: Proposed
Date: 2026-04-14
Owner: Product + Engineering

## 1) Why this model

We need both:
- clear ownership and hygiene in core domains (Home vs Relationship)
- flexible user-composed themes/projects across domains

This document defines a two-layer architecture:
- Layer A: predefined core domains with explicit boundaries
- Layer B: user-composed themes that consume cross-domain signals

## 2) Core domains (predefined)

Initial predefined domains:
- health
- economics
- home
- relationship

Domain ownership rule:
- each domain owns its raw operational data and write workflows
- other domains consume derived signals only

Examples:
- grocery list item stays in home
- bank transaction stays in economics
- daily relationship check-in stays in relationship

## 3) Hygiene boundaries (home vs relationship)

Home domain scope:
- operational tasks
- shared responsibilities
- recurring household routines
- logistics and practical planning

Relationship domain scope:
- communication quality
- emotional connection
- conflict and repair patterns
- perceived fairness and support

Critical hygiene rule:
- home tasks are never moved into relationship as task objects
- relationship can consume home-derived fairness and load signals

## 4) Cross-domain contract principles

Contract principle A: derived, not raw
- only aggregated/derived signals cross domain boundaries
- no raw transaction rows or raw task item copies across domains

Contract principle B: explicit contract registry
- every signal type is declared with owner domain, consumer domains, and schema

Contract principle C: time-windowed semantics
- signals must include aggregation window (day, 7d, 14d, 30d)

Contract principle D: confidence and provenance
- each signal includes confidence and source metadata

Contract principle E: versioned contracts
- schemaVersion field allows safe evolution

## 5) v1 signal format

Recommended normalized signal envelope:
- signalType: stable name, for example home_task_load_imbalance_14d
- ownerDomain: health | economics | home | relationship
- userId: owner of the signal
- relatedUserId: optional partner/household member
- value: number | boolean | enum
- direction: up | down | neutral (optional)
- severity: info | low | medium | high
- confidence: 0.0 to 1.0
- windowStart: timestamp
- windowEnd: timestamp
- observedAt: timestamp
- context: json for compact explanatory fields
- schemaVersion: integer

## 6) v1 predefined cross-domain signals

Economics -> Home
1. economics_budget_pressure_7d
- Value: enum low/medium/high
- Meaning: short-term budget pressure for household planning

2. economics_variable_spend_spike_14d
- Value: percentage delta vs baseline
- Meaning: unusual variable-cost increase relevant for home prioritization

3. economics_fixed_cost_burden_30d
- Value: ratio fixed costs / income (or proxy)
- Meaning: stability pressure indicator

Home -> Relationship
4. home_task_load_imbalance_14d
- Value: normalized gap score between partners
- Meaning: perceived risk of unfair workload

5. home_planning_reliability_14d
- Value: completion reliability score
- Meaning: how predictable everyday execution feels

6. home_overdue_shared_tasks_7d
- Value: count of overdue shared tasks
- Meaning: practical stress that can affect communication

Relationship -> Home
7. relationship_coordination_readiness_today
- Value: enum low/medium/high
- Meaning: recommended complexity level for today's home planning

Economics + Home -> Relationship (composed upstream)
8. relationship_logistics_stress_index_14d
- Value: composite score
- Inputs: budget pressure + overdue shared tasks + load imbalance
- Meaning: practical stress risk impacting relationship quality

## 7) User-composed themes/projects

Goal:
- allow users to create new themes/projects from any signal combination
- keep domain hygiene intact

Theme capabilities in v1:
- choose any set of allowed signal types
- define simple thresholds per signal
- define desired cadence for summaries (daily/weekly)
- define preferred assistant tone per theme

Theme constraints in v1:
- read-only over cross-domain signals
- no write-through into foreign raw data stores
- actions must call owner-domain APIs for writes

Examples:
- Family Budget Reset (economics + home)
- Calm Mornings (home + relationship + health)
- Travel Prep (economics + home)

## 8) Data model approach for current codebase

Current fit:
- themes table already supports user-defined topic containers
- sensor_events already stores heterogeneous event-style data

Recommended v1 additions:
- domain_signals table (derived cross-domain outputs)
- signal_contracts table (registry of allowed signals)
- theme_signal_links table (which signals feed each theme)

Suggested minimal columns:

signal_contracts
- id
- signalType (unique)
- ownerDomain
- allowedConsumerDomains (json array)
- schemaVersion
- status (active/deprecated)

domain_signals
- id
- signalType
- ownerDomain
- userId
- relatedUserId (nullable)
- valueNumber (nullable)
- valueText (nullable)
- valueBool (nullable)
- severity
- confidence
- windowStart
- windowEnd
- observedAt
- context (json)
- schemaVersion
- createdAt

theme_signal_links
- id
- themeId
- signalType
- enabled
- config (json for thresholds/weights)
- createdAt

## 9) Contract matrix (v1)

Allowed by default:
- economics -> home
- economics -> relationship
- home -> relationship
- relationship -> home
- health -> relationship
- health -> home

Not allowed by default:
- raw object sharing across domain boundaries
- cross-domain writes except through owner-domain API

## 10) Execution plan (incremental)

Phase 1: contract registry + signal storage
- add signal_contracts and domain_signals
- seed the 8 v1 signal types

Phase 2: first producers
- produce home_task_load_imbalance_14d
- produce economics_budget_pressure_7d
- produce relationship_logistics_stress_index_14d

Phase 3: theme wiring
- add theme_signal_links
- add theme-level signal query endpoint
- render compact signal cards in theme views

Phase 4: assistant integration
- include selected theme signals in system/tool context
- add signal-aware coaching prompts

Phase 5: safety and explainability
- show why each signal fired (compact explanation)
- add confidence and last updated labels in UI

## 11) Success criteria

Functional:
- users can create themes using signals from multiple domains
- home and relationship raw data remain separated
- at least 3 cross-domain signals are produced daily

Product:
- users report better relevance in theme summaries
- fewer mixed-domain task mistakes (for example household chores in relationship module)

Engineering:
- signal contracts are versioned and testable
- no direct foreign-domain raw writes in service layer

## 12) Open decisions

- household identity model beyond pair (future multi-member homes)
- how to compute confidence consistently across producers
- whether relationship readiness should gate outbound nudges in home domain

