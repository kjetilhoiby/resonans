# Bevegelsestid: sporet må dekke økta

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

En 56-minutters løpetur har ikke åtte minutter bevegelse.

### Feilsporet, og hvorfor det er verdt å skrive ned

Første diagnose var at **hver verdi var et helt antall minutter** — 8, 12, 8, 8, 9, 41, 99
— og at `MAX_CREDITED_INTERVAL_SECONDS` (60) derfor slo inn på hvert intervall.

Det mønsteret fantes ikke i dataene. `formatDuration` i kortet gjør
`Math.round(seconds / 60)`; hele «funnet» var **vår egen formatering**. En diagnose bygget
på et artefakt fra visningslaget, altså — og den lærdommen er verdt mer enn feilen: leter
du etter et mønster i en rapport, sjekk om rapporten kan ha laget det.

### Hva som faktisk skjedde

Brukeren åpnet økta på flaten. Der står 8,33 km / 56 min, med to kilder som er enige
(Withings og Dropbox GPX). Men **splits stopper på 1,25 km, og pulsfordelingen summerer til
7 min 34 s** — og begge regnes fra nøyaktig de `trackPoints` bevegelsestiden leser.

Sporingen gikk i stykker underveis. Modulen så et internt konsistent spor på under åtte
minutter, fant at alt var bevegelse, og svarte «8 min» på en 56-minutters økt.

`coverage` fanget det ikke, og det er det egentlige designhullet: den måler krediterte
intervaller mot **sporets eget spenn**, ikke mot **økta**. Et spor kan være perfekt tett og
likevel beskrive en åttendedel av turen.

Feilen er verre enn et galt tall. Modulen er bygget rundt regelen «null framfor et gjettet
tall», og her ga den et **selvsikkert** svar på et spørsmål sporet ikke kunne besvare.

## Faser

### Fase 1: Sporet må dekke økta

`MIN_TRACK_SPAN_SHARE` (0,8). Sporets tidsspenn måles mot øktas oppgitte varighet
(`data.duration`), som sendes inn via `declaredDurationSeconds`. Dekker sporet mindre enn
80 % av økta, er svaret null: om de resterende minuttene var bevegelse eller stillstand vet
vi ingenting om.

En test binder de to portene fra hverandre, siden det var forvekslingen som slapp feilen
gjennom: `coverage` måler mot sporet, span-porten mot økta.

### Fase 2: Tetthetsport

`MAX_MEDIAN_SAMPLE_SECONDS` (15 s). Er medianavstanden mellom sporpunkter større, kan en
pause ikke skilles fra et hull uansett hvor god resten av modellen er.

**Denne porten er prinsipiell, ikke målt.** Den ble bygget på feilsporet over, og står
igjen fordi resonnementet holder på egne bein: med minuttavstand mellom punktene kappes
hvert intervall til 60 sekunder, og svaret blir en beskrivelse av oppløsningen. Den er
konservativ — utfallet er null, altså elapsed videre — så den kan ikke gjøre skade. Men
ingen prod-rad er bekreftet avvist av den ennå.

`MIN_COVERAGE` er hevet fra 0,5 til 0,7 av samme grunn.

### Fase 3: Grunnen rapporteres

`analyzeMovingTime` returnerer `{ result, rejection, medianSampleSeconds, pointCount }`.
`computeMovingTime` er nå et tynt kall over den.

En stille null ser ut som «ingen data», og da leter man etter feil i innhentingen framfor i
sporets oppløsning. Backfillen teller per grunn (`rejections`), og kortet viser dem i
klartekst med punktavstanden per økt. «89 ga ikke noe svar» ser ut som ett problem; det er
fire, og bare ett av dem er verdt å gjøre noe med.

### Fase 4: Fjellturen

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

**Tre tall til i tabellen.** Sporlengde, antall punkter og punktavstand vises per økt.
Feilen ble funnet ved at brukeren åpnet økta og så at splits stoppet på 1,25 km — altså i
en helt annen del av appen. Tallene som avgjør om et svar er til å stole på skal stå ved
siden av svaret, ikke måtte oppsøkes.

**Ingen ny modellering av tynne eller delvise spor.** Fristelsen er å interpolere. Da hadde
vi konstruert data for å slippe å si «vet ikke», som er samme feil i en penere innpakning.

## Verifisering

- `npm test`: 3077 grønne (8 nye i `moving-time.test.ts`).
- `npm run check`: 0 feil, 0 advarsler.
- Testen som fester den ekte feilen: et spor på 450 sekunder mot en oppgitt varighet på
  3360 gir `rejection: 'sporet_dekker_ikke_okta'` framfor et tall.
- Tetthetsporten har sin egen test (120 s punktavstand → `for_tynt_spor`), og en test
  binder den til å ligge under `MAX_CREDITED_INTERVAL_SECONDS`.
- Fjellturen: 1 t 20 min gange, 50 min på 0,3 m/s, 40 min gange → over 90 % kreditert.

**Fortsatt ikke kjørt:** selve backfillen og de visuelle testene. Neste dry-run er den
egentlige prøven — de gjenværende radene skal enten se troverdige ut eller være avvist med
en grunn som står i klartekst.
