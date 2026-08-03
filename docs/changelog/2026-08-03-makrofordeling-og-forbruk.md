# Makrofordeling, og hvorfor «forbrent» var 2 763

Dato: 2026-08-03
Status: ferdig

## Kontekst

To spørsmål fra samme skjermbilde: kan vi visualisere makroene, og hvorfor mener
modellen at det er forbrent 2,7k kalorier?

Det andre viste seg å være det interessante.

## Faser

### 1. Makrofordelingen

Flaten viste fire tall side om side: 634 kcal, 31,2 g protein, 50,9 g karbo, 32,1 g
fett. **Gram er ikke sammenlignbare** — fett har 9 kcal per gram mot 4 for de to
andre. På denne dagen hadde fett *færrest* gram av de tre store og *flest*
kalorier: 289 mot 204 for karbo. Talltilene kunne ikke vise det.

`macroEnergySplit` i `$lib/domain/nutrition/macro-split.ts` regner andelene av
makro-energien, og `MacroSplitBar` viser dem som en liggende stablet stolpe.

Formen er valgt, ikke funnet: del-av-helhet med tre kategorier er en stablet
stolpe, ikke et kakediagram og ikke tre måleere.

**Summen stemmer ikke med kcal-tallet, og det sies.** `protein·4 + karbo·4 +
fett·9` ga 617 mot 634 logget. Fiber og alkohol regnes ulikt, og makroene er anslag
hver for seg. Andelene regnes derfor av makro-energien — så de summerer til 100 % —
og `unaccountedKcal` bærer differansen. Over 10 % avvik forklarer kortet det i
klartekst. Å regne andelene av det loggede tallet ville gitt tre andeler som ikke
summerte til hundre, uten at noe forklarte hvorfor.

**Fargene er validert, ikke valgt på følelse.** De tre første slottene fra den
kategoriske paletten (`#3987e5`, `#d95926`, `#199e70`), tildelt i fast rekkefølge
— protein, karbo, fett — så et segment beholder fargen når et annet blir null. Kjørt
gjennom validatoren mot flatefargen `#141414`: verste nabopar ΔE 9,4 (deutan), 26,5
(normalt syn), alle over 3:1 mot flaten. Det første forsøket med husets egne
aksentfarger (`#7c8ef5`, `#4ade80`, `#f0b429`) feilet lysthetsbåndet og lå på ΔE 8,2.

Identiteten ligger aldri i fargen alene: hvert segment er direkte merket med sin
andel, legenden gjentar gram og kcal, og stolpen har en `aria-label` som leser hele
fordelingen. 2px mellomrom i flatefargen skiller segmentene.

### 2. Hvorfor «forbrent» var 2 763

Tallet kommer rått fra Withings' `data.totalCalories`, som er hvileforbrenning
pluss aktivitet. De faktiske radene:

| Dag | Skritt | `calories` (aktivitet) | `totalCalories` | Differanse |
|---|---|---|---|---|
| 31. juli | 8 390 | 476 | 2 430 | 1 954 |
| 1. august | 11 123 | 728 | 2 699 | 1 971 |
| 2. august | 5 079 | 318 | 2 276 | 1 958 |
| **3. august** | **2 378** | **1 460** | **2 763** | **1 303** |

Differansen er hvileforbrenningen, og den er stabil rundt **1 958** — bortsett fra
3. august, der den faller til 1 303.

**To ting er galt den dagen.**

For det første er aktivitetstallet urimelig. 1 460 kcal på 2 378 skritt og 1,9 km.
Forklaringen ligger i øktene: to el-sykkelturer, 1 617 s + 1 477 s, som med yogaen
blir de 3 107 sekundene Withings har klassifisert som «intense». **52 minutter
el-sykkel kreditert 1 460 kcal er 28 kcal per minutt** — elitenivå. Realistisk for
el-sykkel er 5–8. Til sammenligning fikk 11-kilometeren 1. august bare 728 kcal.
Vår egen effort-modell vekter el-sykkel ned (`ebike` er egen kategori nettopp derfor),
men energibalansen leste Withings' tall uten forbehold.

For det andre summerer ikke Withings' egne felter. 1 460 aktivitet + 1 958 hvile er
3 418, men totalen oppgis som 2 763 — **655 kcal fra hverandre**. Feltene oppdateres
retroaktivt gjennom dagen og tydeligvis ikke i takt, så en delvis dag kan ha internt
uenige komponenter.

Konklusjonen: «Underskudd 1 324 kcal» kl. 17:24 den dagen var ikke til å stole på.

### 3. Tallet gjort etterprøvbart

Vi kan ikke rette Withings. Vi kan slutte å vise summen som om den var en fasit.

`$lib/domain/nutrition/expenditure-breakdown.ts`:

- `deriveBasalMetabolism(days)` — hvileforbrenningen som **medianen** av
  `totalCalories − calories`. Medianen, ikke snittet: 3. august ville ellers dratt
  baselinen fra 1 958 til 1 796. Dagens egen rad holdes utenfor, siden en rad som
  er uenig med seg selv ikke skal definere baselinen den måles mot.
- `describeExpenditure(...)` — deler tallet i hvile og aktivitet, regner hva delene
  impliserer, og setter `reconciles: false` når avviket overstiger 150 kcal.

Kortet viser nå «Hvile ~1 958 + aktivitet 1 460 · fra Withings» under totalen, og
en gul linje når komponentene spriker: hva delene summerer til, hva totalen oppgis
som, og at feltene oppdateres retroaktivt.

Mangler grunnlaget, påstås ingen uenighet — ukjent er ikke det samme som feil.

### 4. Opprydding på veien

`loadWithingsContext` hentet 70 aktivitetsrader per sidevisning for å plukke ett
felt. Forbruket leses nå gjennom `loadExpenditureContext`, som også gir komponentene
og baselinen, og den døde spørringen er borte.

## Beslutninger

- **Andeler av makro-energi, ikke av kcal-tallet.** Det første summerer til 100 %.
  Det andre ville gitt tre tall som ikke gjorde det, og differansen ville blitt
  usynlig framfor forklart.
- **Vise komponentene framfor å korrigere tallet.** Vi *kunne* vektet el-sykkel ned i
  energibalansen slik effort-modellen gjør. Men da ville flaten vist et tall som
  verken er Withings' eller brukerens, uten at noe sa det. Å vise hva summen består
  av lar brukeren gjøre vurderingen — og gjør neste sprik synlig av seg selv.
- **Median framfor snitt for hvileforbrenningen.** Én uenig dag skal ikke flytte
  baselinen den skal måles mot.

## Verifisering

- `npm run check`: 0 feil, 0 advarsler.
- `npm test`: 2300 grønne i 179 filer (fra 2283), 17 nye.
- **Paletten kjørt gjennom validatoren**, ikke vurdert for øyet. Første forsøk
  feilet; det andre passerte alle seks sjekkene.
- **Alle tre stolpetilstandene rendret i ekte Chromium**, ingen konsollfeil:
  typisk dag, proteinrik dag, og dagen der makroene ikke forklarer kcal-tallet.
- Regnestykkene fra tabellen over ligger som testdata i
  `expenditure-breakdown.test.ts`, med −655 som eksplisitt assertion.

**Ikke verifisert:** energikortet med sprik-varselet på ekte data. Den lokale basen
har ikke 3. august-radene fra Withings. Neste gang komponentene spriker skal linja
dukke opp av seg selv.
