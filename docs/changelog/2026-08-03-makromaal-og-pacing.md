# Vårt anslag i front, makromål, og sultkrisa forklart

Dato: 2026-08-03
Status: ferdig

## Kontekst

Tre ting fra samme melding:

1. Fremhev vårt eget forbruksanslag framfor Withings'.
2. Kan man sette mål for makrobalansen og få fornuftige snack-råd av modellen?
3. *«I dag falt jeg litt gjennom og var veldig sulten i 15-17-tida.»*

Den tredje er den mest interessante, for loggen forklarer den presist.

## Faser

### 1. Vårt anslag er nå hovedtallet

`energyBalance` regnes fra `ownExpenditure.totalKcal` når kroppsprofilen holder, med
fall tilbake til Withings ellers. Kortet viser regnestykket — hvile × kontorhverdag
pluss øktene — og Withings' tall under, som kryssjekk med differansen.

Begrunnelsen er ikke at vårt er mer nøyaktig. Det er at det er **gjennomsiktig**,
gjelder hele døgnet, og ikke lener seg på et `calories`-felt som beviselig kan være
dobbelt for høyt. Mangler profilen, sier kortet at tallet er Withings' og hva som må
til for å regne selv.

### 2. Makromål

`metricSettings.nutrition` tar nå `proteinPct`, `carbsPct` og `fatPct` i tillegg til
`kcalTarget` og `proteinTarget`. Skrives med `PUT /api/helse/ernaering/mal`.

`evaluateMacroTargets` regner avviket i **både** andel og gram — og gram er det som
brukes videre. «Du mangler 149 g protein» er handlingsrettet; «du mangler 8
prosentpoeng» er det ikke.

To valg verdt å nevne:

- **Absolutt proteinmål vinner over andelen.** Protein settes naturlig per kilo
  kroppsvekt (1,6–2,0 g/kg), ikke som andel av et kaloribudsjett.
  `suggestedProteinTarget` foreslår midt i spennet.
- **Andeler krever et kcal-mål** for å bli gram. 30 % av ingenting er ingenting, og
  da er `targetG` null framfor et påfunn.

Endepunktet advarer hvis andelene summerer langt fra 100 — ikke en feil, men da er
målene umulige å nå samtidig.

### 3. Sultkrisa var aritmetikk

Loggen for 3. august: frokost 07:10 på **62 kcal** (kefir og kaffe), lunsj 12:01 på
**242**. Altså **304 kcal før klokka 15**, på en dag som endte over 3 000 i forbruk.
Sulten i 15–17-tida var ikke viljestyrke, den var underspising.

Et dagstall alene kan ikke fange dette: 2 600 kcal fordelt som 300 før 15 og 2 300
etter er en helt annen dag enn 2 600 jevnt fordelt, selv om summen er identisk.

`intake-pacing.ts` måler derfor inntaket mot **hvor langt på dagen** man er.
Forventningskurven er bevisst ikke lineær — folk spiser ikke mens de sover, og en
jevn fordeling over 24 timer ville sagt 25 % kl. 06. Punktene følger måltidsslotene:
~15 % ved 09, 35 % ved 12, 45 % ved 15, 72 % ved 18.

For 3. august kl. 15: faktisk 12 %, forventet 45 %. `behind: true`.

### 4. Modellen vet hva den skal gjøre med det

`query_nutrition` returnerer nå `macroTargets` og `pacing`, og prompten sier hvordan
de brukes:

- Ligger man bak skjema → si det med tall, og foreslå et **ordentlig** mellommåltid
  på 300–500 kcal. En for liten snack utsetter bare krisa.
- Er protein største gap → velg noe proteinrikt, og oppgi gram.
- Gjentar mønsteret seg over flere dager → svaret er mer mat tidligere, ikke en
  større snack.

Prompten sier det rett ut: **sultkriser midt på dagen er nesten alltid pacing, ikke
viljestyrke.**

## Beslutninger

- **Gram framfor prosentpoeng i alle råd.** Andeler er riktig form å *sette* mål i og
  gal form å *handle* på.
- **Vårt anslag i front, Withings som kryssjekk** — ikke fordi vårt er sannere, men
  fordi det kan etterprøves.
- **Ikke-lineær forventningskurve.** Den enkleste modellen ville flagget hver morgen
  som «bak skjema», og et varsel som alltid lyser er ikke et varsel.

## Verifisering

- `npm run check`: 0 feil, 0 advarsler.
- `npm test`: 2351 grønne i 183 filer (fra 2330), 21 nye.
- Tallene fra 3. august ligger som testdata: 304 kcal kl. 15 mot forventet 1 170, og
  `behind: true`.

**Ikke verifisert:** selve snack-samtalen, som krever prod. Målene er heller ikke satt
ennå — endepunktet var ikke deployet da dette ble skrevet.

**Gjenstår:** ingen UI for makromålene, bare endepunktet. Samme mangel som
kroppsprofilen fra forrige runde, og de hører naturlig i samme skjema.
