# Planlegg ukeplan-oppgave ned på en dag

Dato: 2026-07-06
Status: ferdig

## Kontekst

Fra ukeplan ville vi kunne skyve en oppgave ned på en bestemt dag: skrive
«løp tre ganger», velge en dag (f.eks. torsdag), tappe en avkryssingsboks og få
«Løp» lagt til torsdags dagsliste. Oppgaven på ukeplan skal så resolves når
dagslistetasken krysses av — begge blir avhukede i samme håndbevegelse.

Halve mekanikken fantes fra før: et dag-punkt med `metadata.linkedTaskId` logger
fremdrift på den koblede tema/mål-oppgaven når det krysses av (og reverserer ved
av-kryssing). Det som manglet var (1) å *planlegge* fra ukeplan ned på valgt dag,
og (2) en tilsvarende kobling for ukeliste-punkter (ikke bare tema/mål-oppgaver).

## Faser

### Fase 1: Kobling og delt logikk
- `checklist_items.metadata` fikk `linkedChecklistItemId` (schema.ts + ukeplan/types.ts
  + lib/types/checklist.ts). Ingen DB-migrasjon: metadata er fleksibel `jsonb`,
  ingen ny kolonne.
- Ny `week-schedule-logic.ts` med rene, testbare helpers: `scheduleLabel`
  (rensker «Løp (1/3)» / «Løp tre ganger» → «Løp»), `buildScheduleLink`
  (bygger link-payload fra tema/mål-oppgave eller ukeliste-punkt) og
  `isAlreadyScheduled` (dedup mot allerede planlagte dag-punkter). 12 nye tester.

### Fase 2: Server
- `POST /api/checklists/[id]/items` godtar nå en eksplisitt `link`
  (`taskId`/`taskTitle`/`checklistItemId` + aktivitet). Når den er satt, hoppes
  tekst-basert oppgavekobling over og metadata settes direkte.
- `PATCH …/[itemId]`: å (av)krysse et dag-punkt med `linkedChecklistItemId`
  speiler avkryssingen til det koblede ukeliste-punktet, og holder sjekklisten
  det ligger i i synk (`completedAt`). Parallelt til den eksisterende
  `linkedTaskId → progress`-logikken.

### Fase 3: Klient (ukeplan)
- Tema/mål-slots (`wp-slot`) er nå knapper: tom slot viser «+» og planlegger
  oppgaven på valgt dag ved tapp.
- Ukeliste-rader: tapp på en ikke-avkrysset boks planlegger punktet på valgt dag
  (i stedet for å hake av direkte). En allerede avkrysset boks lar seg fortsatt
  hake av (angre-utvei).
- `scheduleWeekElementOnDay` sikrer dagsliste, deduper og oppretter det koblede
  dag-punktet. `weekTasksState` gjør slot-fyll optimistisk; propagering ved
  dag-toggle speiler tilbake til slot/ukeliste-punkt uten full reload.

## Beslutninger
- **Ingen egen «planlagt»-status på uke-elementet** (brukervalg): uke-elementet
  blir bare ferdig når dag-punktet krysses av. Reversering skjer ved å slette
  dag-punktet på dagslista.
- **Dedup uten angre-ved-tapp**: gjentatt tapp på samme kilde samme dag er en
  no-op (ingen duplikat), men fjerner ikke planleggingen.
- **Begge flater** støttes (ukeliste-rader og tema/mål-slots), per brukervalg.

### Fase 4: Nedbrytning på dagsnivå → auto-hak på ukesnivå
Et planlagt dag-punkt kan brytes ned til en underoppgaveliste (eksisterende
breakdown, barn under dag-punktet), og uke-elementet auto-hakes når hele lista er
krysset ut.
- Ny generell regel i `PATCH …/[itemId]`: når et barn (av)krysses, auto-hakes
  forelderen når alle barn er behandlet (avkrysset/hoppet), og åpnes igjen hvis
  ett barn åpnes. Forelderens egne koblinger kjøres via en felles hjelpefunksjon
  (`applyItemCheckedSideEffects`), så avkryssingen kaskaderer opp til ukeplan
  (`linkedChecklistItemId` → ukeliste-punkt, `linkedTaskId` → fremdrift/slot).
- Ren, testbar `shouldParentBeChecked(children)` (skippede barn teller som
  behandlet). Klienten (`cascadeParentAfterChildToggle`) speiler kaskaden
  optimistisk.
- Beslutning: forelder-auto-hak er en **generell** regel (gjelder alle
  nedbrutte punkter, ikke bare ukeplan-koblede) — nedbrutte forelder-punkter
  fullføres nå automatisk, noe de ikke gjorde før. Reversering er streng:
  åpnes et barn, åpnes forelderen (og uke-elementet) igjen.

## Kjent begrensning
- Sensor-basert auto-hak av et planlagt dag-punkt (`autocheckChecklistItemsForDay`)
  propagerer ikke `linkedChecklistItemId` direkte. For aktivitets-punkter fanges
  dette likevel opp av den eksisterende uke-autohaken (`autocheckWeekChecklistItems`),
  som teller økter/dag-bevis mot uke-slots.
- Forelder-auto-hak kaskaderer ett nivå (barn → direkte forelder). Dypere
  nesting (barnebarn) re-evaluerer ikke besteforelderen automatisk; breakdown er
  i praksis ett nivå.

## Verifisering
- `npm run check`: 0 feil / 0 advarsler.
- `npm test`: 1170 tester passerer (inkl. 16 nye i `week-schedule-logic.test.ts`).
- `npm run build`: fullfører (med dummy-env for analyse-steget).
