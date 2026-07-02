# Månedsplan: duplikater i gjøremål

Dato: 2026-07-02
Status: ferdig

## Kontekst

Månedsplanleggingen produserte rotete gjøremålslister. Et konkret tilfelle (Juli 2026)
viste 52 gjøremål der samme oppgave (f.eks. «Yoga», «En runde i flere rom», «Mobilfri i
familietid/helg») dukket opp om og om igjen som flate rader, sammen med foreldre-punkter
med tekst som «… (20 ganger)».

To underliggende feil:

1. **`parentId` ble droppet ved lasting av månedslista.** `MonthChecklist.svelte` grupperer
   en gjentakende oppgave til *én* rad med kompakte avkryssings-slots basert på
   `parentId`. Men `load` i `maanedsplan/+page.server.ts` mappet kun `id/text/checked`, så
   `parentId` nådde aldri klienten. Dermed ble hvert barn-punkt en egen flat rad: ett
   «Yoga (20 ganger)»-foreldre + 20 «Yoga»-barn ble til 21 rader. (`ukeplan` sprer
   `...item` og beholder `parentId` — månedssiden hadde bare glemt det.)

2. **Ingen tak på antallet.** AI-en får beskjed om at MÅNEDSOPPGAVER gjøres «1–8 ganger»,
   men når den foreslo `20`, opprettet `/api/month-plan/complete` et foreldre-punkt *pluss
   20 barn*. Resten av koden klamper gjentakelser til 12 (`list-repeat-parser`, `ukeplan`).

## Faser

### Fase 1: Ekspander oppgaver via ny, testbar modul
- Ny `src/lib/server/month-plan-tasks.ts` med `planMonthTask()`. Ren funksjon som regner
  ut foreldre-label, antall og barn-tekst.
- `src/routes/api/month-plan/complete/+server.ts` bruker `planMonthTask` i stedet for
  inline-ekspandering.
- Antallet bevares som foreslått (20 forblir 20) og klampes bare mot et høyt
  sikkerhetstak `MAX_MONTH_TASK_SLOTS = 31` (maks dager i en måned) for å unngå absurde
  verdier som lager hundrevis av rader. Telleren (Fase 4) gjør at store antall vises pent
  uansett, så vi trenger ikke skjule brukerens tall.
- Enhetstester i `src/lib/server/month-plan-tasks.test.ts`.

### Fase 2: Ta med `parentId` ved lasting
- `maanedsplan/+page.server.ts`: legg `parentId` i item-mappingen.
- `maanedsplan/+page.svelte`: ta med `parentId` i den optimistiske mappingen ved
  `handleAddItem` slik at nye punkter grupperes uten reload.

### Fase 3: Stramm inn prompten
- `maalPrompt` i `maanedsplan/+page.svelte` presiserer at antall for MÅNEDSOPPGAVER skal
  være 1–8, og at ting som gjentas oftere hører hjemme som MÅNEDSMÅL.

### Fase 4: Teller for mange repetisjoner
- `MonthChecklist.svelte`: en gruppe med flere enn `COUNTER_THRESHOLD` (6) barn vises nå
  som en kompakt teller (`X / N` med −/+) i stedet for en rad med sirkel-slots som wrapper
  og presser tittelen. Slots beholdes for små, taktile antall (1–6).
- Telleren driver de samme barn-punktene via `ontoggle`: «+» haker av neste åpne barn,
  «−» fjerner haken på det siste avkryssede. Ingen skjema- eller API-endring — samme
  parentId/barn-modell, bare et annet visningsvalg. Gjenbruker teller-mønsteret fra
  månedsmål (prinsipp 2).

## Beslutninger

- **Ikke klamp fornuftige antall (20→12):** Første forsøk klampet til 12, men det skjuler
  brukerens/AI-ens tall. Siden telleren rendrer et hvilket som helst antall pent, bevarer
  vi det foreslåtte antallet og klamper bare mot et høyt sikkerhetstak (31). Prompten
  dytter fortsatt mot 1–8.
- **Ikke automatisk konvertering oppgave → mål:** Høyfrekvente ting *bør* være MÅNEDSMÅL,
  men å konvertere automatisk ved lagring er mer inngripende og overraskende. Vi nøyer oss
  med promptveiledning + tak.

## Verifisering

- `npm test`: 920 tester grønne (inkl. 6 nye).
- `npm run check`: 0 feil, 0 advarsler.
