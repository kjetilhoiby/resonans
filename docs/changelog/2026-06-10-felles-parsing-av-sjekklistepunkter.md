# Felles parsing av sjekklistepunkter

Dato: 2026-06-10
Status: ferdig

## Kontekst

En morgenchat ble gjort om til dagsoppgaver via `plan_day`-verktøyet. Oppgavene
havnet på riktig dag, men ble lagret som rå tekst («Fikse matpakker kl. 18»):
klokkeslett, personer og aktivitet ble ikke trukket ut i egne felt. Det fantes
allerede rik parsing i `POST /api/checklists/[id]/items` (tid, sted, reise,
måltid, aktivitet, kobling til ukeoppgaver + @-omtaler), men AI-verktøyene
(`plan_day`, `create_checklist`, `add_checklist_items`) og dagsplan-endepunktet
lagret tekst uten å bruke den.

I tillegg re-parsa redigerings-endepunktet (`PATCH …/[itemId]`) bare en delmengde,
og brukte `parseTaskDateTime` som ikke håndterer punktum-separert tid («kl. 18.00»
matchet bare «kl. 18» og etterlot «.00» i teksten). Derfor ble heller ikke
redigering i daglista/på hjemskjermen riktig.

Bruker ønsket to ting:
1. Parse oppgavene som en del av verktøyet som legger dem i daglista (tid,
   personer osv. blir riktig).
2. Parse oppgaver på nytt ved redigering i daglista eller på hjemskjermen.

## Faser

### Fase 1: Felles builder
Ny modul `src/lib/server/checklist-item-builder.ts` med
`buildChecklistItemFields({ userId, context, text, coords?, allowTaskCreation? })`.
Den speiler den rike enkeltpunkt-logikken fra POST-endepunktet og returnerer
`{ text, startDate, metadata, locationDayIso }`. Bruker den punktum-bevisste
`parseChecklistItemIntent` + `stripTimeFromText` fra `checklist-intent-linker`.
Eksporterer også `extractWeekKeys` og `PARSE_DERIVED_METADATA_KEYS`.

`allowTaskCreation` styrer om et ukenivå-punkt uten match skal opprette en ny
ukeoppgave (true ved manuell oppretting, false ved redigering og AI-verktøy —
de kobler bare til eksisterende oppgaver).

### Fase 2: Alle inngangsruter bruker builderen
- `POST /api/checklists/[id]/items`: enkeltpunkt på toppnivå går via builderen
  (gjentaksmønstre og deloppgaver beholder enklere parsing).
- `PATCH …/[itemId]`: toppnivå-punkt re-parses fullt ut via builderen ved
  tekstendring; parse-avledede metadata-nøkler nullstilles og bygges på nytt,
  mens øvrige (f.eks. `progressRecordId`) beholdes. Deloppgaver beholder
  dato/tid-parsing. Fikser «kl. 18.00»-bugen.
- `POST /api/day-plan`: parser hvert dag-punkt + indekserer @-omtaler.
- AI-verktøy `plan_day`, `create_checklist`, `add_checklist_items`: parser hvert
  punkt og indekserer @-omtaler (gjorde ingen av delene før).

### Fase 3: Verktøy-hint
`plan_day`-beskrivelsen ber nå modellen skrive klokkeslett inline («kl. 18»,
«kl. 18:45») og nevne personer med @navn, slik at parseren får noe å trekke ut.

## Beslutninger

- **Konsolidering framfor duplisering** (CLAUDE.md-prinsipp 2): én parser brukt
  alle steder, slik at oppretting og redigering gir identisk resultat.
- **Ingen oppgaveoppretting ved redigering/AI**: kun manuell POST oppretter nye
  ukeoppgaver. Redigering og AI kobler kun til eksisterende, for å unngå at hver
  tekstendring eller chat spammer nye ukeoppgaver.
- **Daglista og hjemskjermen deler `ChecklistSheet.commitEdit()` → PATCH**, så
  ett PATCH-fiks dekker begge redigerings-flatene.

## Verifisering

- `npm run check`: 0 feil/advarsler.
- `npm test`: 397 tester grønne (7 nye i `checklist-item-builder.test.ts` for de
  DB-frie greinene: generell liste, sted, reise i punktum-format, wake-time).
