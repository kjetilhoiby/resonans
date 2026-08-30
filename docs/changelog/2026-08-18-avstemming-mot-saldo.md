# Avstemming mot saldo

Dato: 2026-08-18
Status: fase 1 ferdig (måling), fase 2 utestående (fix)

## Kontekst

Siden 23. juni 2026 skriver SB1 samme transaksjon flere ganger med ulike beskrivelser:

```
2026-07-27   23 000,00   Overførsel
2026-07-27   23 000,00   Fra: Anita Grønningsæter Digernes Betalt:
2026-07-27   23 000,00   Avtale
```

Lønna likeså: `Lønn` + `Fra: AMEDIA PRODUKT OG TEKNOLOGI AS`, samme dag og øre.

Bøttenøkkelen kan ikke slå dem sammen — `Avtale` og `Regninger` deler ingenting, så det finnes
ingen prefiks å strippe. Spørsmålet var derfor hvilket signal som KAN skille dem.

## Hypotese 1: bankens transaksjons-ID. Avvist.

`GET /api/admin/economics/samme-transaksjon` grupperte rå-versjoner på (konto, dato, beløp) der
beskrivelsen varierer:

| | Grupper |
|---|---:|
| Deler én `externalTransactionId` | **0** |
| Har ulike id-er | **222** |
| Mangler id | 0 |

**222 av 222.** SB1 roterer id ved hver synk — 11 rå-rader, 11 id-er, 3 beskrivelser per gruppe.
ID-en er ikke en identitet, og hypotesen falt på første måling.

## Hypotese 2: saldoen. Bekreftet, etter at instrumentet ble reparert.

Saldoen kan ikke diskuteres: beveget kontoen seg 1 900 kr mens vi har bokført 5 700, teller vi tre
ganger.

### Første måling var blind, og to av mine egne tall avslørte det

Avstemmingen svarte **«0 avvik»** for siste 30 dager — mens to aktive lønnsrader på 54 685 kr sto
på samme dato. To målinger var uenige, og den ene måtte være gal.

**Det var målingen.** Med ankere per DAG blir hvert intervall én dag, og da ligger alt volumet på
sluttdagen. Hele beløpet er grenseusikkert, `significant` blir aldri sann, og «ingen avvik» er en
egenskap ved instrumentet framfor ved dataene. 29 intervaller over 30 dager ga 0 avvik.

**Regelen: ankerne må være grovere enn transaksjonenes oppløsning.** `canonical_date` har
dagsoppløsning, så månedlig gir grenseusikkerhet på én dag av tretti. `boundaryShare` rapporteres
nå per intervall nettopp fordi en umålbar periode ellers ser ut som en periode der alt stemmer.

To rettelser av samme familie fulgte: bare SLUTTdagen er tvetydig (startdagen hører til forrige
intervall), og `totalAbsDiffNok` står ved siden av den signerte summen — signert sum skjuler at
+54 685 og −53 000 er **to** feil og ikke nesten null. Det er samme fortegnsblindhet som
`doubleCountedTotal` hadde tidligere i dette arbeidet.

### Resultatet, med månedlige ankere

**301 007 kr absolutt avvik over 180 dager. 0 umålbare intervaller.**

| Konto | Periode | Saldo sa | Vi bokførte | Avvik |
|---|---|---:|---:|---:|
| `lNi…` | juni→juli | +5 147 | **+95 148** | +90 001 |
| `m2yj…` | juni→juli | +4 718 | **+53 073** | +48 355 |
| `iHPE…` | juni→juli | −3 413 | **−31 254** | −27 841 |
| `iHPE…` | mai→juni | −3 756 | **−31 017** | −27 261 |
| `yLuK…` | juni→juli | +1 900 | **+5 700** | +3 800 |

`yLuK` er signaturen i renkultur: **5 700 = 3 × 1 900.** Neste intervall er 3 800 = 2 × 1 900.

Alle avvikene ligger fra mai–juni og framover. Samme brudd som valutaprefikset, samme måned.

## Rettelse av en tidligere konklusjon

Da jeg rapporterte den første avstemmingen, leste jeg «19 av 790 intervaller avvikende, 37 166 kr»
som at triplikeringen **ikke** ble dobbelttalt. Det var galt på to måter: instrumentet var blindt
for de tette periodene, og jeg summerte signerte avvik, som skjulte omfanget. Riktig tall er
**301 007 kr**, altså en faktor åtte.

Feilformen er kjent fra resten av dette dokumentet — et sammendragstall lest som et funn uten at
grunnlaget var sjekket — og den er nå fanget av `boundaryShare` og `totalAbsDiffNok`.

## Fase 2: fixen, ikke bygget

Avviket sier ikke HVILKE rader som er duplikater. Men saldoen gir noe ingen tidligere runde her
har hatt: **et orakel framfor en terskel.**

Skissen:

1. Grupper aktive canonical-rader på (konto, dato, beløp, fortegn). Grupper med n ≥ 2 er
   kandidater.
2. Regn hvor mye overtelling saldoen impliserer per månedsintervall.
3. Deaktiver kandidater til intervallet stemmer innenfor toleransen — og **stopp der**.

Stoppkriteriet er poenget. Motoren kan ikke slette for mye, fordi saldoen sier når det er nok. Det
er kvalitativt annerledes enn `booked-duplicates`, som må gjette ut fra teksten alene og derfor
aldri kan røre to identiske beskrivelser.

**Kjent fare:** to ekte kjøp på samme beløp samme dag (to Ruter-billetter à 41 kr) er en gyldig
gruppe. Oraklet beskytter mot å fjerne dem *hvis* saldoen stemmer i den perioden — men bare hvis
avviket kan tilskrives entydig. Rekkefølgen kandidatene behandles i må derfor være deterministisk
og størst-først, og dry-run må vise hver rad før noe skrives.

## Verifisering

- `npm run check`: 0 feil
- `npm test`: 3583 tester (17 på avstemmingen, 4 av dem på tetthetsfella)
- Tallene over er hentet fra prod, `granularity=month`

## Er saldotallene til å stole på? Målt, og svaret er delt

> «Skal jeg hente kontoutskrifter igjen, eller har vi trygge saldotall?»

Duplikatoverskuddet er regnet **helt uavhengig av saldoen** — grupper på (dato, beløp, fortegn),
overskudd = `(n − 1) × beløp`. To beregninger som ikke deler en eneste inngang kan ikke bli enige
ved uhell.

**Samlet enighet: 0,847.** Under terskelen på 0,9. Men headline-tallet skjuler det som betyr noe:

### De store avvikene er vindisert

| Konto | Periode | Saldoavvik | Duplikatoverskudd | Treff |
|---|---|---:|---:|---:|
| `iHPE…` | mai→juni | −27 261 | −27 317 | **0,998** |
| `iHPE…` | juni→juli | −27 841 | −28 171 | **0,988** |
| `m2yj…` | juni→juli | +48 355 | +46 955 | **0,971** |
| `lNi…` | juni→juli | +90 001 | +86 064 | **0,956** |

Disse fire er ~196 000 kr av 300 000, og de treffer innenfor 0,2–4 %. **Det er ikke tilfeldig.**
Saldoen måler riktig, og duplikatene forklarer avviket der pengene er.

Alle ankre kom dessuten fra **én** sensor per konto — ingen blanding av live-synk og PDF-import,
som ville gitt sprikende troverdighet.

### Uenigheten har to forklaringer, og begge er kjente

1. **Den inneværende måneden er ikke omme.** Intervallet 31. juli → 18. august treffer
   systematisk dårligst (0,387–0,738). Saldoen er «nå» mens transaksjoner fortsatt bokføres, så
   avviket der er delvis reelt ubokførte kjøp framfor duplikater.
2. **`yLuK` OVERforklarer**: overskudd 7 600 mot avvik 5 700. Kontoen har ekte gjentatte beløp på
   1 900 kr, så noen `n ≥ 2`-grupper er *to reelle bevegelser*. Nøyaktig fella som er notert over.

`4PEz` (0,501) er den ene som ikke er forklart. Ikke undersøkt.

## Konsekvensen for fase 2

**Svaret på brukerens spørsmål er nei — utskriftene trengs ikke.** Men saldoen kan ikke styre
ryddingen alene, og det er en skjerping av skissen over:

- **Hold det inneværende intervallet utenfor.** En periode som ikke er omme kan ikke avstemmes, og
  å rydde etter et avvik der ville fjernet ekte transaksjoner som ennå ikke er bokført.
- **Krev enighet PER INTERVALL, ikke samlet.** `iHPE` på 0,998 skal kunne ryddes selv om `4PEz`
  ligger på 0,501. Et samlet tall ville blokkert de sikre tilfellene på grunn av de usikre — samme
  feilform som å blande nevnere.
- **Stopp når intervallet stemmer.** Oraklet er fortsatt det som hindrer at motoren går for langt;
  `yLuK` viser at kandidatgruppene alene ville gjort det.
