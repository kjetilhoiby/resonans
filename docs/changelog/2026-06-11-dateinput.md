# DateInput: delt datofelt for hele appen

Dato: 2026-06-11
Status: ferdig

## Kontekst

Brukerobservasjon: datovelgeren var «feil stilet overalt, ikke mulig å se hvor man skal trykke». Revisjon bekreftet: **47 rå `<input type="date">` i 21 filer**, ingen delt komponent, hver med egen lokal klasse (`tb-input`, `trip-input`, nakne inputs …). Rotårsaken til usynlig-trykkflate: ingen `color-scheme: dark` — den native kalender-indikatoren rendres svart på mørk bakgrunn.

## Gjennomført

- **Ny `ui/DateInput.svelte`**: tynn wrapper over global `.ds-input` (samme mønster som TimeInput) med `color-scheme: dark` (mørk native kalender-popup + synlig ikon) og breddebegrensning. Props: value ($bindable), min/max, disabled, required, className, ariaLabel, onChange med korrekt currentTarget-typing.
- **TimeInput** fikk samme `color-scheme: dark`-fiks (samme usynlig-ikon-bugg).
- **Migrert alle 44 forekomster** (21 filer: trip/ferie/theme/economics/settings/flows/ukeplan/skjermtid/plan-ruter m.fl.). Lokale utseende-klasser droppet; DateInput er kanonisk.
- Demo på `/design` under Skjema (vanlig, min/maks, disabled + TimeInput).

## Beslutninger / tilpasninger i migreringen

- **ukeplan week-picker**: datofeltet er bevisst visuelt skjult (fungerer som `showPicker()`-anker bak kalenderknappen). Skjule-regelen flyttet til `:global(input.wp-week-picker-input)` og `bind:this` erstattet med querySelector på wrapper — verifisert i screenshot at feltet fortsatt er skjult.
- **data-track på datofelt** (tema-oppgaver, skjermtid): flyttet til `ariaLabel`, som er neste prioritet i usage-loggerens `deriveLabel()` — brukslogg-labels uendret. Får DateInput dynamiske track-behov senere, legg til en `dataTrack`-prop.
- **TaskContextMenu**: stopPropagation-handlere lå på selve input-elementet; nå på en wrapper-div rundt DateInput.

## Verifisering

- svelte-check 0 feil, 422 enhetstester grønne.
- LLM-review 13/13: settings-sources (Withings-backfill-felt) og øvrige berørte sider godkjent som intendert restyling; ukeplan manuelt verifisert (week-picker fortsatt skjult; diffen var dagsdrift).
- `grep type="date"` matcher nå kun DateInput.svelte.
