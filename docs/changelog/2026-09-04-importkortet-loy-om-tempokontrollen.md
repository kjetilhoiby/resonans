# Importkortet løy om tempo-kontrollen

Dato: 2026-09-04
Status: ferdig

## Kontekst

Første tørrkjøring mot det ekte arkivet (38 MB, 1120 aktiviteter) svarte:

```
1120 aktiviteter i manifestet, 1019 kan importeres
Tørrkjøring: 1013 skrevet · 0 fantes fra før · 6 uten spor · 0 holdt ute
```

**«0 holdt ute» var riktig og likevel misvisende.** Tempo-kontrollen var av, så
ingenting BLE sjekket — men tallet leses som «ingenting var galt». Og over det
sto feltene med `10000` og `3120` i, som ser utfylte ut.

## Faser

### Fase 1: Placeholderen som leste som en verdi

`placeholder="10000"` og `placeholder="3120"` — altså **nøyaktig de tallene
brukeren skal skrive**. Et tomt felt så dermed satt ut, og det orange varselet
under leste som en feil i appen framfor som en beskrivelse av tilstanden.

Nå: `placeholder="meter"` / `placeholder="sekunder"`. En placeholder skal si
hva feltet vil ha, ikke vise svaret.

### Fase 2: Tilstanden sies med TALLENE

Fravær av et varsel er ikke en bekreftelse. Er referansen satt, står den nå som
en setning — «Kontroll aktiv: 10 km på 52:00» — så det som gjelder kan leses
av, ikke utledes av at noe mangler. Er den halvveis utfylt, sier varselet at
begge felt må fylles.

`describePaceReference` bor i `import-triage.ts`, ikke i kortet: BEGGE ekkoene
skal si det samme, og to formateringer av samme par kunne vist ulike tall for
samme import. Timer tas med — en maratonreferanse ville ellers stått som
«210:00», som ikke leses som en tid.

### Fase 3: Utfallet melder seg selv

Resultatlinja bærer nå referansen **serveren** rapporterer at den brukte
(`paceReferenceUsed`), ikke den klienten mente å sende. Uten referanse står det
i klartekst at «0 holdt ute» betyr at ingenting ble sjekket.

### Fase 4: «skrevet» er en løgn i en tørrkjøring

`{written} skrevet` sto der også når `dryRun` var på. Nå: «ville blitt skrevet».

### Fase 5: De 6 uten spor navngis

«6 uten spor» kan ikke granskes; datoen og filnavnet kan. De 100 manuelle
øktene (`ingen-fil`) holdes UTE av lista — de er forventet og oppsummert over —
så lista inneholder bare de som HADDE en fil vi ikke fikk noe ut av. Det er
dessuten den ene kategorien der en parserfeil ville skjult seg: en fil vi ikke
klarer å lese ser identisk ut med en fil som ikke har noe å lese. Notisen sier
det.

## Beslutninger

- **Feltene prefylles IKKE.** 10000/3120 er brukerens egne tall, men de er
  brukerens — en default vi velger, presentert som hens måling, er samme feil
  som et hardkodet tempo i domenelaget. Kortet står tomt og sier hvorfor det
  betyr noe.
- **Ingen sperre på knappen uten referanse.** En import uten tempo-kontroll er
  et gyldig valg; det skal bare ikke være et valg man tar uten å vite det.
  Derfor sies konsekvensen tre steder — ved feltet, i knappen, og i resultatet.
- **Skille «0 vi har sjekket» fra «0 vi ikke sjekket».** Samme regel som
  `socialFilterable` i skjermtid og `curveSample.eligible` i pulstilliten. Det
  var nettopp dette skillet kortet manglet.

## Verifisering

- `npm test`: 4509 tester i 312 filer, alle grønne. 4 nye på
  `describePaceReference` (runde km, sekundpadding, meter, timer).
- `npm run check`: 0 feil, 0 advarsler.
- Ikke verifisert: kortet er ikke kjørt mot arkivet på nytt etter endringen.

## Kjent rest

- Referansen huskes ikke mellom kjøringer. Å lagre den serverside er en annen
  sak enn en default — den ville vært brukerens eget tall — men jobben er ikke
  gjort.
