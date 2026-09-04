# Referanseinfo hører over slidere

Dato: 2026-09-04
Status: ferdig

## Kontekst

> «I bøker og i "når setter vi null-punktet for indeksert sammenlikning av vekt
> over år" plasserer du info nedenfor slideren. Det blir ikke lesbart når jeg
> bruker tommelen på slideren. Hold viktig referanseinfo over slidere.»

**Hånda dekker alt under en slider mens man drar.** Regelen er dermed enkel, og
den gjaldt fire steder i appen — hvert av dem på sin egen måte.

## Faser

### Fase 1: Fire flater rettet

| Flate | Hva som lå under | Hvorfor det bet |
|-------|------------------|-----------------|
| `StravaImportCard` | båndets ender og steglengden | man drar for å treffe en tid og ser ikke hva båndet går fra og til |
| `BookHeaderBar` | «2t 34min av 8t 12m» | tallene man setter var under tommelen |
| `FlowFormStep` | `helperLabels` («elendig» … «frisk») | ordet som gir tallet mening, i sykeinnsjekken |
| `WeightYearsCard` | hele `CycleChart` | man drar i nullpunktet nettopp for å se kurvene flytte seg |

De to siste er de lærerike:

- **I flyten er hjelpeteksten hele poenget med slideren.** En 1–5-skala uten ord
  er ikke kalibrert — «3» betyr ingenting, «litt bedre» betyr noe. Lå ordet
  under, var det borte i det øyeblikket det endret seg.
- **I vektkortet er grafen ikke pynt under kontrollen, den ER svaret.** Slideren
  står derfor nå UNDER `CycleChart`, med sin egen verdi («1. oktober») rett over
  seg. Rekkefølgen er filtre → overskrift → graf → nullpunkt → notis.

`FlowFormStep` sin fokus-variant og `LivskompassCheckin` gjorde det riktig fra
starten, og står nå som mønsteret i `docs/DESIGN.md`.

### Fase 2: Prinsippet skrevet ned

Nytt avsnitt i `docs/DESIGN.md` («Slidere — referanseinfo hører OVER»), med
tabellen over de fire bruddene. Regelen er ikke smak: den følger av hvor hånda
er.

### Fase 3: Distanse-labelen målt

Spørsmålet var om labelen var mørk på mørk. **Målt, ikke bedømt:**
`rgb(170,170,170)` på `rgb(20,20,20)` er **7,93:1** — godt over kravet på 4,5:1
for normal tekst.

Den var likevel kortets **minste** tekst (0,78rem / 12,5px), rett over
kontrollen man må røre først, altså lest som mindre viktig enn den er. Satt til
`/settings/sources` sin egen konvensjon for en feltlabel (`0,82rem`), som er
det `.field label` bruker der.

## Beslutninger

- **Verdien hører rett over slideren**, ikke i en overskrift langt oppe: det er
  den som endrer seg per piksel, og den skal være lesbar med tommelen på.
- **Under slideren hører bare det man leser ETTERPÅ** — en forklarende notis, en
  bekreftelse, en knapp. Den grønne «Kontroll aktiv»-linja i importkortet står
  derfor fortsatt under: tallene den gjentar finnes i den store avlesningen
  over, og linja er en bekreftelse man leser når man er ferdig med å dra.
- **Labelen ble ikke satt til `--text-primary`.** En feltlabel SKAL være
  sekundær til innholdet den beskriver; problemet var størrelsen, ikke fargen.
  Å bryte husstilen for én label ville gjort den til unntaket.

## Verifisering

- `npm test`: 4515 tester i 312 filer, alle grønne (ingen av endringene rører
  forretningslogikk).
- `npm run check`: 0 feil, 0 advarsler.
- **Rendret i nettleser** (midlertidig rute under `/design`, Playwright mot
  `/opt/pw-browsers/chromium`, med `/settings/sources` sine variabler speilet):
  rekkefølgen i `.pr-time` er nå `pr-readout → pr-ends → input[type=range]`,
  målt på DOM-en. Kontrastene målt: label 7,93:1, tid 15,88:1, tempo 7,93:1.
  Ruta er slettet igjen.
- **Piksel-diffen er IKKE kjørt** — den krever database, som ikke finnes i dette
  miljøet. Ved gjennomgang av `tests/visual/pages.spec.ts` besøker den
  helse-mortemaet, ferie, bøker, økonomi og `/design`-seksjonene; ingen av de
  fire endrede komponentene ligger på en dekket flate (Vekt-undertemaet er ikke
  i lista, og bokas fremdriftseditor ligger bak en interaksjon). Endringen bør
  derfor ikke invalidere noen baseline — men det er en slutning fra lesing, ikke
  en kjøring.

## Kjent rest

- `AudioKaraokePlayer`, `WalkPlayback3D` og `VideoFramePicker` har også slidere.
  De er ikke gjennomgått: de to første er avspillingskontroller der posisjonen
  vises i selve mediet, og den tredje er en bildevelger. Sjekk dem mot regelen
  hvis noen rører dem.
- Filvelgeren i importkortet er fortsatt nettleserens standard («Choose File»).
