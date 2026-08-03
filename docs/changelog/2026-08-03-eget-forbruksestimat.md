# Eget forbruksestimat, og en dom som ble felt for tidlig

Dato: 2026-08-03
Status: ferdig

## Kontekst

To ting fra samme skjermbilde.

**Feilen først.** Vektkontrollen fra forrige runde fyrte på **én logget dag** og
tilskrev den 0,7 kg vektendring: «Det tilsvarer 3 245 kcal per dag». Porten gatet på
*vektspennet* — 60 dager med Withings-målinger — og ikke på hvor mange dager som
faktisk var logget. Meningsløst, og vist med selvtillit.

Brukeren pekte samtidig på det prinsipielle: vekt varierer med vann, fordøyelse og
tid på døgnet, så endring dag-til-dag kan ikke bære en konklusjon om kalorier.

**Og forslaget:** kan vi lage en baseline for «mann 42 med kontorjobb» og legge til
aktivitetene selv, framfor å stole på Withings?

## Faser

### 1. Vektdommen strammet inn

`weight-reality-check.ts`:

- **Dekningskravet** er den avgjørende porten: de loggede dagene må dekke minst
  70 % av vinduet de sammenlignes med. Én dag kan ikke forklare 60 dagers
  vektendring, uansett hvor lang vektserien er.
- **Snitt i hver ende** framfor to enkeltmålinger, over syv dager. To punkter er
  nettopp det brukeren advarte mot. En test fester dette: siste måling settes 1 kg
  over trenden, og dommen skal ikke snu på det.
- `spanDays` og `loggedCoverage` er med i svaret, så flaten kan si *hvorfor* det ikke
  konkluderes.

Skjermbildet ligger som regresjonstest: 60 vektdager, én logget dag, ingen dom.

### 2. Vårt eget estimat

`src/lib/domain/health/energy-expenditure.ts` *(ny)*.

**Hvileforbrenning** fra Mifflin-St Jeor, som treffer bedre enn Harris-Benedict på
moderne populasjoner. Krever vekt, høyde, alder og kjønn. Mangler noe, returneres
**null** — et forbrukstall bygget på antatt kroppshøyde ser like troverdig ut som et
ekte, og det er nettopp problemet.

**Døgnforbruk** = hvile × `DESK_JOB_FACTOR = 1.25`. Lav med vilje: standardtabellenes
«sedentary» (1,2) og «lett aktiv» (1,375) er ment å dekke *all* aktivitet inkludert
trening. Siden øktene legges på toppen, ville en høyere faktor tatt dem med to ganger.

**Øktene** fra MET-verdier, med **(MET − 1)**. Det er detaljen som oftest glemmes: en
MET-tabell gir *brutto* forbruk, som inkluderer hvilestoffskiftet i de samme
minuttene. Legger man brutto oppå et døgnforbruk som alt dekker hvile, teller man
hvilen dobbelt — 92 kcal på en times økt for 88 kg. Det er en egen test.

**El-sykkel er hele poenget.** Vanlig sykling ligger på 6–8 MET, men med
pedalassistanse faller arbeidet: `e_bike` er satt til 4,5. Withings ser ikke
forskjellen — turene logges som «Cycling» — og det er der avviket oppsto.

**Løping skalerer med farten** (`runningMet`, etter ACSM: VO2 = 0,2 · m/min + 3,5).
En fast «running»-verdi ville bommet i begge retninger; 8 og 14 km/h skiller nesten
5 MET.

Regnet på 3. august med en antatt høyde på 183 cm og 88 kg: hvile 1 819, døgnbaseline
2 274, økter ~280 → **~2 550 kcal**. Withings oppga 2 763, og senere 3 168.

### 3. Kroppsprofilen måtte lagres

Høyde, fødselsår og kjønn finnes ikke noe sted i basen — Withings gir bare vekt.

`PUT /api/helse/profil` skriver dem til `themes.metricSettings.profile` på
Helse-mortemaet, samme sted som søvnterskler og makspuls. Metrikk-arkets PUT bevarer
nøkler den ikke eier, så de to skriver ikke over hverandre. Feltene kan settes ett av
gangen, og `null` fjerner.

`metricSettings`-typen i `schema.ts` er samtidig oppdatert: den manglet `maxHr`,
`nutrition` og `profile`, altså tre nøkler koden alt skrev.

### 4. Flaten viser begge

Energikortet viser nå Withings' tall og vårt eget side om side, med differansen når
den er over 200 kcal. Mangler profilen, sier kortet hva som mangler framfor å tie.

Ingen av tallene «vinner». Poenget er at et estimat med kjente forutsetninger kan
stilles opp mot et fra en svart boks — og at spriket er informasjon.

## Beslutninger

- **Andre mening, ikke erstatning.** Vi bytter ikke ut Withings' tall. Vårt eget er
  ikke mer sant; det er bare gjennomsiktig, og to uenige anslag sier mer enn ett.
- **Null framfor gjetning på profil.** Alternativet — anta 180 cm — ville gitt et
  tall som ser like solid ut som et riktig.
- **Konservativ retning.** Bevegelse utover det faktoren dekker (en dag med 15 000
  skritt uten registrert økt) legges *ikke* til. Estimatet blir dermed litt lavt, og
  det er den retningen å ta feil i når tallet brukes til å begrunne mat.
- **Dekning framfor horisont i vektdommen.** Det var ikke lengden på vektserien som
  manglet, det var loggede dager.

## Verifisering

- `npm run check`: 0 feil, 0 advarsler.
- `npm test`: 2329 grønne i 181 filer (fra 2309), 20 nye.
- Tallene fra 3. august ligger som testdata: at de to el-sykkelturene havner mellom
  230 og 330 kcal, og under en fjerdedel av Withings' 1 460.

### 5. Etterspill: de to metodene er enige om hvileforbrenningen

Med brukerens faktiske tall — mann, 187 cm, født 1984, ~100,1 kg:

| Metode | Hvileforbrenning |
|---|---|
| Mifflin-St Jeor (vår) | **1 964** |
| `totalCalories − calories` over rene dager (Withings) | **1 953** |

**11 kcal fra hverandre**, fra to helt uavhengige veier. Det er den sterkeste
bekreftelsen noen av dem kunne fått, og det gjør basalen til den delen av
regnestykket man kan stole på.

Vårt døgnanslag for 3. august: 2 455 (baseline) + 316 (52 min el-sykkel) + 14 (yoga)
= **2 786 kcal**. Withings oppga 3 168 kl. 17:24.

**Og vekttrenden avgjør resten.** Månedssnitt: juni 101,58 → juli 99,95 → august
100,06. Altså 1,53 kg ned over ~61 dager, som er **193 kcal underskudd per dag** —
ikke 1 729. Med et forbruk rundt 2 786 betyr det et faktisk inntak nær 2 590, mens
loggen sto på 1 439. Avviket ligger på inntakssiden.

### 6. Retting: splitten holdes tilbake midt på dagen

`totalCalories` var 2 763 kl. 15:57 og 3 168 kl. 17:24 — 405 kcal på nitti minutter
uten aktivitet, mot hvilestoffskiftets ~80 i timen. Enheten reviderer dagen
retroaktivt, og vi vet ikke om tallet er «så langt» eller et døgnanslag.

Å trekke et helt døgns hvileforbrenning fra en delvis total er derfor meningsløst.
`partialDay` gjør at splitten holdes tilbake, og differansen mot vårt eget anslag
vises bare på en komplett dag — ellers ville en formiddag blitt sammenlignet med et
døgn.

## Verifisert mot ekte data

De to hvileforbrenningene over er regnet fra prod: brukerens profil mot fire dagers
Withings-rader.

**Gjenstår:** ingen UI for å sette profilen — bare endepunktet. Et felt i
terskelarket er det naturlige stedet.
