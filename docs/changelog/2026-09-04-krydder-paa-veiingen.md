# Krydder på veiingen

Dato: 2026-09-04
Status: ferdig

## Kontekst

Vekt-pushen sa «Veiing registrert / 94,2 kg». Det er tallet brukeren nettopp
leste av på vekta, gjentatt, uten ett ord om hva det betyr.

Treningsøktene fikk krydder i august 2026 — «Lengste løpetur i år!», «Løpetur
nr. 50 i år», «Raskeste tempo på 90 dager» — og krydderet er det som gjør et
varsel verdt å åpne. Vekta har mer historikk å si noe fra enn treningen har:
1200 veiinger over ni år, med trend, perioder, rekorder og målvekt ferdig
regnet i `weight-milestones.ts`. Ingenting av det nådde varselet.

Setningene brukeren etterspurte — «laveste vekt siden [dato]», «n kg under
målet», «total nedgang siden [dato]», «august ble ned n kilo» — fantes altså
allerede som kode. Tre av dem. Den fjerde, månedsoppgjøret, fantes ikke.

## Faser

### Fase 1: Milepælene fikk en kortform

`WeightMilestone` har nå `headline` ved siden av `sentence`: «Laveste snittvekt
siden mars 2025» mot «Snittvekta har ikke vært lavere enn 95,3 kg siden 12. mars
2025 — 1 år og 5 måneder tilbake.»

Kortformen bygges av koden som alt har tallene, ikke av en ny modul som regner
dem på nytt. iOS kapper en push-tittel midt i tallet, så kortformen er ikke
pynt; men to steder som formulerer samme rekord er to steder å endre, og et
varsel som sier noe annet enn flaten det lenker til er verre enn et varsel uten
fakta.

`WeightMilestoneResult` fikk også `all` — sortert, men uten kappet på
`MAX_MILESTONES`. Kappet er en beslutning om et KORT (tre setninger er så mange
en flate bærer), ikke om hva som er sant. Uten det ville «3 kg til målet» falt
ut av pushen fordi tre sterkere rekorder tok plassene på et kort ingen leser i
det øyeblikket.

Filer: `src/lib/domain/health/weight-milestones.ts`,
`src/lib/domain/health/weight-text.ts` (`formatMonthYear`, `formatMonthName`).

### Fase 2: Reglene, rent

`src/lib/domain/health/weight-nugget-rules.ts`:

- `monthChangeNugget` — den ene regelen som er ny.
- `weightNuggets` — milepælene + månedsoppgjøret, rangert for en PUSH.
- `buildWeightPush` — de to linjene, ferdig formulert.

### Fase 3: Datainnhentingen

`src/lib/server/health/weight-nugget.ts` henter, den rene modulen bestemmer —
samme arbeidsdeling som `workout-nuggets.ts` mot `workout-nugget-rules.ts`.

Historikken leses gjennom en ny DELT leser, `readWeightDays`
(`src/lib/server/health/weight-history.ts`), som ble løftet ut av
`weight-dashboard.ts`. Alternativet var en ny rå spørring mot `sensor_events`,
altså nøyaktig mønsteret `sensor-event-access.ts` finnes for å stoppe. Nå leser
flaten, milepælene og krydderet den samme serien over det samme vinduet.

`withings-sync-notifications.ts` bruker `computeWeightPush` for tittel og body,
med den gamle teksten som fallback hvis oppslaget feiler.

## Beslutninger

**Månedsoppgjøret hører ikke blant milepælene.** Et kort leses når som helst, og
«august ble ned 1,2 kg» er bare interessant de første dagene etter at august tok
slutt. En push har derimot et tidspunkt. `MONTH_SUMMARY_WINDOW_DAYS` er 5 og
ikke «bare den 1.»: en veiing hopper over dager, så en fast dato ville truffet
omtrent annenhver måned.

**Begge ankrene i månedsoppgjøret ligger på et månedsSKIFTE**, ikke på den 1. og
den 31. Trenden er et etterslepende sjudagerssnitt, så den ligger noen dager bak
virkeligheten i begge ender; måler man mellom to punkter med samme etterslep,
kansellerer det. Med den 1. som startanker ville halve vinduet ligget i forrige
måned, og «august» ville i praksis dekket 25. juli–25. august.

**Og trenden, ikke månedssnittene.** `weight-monthly.ts` svarer på et annet
spørsmål: forskjellen mellom to NIVÅER, ikke bevegelsen GJENNOM måneden. På en
jevn nedgang gir snitt mot snitt omtrent halvparten av det som faktisk skjedde.

**Push-rangeringen er en annen enn kortets.** Kortet svarer på «hvor står jeg»
og leses når brukeren selv åpner det, så der vinner den sterkeste rekorden. Et
varsel dytter seg på deg i det du stiger av vekta, og da vinner det sjeldneste:
månedsoppgjøret fyrer fem dager i måneden, mens «laveste snittvekt» kan fyre
hver morgen gjennom en nedgangsperiode. `below-goal` er løftet av samme grunn —
å nå målvekta skjer én gang. Og avstanden til målet ligger over
atferdsmilepælene, motsatt av på kortet: der er veiestreaken den ene setningen
som er sann uansett hvilken vei vekta går, mens i et varsel OM en veiing er
«1,8 kg til målet på 90,0 kg» det mer opplysende av de to.

**Rekorden faller ikke bort når månedsoppgjøret tar tittelen.** Pushen har to
linjer, og den nest høyest rangerte blir andrelinja: «August ble ned 1,2 kg» /
«92,0 kg · Laveste snittvekt vi har målt». `ECHOES` hindrer at andrelinja
gjentar tittelen med andre ord — to setninger om samme hendelse leses som to
hendelser, og den svakeste låner da troverdighet fra den sterkeste.

**Vekta står alltid først i body-en.** Tittelen er krydderet, og et krydder uten
tallet under er en påstand brukeren ikke kan etterprøve mens hen står på badet.

**Under støygulvet sier vi «uendret», ikke et tall.** `MONTH_NOISE_FLOOR_KG` er
0,3. En måned oppsummeres ikke med 0,1 kg — det er væske, ikke en måned.

**Ti veiinger før måneden kan oppsummeres.** Ti av tretti er tynt, men det er
tynt på en måte som er synlig for den som veier seg; et månedsoppgjør fra tre
veiinger er et oppgjør mellom tre morgener, ikke mellom to måneder.

**Ingen ny lenke.** Varselet peker fortsatt på `/samtaler?context=weight`. Å
flytte det til Vekt-undertemaet ville vært en endring i navigasjonen ingen ba
om, og helsechatten har briefingen med de samme tallene.

## Verifisering

- `src/lib/domain/health/weight-nugget-rules.test.ts` dekker vinduet,
  dekningskravet, støygulvet, begge retninger, at endringen måles gjennom
  måneden og ikke mellom to snitt, rangeringen, fallbacken uten krydder, og at
  andrelinja ikke gjentar tittelen.
- `npm test` og `npm run check`.

## Kjent rest

- **Krydderet kan gjenta seg.** «Laveste snittvekt siden mars 2025» er sant hver
  morgen i en nedgangsperiode, og det finnes ingen bokføring av hva vi sa sist
  (økter har `workout_notifications`; vekt har ingen tilsvarende tabell). Vekta
  i body-en endrer seg daglig, så varselet er ikke identisk — men tittelen kan
  stå i en uke. En dedup her ville krevd en ny tabell.
- Krydderet finnes bare i pushen. Google Chat-fallbacken for vekt finnes ikke
  (bare for økter), og Ekko har ingen vekt-varsling.
- `HealthKit`-vektbackfillen og manuelle veiinger gir ingen push i det hele
  tatt — varslingen henger på Withings-synken.
