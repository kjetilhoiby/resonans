# Bevegelsestid: tetthetsporten som manglet

Dato: 2026-08-10
Status: ferdig (backfill står fortsatt ubrukt)

## Kontekst

Første måling mot prod, med `dryRun`, ga dette:

| Dato | Sport | Opptak | I bevegelse |
|---|---|---|---|
| 24. mars | running | 56 min | 8 min |
| 11. apr | running | 1 t 3 min | 12 min |
| 4. apr | running | 25 min | 8 min |
| 6. apr | running | 24 min | 8 min |
| 8. apr | running | 23 min | 9 min |
| 8. juli | hill | 21 min | 8 min |
| 23. juli | walking | 3 t 18 min | 1 t 39 min |
| 5. juli | running | 1 t 4 min | 41 min |

En 56-minutters løpetur har ikke åtte minutter bevegelse. Og tallene avslører seg selv:
**hver eneste verdi er et helt antall minutter** — 8, 12, 8, 8, 9, 41, 99.

Det er `MAX_CREDITED_INTERVAL_SECONDS` (60) som slår inn på *hvert* intervall. Sporene har
punkter et minutt eller mer fra hverandre, så bevegelsestiden ble «antall krediterte
intervaller × ett minutt» — et tall om sporets oppløsning, ikke om økta.

`MIN_COVERAGE` på 0,5 var ikke nok til å stoppe det: et spor med to minutter mellom
punktene får dekning rundt 0,5 og slapp så vidt gjennom.

Feilen er verre enn et galt tall. Modulen er bygget rundt regelen «null framfor et gjettet
tall», og her ga den et **selvsikkert** svar på et spørsmål sporet ikke kunne besvare.

## Faser

### Fase 1: Tetthetsport

`MAX_MEDIAN_SAMPLE_SECONDS` (15 s). Er medianavstanden mellom sporpunkter større, kan en
pause ikke skilles fra et hull uansett hvor god resten av modellen er — og da er «vet ikke»
det eneste ærlige svaret.

Porten står **før** alt annet som regner, og en test binder den til å ligge under kappet
(`MAX_CREDITED_INTERVAL_SECONDS`), så feilen ikke kan komme tilbake stille.

`MIN_COVERAGE` er hevet fra 0,5 til 0,7 av samme grunn.

### Fase 2: Grunnen rapporteres

`analyzeMovingTime` returnerer `{ result, rejection, medianSampleSeconds, pointCount }`.
`computeMovingTime` er nå et tynt kall over den.

En stille null ser ut som «ingen data», og da leter man etter feil i innhentingen framfor i
sporets oppløsning. Backfillen teller per grunn (`rejections`), og kortet viser dem i
klartekst med punktavstanden per økt. «89 ga ikke noe svar» ser ut som ett problem; det er
fire, og bare ett av dem er verdt å gjøre noe med.

### Fase 3: Fjellturen

Terskelen for `walking` og `hiking` er senket fra 0,4 til **0,25 m/s**.

Turen 23. juli — 3 t 18 min opptak, kuttet til 1 t 39 — er en fjelltur med tidvis svært lav
fart. 0,3 m/s opp en ur er ekte gange, ikke en pause. Å kutte den fjerner noe brukeren
faktisk har gjort, og det er den dyre retningen å ta feil i: å slutte å kutte for mye er
trygt, å fjerne opptjent framgang er det ikke. Samme resonnement som «vi haker aldri AV
automatisk».

## Beslutninger

**Tetthetsporten framfor å heve kappet.** Et høyere `MAX_CREDITED_INTERVAL_SECONDS` ville
gitt større tall på tynne spor, men ikke sannere: mellom to punkter to minutter fra
hverandre vet vi ikke hva som skjedde. Kappet er riktig; det som manglet var å la være å
svare.

**Ingen ny modellering av tynne spor.** Fristelsen er å interpolere. Da hadde vi konstruert
data for å slippe å si «vet ikke», som er samme feil i en penere innpakning.

**Ett tall til i tabellen.** Punktavstanden vises per økt i kortet. Det var *mønsteret i
tallene* som avslørte feilen, ikke koden — så neste gang skal tallet stå der uten at noen
må legge merke til at alt er delelig på seksti.

## Verifisering

- `npm test`: 3074 grønne (5 nye i `moving-time.test.ts`).
- `npm run check`: 0 feil, 0 advarsler.
- Testen som fester feilen bruker samme form som prod-dataene: et spor på 3360 sekunder
  med 120 sekunder mellom punktene gir nå `rejection: 'for_tynt_spor'` framfor «8 min».
  Samme spor med 4 sekunders avstand gir over 3300 sekunder bevegelse.
- Fjellturen: 1 t 20 min gange, 50 min på 0,3 m/s, 40 min gange → over 90 % kreditert.

**Fortsatt ikke kjørt:** selve backfillen og de visuelle testene. Neste dry-run er den
egentlige prøven — de gjenværende radene skal enten se troverdige ut eller være avvist med
en grunn som står i klartekst.
