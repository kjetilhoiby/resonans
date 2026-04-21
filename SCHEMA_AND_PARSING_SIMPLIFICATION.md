# Schema- og parsing-forenkling

> Referansedokument for fremtidig arbeid. Skrives nå (april 2026) mens konteksten er fersk, utføres når produktet er mer modent.

---

## Bakgrunn

Tidlig i utviklingen var målet få og generelle tabeller. Etter hvert som konkrete behov oppsto ble det lagt til mange spesialiserte tabeller og parsere. Det er riktig prioritering i tidlig fase — bedre å løse reelle behov raskt enn å overdesigne. Men det er verdt å ta en gjennomgang når produktet stabiliserer seg.

---

## Del 1 — Schema-forenkling

### Nåværende tilstand (42 tabeller)

Tabellene faller grovt i disse kategoriene:

**Kjerne-domene** (stabile, sannsynligvis riktig adskilt):
`users`, `auth_accounts`, `allowed_emails`, `marriage_invites`, `themes`, `goals`, `tasks`, `progress`, `conversations`, `messages`, `memories`, `checklists`, `checklist_items`

**Aktivitet og helse** (overlapper konseptuelt):
`activities`, `activity_metrics`, `sensors`, `sensor_events`, `sensor_aggregates`, `sensor_goals`, `categorized_events`, `tracking_series`, `tracking_series_examples`, `record_type_definitions`

Mulig forenkling: `activities`/`activity_metrics` og `sensor_events`/`categorized_events` løser lignende problemer (en hendelse med verdi, en kilde, en tid). Kan vurderes slått sammen til et generelt hendelsessystem med `source` og `type`-felt.

**Klassifisering og regler** (tre ulike mekanismer for samme problem):
`task_classification_rules` — keyword-arrays for å matche aktivitet mot oppgave
`transaction_matching_rules` — keyword-arrays for transaksjonskategorisering
`merchant_mappings` — LLM-genererte navn→kategori-oppslag
`classification_overrides` — brukerstyrte overskrivinger per fingerprint

Disse representerer tre generasjoner av samme idé — se Del 2.

**Tema-organisering** (vokst organisk):
`theme_lists`, `theme_list_items`, `theme_files`, `theme_signal_links`, `signal_contracts`, `domain_signals`

Signalkontraktsystemet er et generelt publiser/abonnér-system for domenehendelser. Kan vurderes erstattet av en enklere, generell `events`-tabell om det ikke vokser videre.

**Støtte og infrastruktur** (sannsynligvis greie som de er):
`user_widgets`, `web_push_subscriptions`, `reminders`, `nudge_events`, `background_jobs`, `categories`

**Bok-domenet**:
`books`, `book_clips`, `book_progress_log` — lite brukt, men konseptuelt ryddig.

### Hva som kan generaliseres

Høyest potensiale for forenkling:

1. **Sensor + aktivitet + tracking** — tre parallelle systemer for «brukerdata over tid». Et felles hendelsesformat med `domain` (health, fitness, reading), `metricType`, `value`, `source` og `timestamp` ville redusert skjemakompleksiteten betydelig og gjort querying enklere.

2. **Klassifiseringsregler** — se Del 2.

3. **Theme-hierarki** — `theme_lists` / `theme_list_items` dupliserer funksjonalitet som ligner `checklists` / `checklist_items`. Mulig å slå sammen til én generisk liste-primitiv med `parentType` og `parentId`.

---

## Del 2 — Parsing og selvforbedring

### Nåværende tilstand

Det finnes fire distincte parsing-mekanismer, utviklet uavhengig av hverandre:

| Parser | Strategi | LLM-fallback | Selvforbedring |
|---|---|---|---|
| `task-intent-parser.ts` | Hardkodet regex-tabell | Ja | Nei |
| `goal-intent-parser.ts` | Hardkodet regex-tabell | Ja | Nei |
| `list-repeat-parser.ts` | Hardkodet regex-tabell | **Nei** | Nei |
| `transaction-categories.ts` | DB keyword-loop + LLM merchant-mapping | Delvis (merchant) | Delvis (merchant_mappings) |

Transaksjons-pipelinen er den mest modne: den har brukeroverrides, LLM-genererte merchant-mappings cachet i DB, og keyword-regler som kan endre seg uten deploy. De andre parserene er hardkodet og krever deploy for enhver ny formulering.

### Svakhetene i dag

- `list-repeat-parser.ts` feiler stille — ingen LLM-fallback, ingen logging av hva som ikke matchet
- Patterns er TypeScript-konstanter spredt i fire filer uten felles konvensjon
- Ingen metrikker: vi vet ikke hvilke formuleringer som faktisk feiler i produksjon
- Regex-patterns er vanskelig å migrere om output-formatet endres

### Hvorfor ikke fikse dette nå

Produktet er for ungt. Output-formatet for parserne (hva en «parse» returnerer) er sannsynligvis ikke stabilt ennå. Å lagre patterns i DB nå betyr å designe et skjema basert på antatt fremtidig behov — det gir sannsynligvis dårlige avveininger og vanskelige migrasjoner.

### Første steg: mislogging (kan gjøres nå)

Minimalt tiltak med høy verdi: logg parser-misses til en enkel tabell.

```sql
CREATE TABLE parser_misses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parser      text NOT NULL,   -- 'list-repeat', 'task-intent', osv.
  input       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

Ingen output, ingen pattern-generering — bare rådata. Etter 2-3 måneder i produksjon ser du hvilke faktiske formuleringer som feiler, og kan ta et informert valg om skjema og strategi.

Legg samtidig til LLM-fallback i `list-repeat-parser.ts` (den eneste parseren som mangler det), symmetrisk med `task-intent-parser.ts`.

### Målarkitektur (når vi vet nok)

Basert på erfaringen fra `transaction_matching_rules` og mislogging-dataene:

```
input → loop gjennom DB-patterns (regex, prioritert) → HIT → result + inkrementer hit_count
                                                      → MISS → LLM (structured output) → result
                                                                                        → logg pattern-kandidat for review
```

En felles `parser_patterns`-tabell med felt som:
- `parser` — hvilken parser
- `pattern` — regex-streng
- `output` — JSON-template (capture groups som variabler)
- `source` — `'manual'` | `'llm_suggested'` | `'llm_approved'`
- `hit_count`, `active`, `created_at`

LLM-foreslåtte patterns (`source: 'llm_suggested'`) er ikke aktive før manuell godkjenning eller automatisk validering. Dette forhindrer at feil patterns spres.

### Hva som ikke bør endres

Noen regex-bruk er riktig som de er og bør ikke konverteres:

- `openai.ts` modul-deteksjon — kjøres på hvert chat-kall, for hot path for LLM
- `theme-instructions.ts` langsiktig-deteksjon — én boolesk sjekk, LLM-overhead uforholdsmessig
- `query-economics.ts` dagligvare-heuristikk — hjelpeflagg, ikke klassifisering
- `chat-router.ts` — allerede AI-primær, regex er riktig som safety net

---

## Når bør dette arbeidet starte?

Forutsetninger som bør være på plass:

- [ ] Flere aktive brukere (nok data i parser_misses til å ta beslutninger)
- [ ] Output-formatene fra parserne har ikke endret seg på 2+ måneder (stabilitet)
- [ ] `list-repeat-parser.ts` har fått LLM-fallback og mislogging
- [ ] En gjennomgang av hvilke tabeller som faktisk brukes aktivt i kode (noen kan allerede være døde)

Rekkefølge ved oppstart:
1. Schema-audit: finn tabeller med null eller svært lite bruk i kildekoden
2. Slå sammen sensor+aktivitet+tracking hvis mønsteret er klart
3. Skill `task_classification_rules` og `transaction_matching_rules` ut i én generell `parser_patterns`-tabell
4. Migrér hardkodet regex fra `task-intent-parser.ts`, `goal-intent-parser.ts`, `list-repeat-parser.ts` til `parser_patterns`
5. Implementér LLM-forslag til nye patterns med manuell godkjenningsflyt
