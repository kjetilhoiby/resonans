# Ukeoppgaver uten eksplisitt frekvens skal ikke trenge avklaring

Dato: 2026-07-05
Status: ferdig

## Kontekst

Oppgaver lagt til i ukeplanen («Vaske bil», «Maks én time mobil mellom») ble
markert med rød «Trenger avklaring»-badge og feilmeldingen «Fant ikke frekvens –
legg til f.eks. "5 ganger per uke"». Årsak: ukenivå-punkter oppretter en oppgave
med `frequency='weekly'` allerede ved opprettelse (`checklist-item-builder.ts`),
men enqueue-er samtidig en `task_intent_parse`-jobb på råteksten. Når teksten
ikke inneholder noen eksplisitt frekvens feiler både regel-parseren og
LLM-fallbacken med `no_quantifiable_target`, og oppgaven merkes `failed` — selv
om «én gang denne uka» er den åpenbare tolkningen.

## Faser

### Fase 1: Standard-intent fra oppgavens egne felter
- `src/lib/server/task-intent-parser.ts`: ny eksportert `buildDefaultIntentFromTask`
  som bygger en intent fra oppgavens egen frekvens (targetValue → 1 hvis mangler,
  unit → 'ganger' hvis mangler). Brukes i `processTaskIntentParseJob` når begge
  parserne feiler (unntatt `empty_text`) og oppgaven allerede har frekvens.
  Merkes med `intentParser: 'default'`.
- Oppgaver *uten* frekvens fra opprettelsen (f.eks. chat-opprettede uten
  strukturfelter) beholder «Trenger avklaring»-flyten — der er avklaring reell.

### Fase 2: UI
- `week-tasks-logic.ts`: `getTaskIntentBadge` viser ikke «Aktiv sporing» for
  standard-tolkede oppgaver (`intentParser === 'default'`) — en vanlig
  ukeoppgave skal ikke bære badge. `formatStructuredTaskMeta` bruker entall
  («1 gang denne uka») ved målverdi 1.

### Fase 3: Reparasjon av eksisterende rader
- Data-migrering i `scripts/sync-db-schema.mjs` (DATA_MIGRATIONS): oppgaver med
  frekvens og `intentStatus='failed'` settes til `parsed`/`default` med
  `target_value`/`unit` defaultet. Idempotent.

## Beslutninger

- Standard-intenten bygges fra oppgavens felter, ikke fra en ny LLM-runde —
  frekvensen ble eksplisitt satt ved opprettelse og er autoritativ.
- Badge undertrykkes for `default`-tolkninger i stedet for å vise «Aktiv
  sporing», så grønne badges forbeholdes tolkninger som faktisk kom fra teksten.

## Verifisering

- Nye enhetstester for `buildDefaultIntentFromTask`, entall-formatering og
  badge-undertrykking. `npm test` (1021 tester) og `npm run check` grønne.
