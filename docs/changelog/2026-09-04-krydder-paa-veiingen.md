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
varsel dytter seg på deg i det du stiger av vekta, og da vinner det sjeldneste.
Avstanden til målet ligger over atferdsmilepælene, motsatt av på kortet: der er
veiestreaken den ene setningen som er sann uansett hvilken vei vekta går, mens i
et varsel OM en veiing er «1,8 kg til målet på 90,0 kg» det mer opplysende.

**METNING er problemet rangeringen løser, og det er ikke det samme som
gjentakelse.** «Laveste snittvekt siden [dato]» flytter referansen bakover helt
til den treffer taket, og blir så stående på «Laveste snittvekt vi har målt» —
identisk hver morgen så lenge nedgangen varer. Over et toårsmål er det
flertallet av morgenene. Rekorder er altså ikke sjeldne; de er KONTINUERLIGE.
Derfor ligger de fire som fyrer ÉN gang øverst: måloppnåelse (én gang), en
passert kilo-terskel (én gang per kilo), et andelsmerke (fire ganger), og
månedsoppgjøret (fem dager i måneden).

**`year-over-year` er plassert rett under den sterkeste rekorden, og det er en
beslutning om ANDRELINJA.** Tittelen metter, så den varierende setningen gjør
mest nytte i slot nummer to. Sammenligningsdagen flytter seg hver morgen, så
tallet er nytt hver dag. Målt på en jevn nedgang der trendrekorden var
undertrykt (rekorden var under 30 dager gammel, `MIN_RECORD_SPAN_DAYS`) falt
pushen før tilbake på «27 av 30 dager med veiing»; nå bærer år-mot-år den.

**Hele kilo som terskel, ikke femmere, og bare NEDOVER.** En femmerskala ville
gitt to varsler på to år og latt elleve ekte passeringer gå ubemerket; halve
kilo gjør passeringen til en teller (94,5 og 94,0 krysses i samme uke). En
oppovergående passering er sann og lett å regne, men «Over 96 kg for første gang
siden mars» er en anklage levert i det brukeren stiger av vekta —
atferdsmilepælene er det som skal bære de ukene vekta stiger.

**En passering som gjentar seg er ikke en passering.** Trenden kan vippe rundt
den samme terskelen noen dager på rad, og uten `MIN_RECORD_SPAN_DAYS`-vakta ville
«under 95 kg for første gang siden — for fire dager siden» fyrt gjentatte ganger
på samme kilo. Altså nøyaktig metningen regelen finnes for å bryte.

**Andelens baseline navngis alltid, uansett hvor den kom fra.** Finnes et mål i
`goals`, er dets `startValue` den riktige — det er der brukeren sa at dette
begynte. Finnes det ikke, brukes toppen av den pågående nedgangen. Begge sies:
«Halvveis fra målets startpunkt på 104,0 kg (april 2025) til målet på 90 kg»
mot «Halvveis fra 104,2 kg (april 2025) …». Et bart «halvveis til målet» ville
påstått et startpunkt brukeren ikke kan se — og trolig et annet enn det hen selv
hadde i hodet.

**Måldatoens overskrift er grovere enn kortets setning, med vilje.**
`describeGoalProjection` sier «rundt 12. mars 2027 — 3 måneder før fristen», og
det er ordene `/plan/mal` bruker; de står i `sentence`. Men en push-tittel leses
hver morgen, og et datoestimat flytter seg noen dager fram og tilbake med
tempoet — en eksakt dato i tittelen ville sett ut som en presisjon estimatet
ikke har, og invitert til å lese støy som framgang. Måned og år står stille i
ukevis.

**Måldatoen sier ingenting når den ikke har noe å si.** Går vekta motsatt vei
eller står stille, har `projectGoal` ingen dato — og et varsel som hver morgen
sier «ingen dato: vekta går motsatt vei» er en anklage på repeat. Er målet
passert, er det `below-goal` sin beskjed; en «nådd i mars»-tittel hver morgen
etterpå er metningen i sin verste form.

**To kilder til målvekt, og `ECHOES` er det som holder dem fra hverandre.**
`metricSettings.weight.goal` (below-goal, goal-distance) og `goals`-raden
(goal-progress, goal-date) er ulike rader som ingen holder i sync. Vi velger
ikke en vinner — vi lar dem aldri stå ved siden av hverandre, så brukeren aldri
ser to måltall i samme varsel. Det er samme regel som «navngi kilden når to
kilder betyr det samme», håndhevet i rangeringen framfor i teksten.

**Nærmeste frist vinner når flere mål finnes.** Har man både et toårsmål og et
delmål til jul, er delmålet det man kan gjøre noe med denne uka. Frister i
fortida hoppes over: en estimert dato mot en frist som var i fjor er en setning
om noe som er avgjort.

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
  andrelinja ikke gjentar tittelen. For fase 4 også: at en passering velger den
  laveste terskelen, at den ikke gjentar seg når trenden vipper, at den tier
  uten nok historikk og når vekta stiger, at andelen navngir baselinen og tier
  uten målvekt, og at år-mot-år bruker posisjonsord og tier under støygulvet.
- `cycle-series.test.ts` dekker begge ordforrådene, inkludert at
  posisjonsvarianten ikke dømmer retningen.
- For fase 5: at andelen måler fra målets startpunkt og navngir det, at den
  virker uten et tall i terskelarket, at den faller tilbake på periodetoppen
  uten et mål; at måldatoen har måned og år i overskriften og kortets ord i
  setningen, tier ved motsatt retning og ved nådd mål, og at ikke to måltall kan
  stå ved siden av hverandre i samme varsel.
- Forhåndsvist mot en syntetisk toårshistorikk: «Under 92 kg for første gang»,
  «August ble ned 0,9 kg / 93,1 kg · 7,6 kg under i fjor», og en vanlig dag der
  trendrekorden var undertrykt og år-mot-år bar tittelen.
- `npm test` og `npm run check`.

### Fase 4: Tre krydder til, og et ordforråd som ikke dømmer

Etter første runde i drift ble metningen den åpenbare svakheten (se
beslutningen under). Tre regler til, alle i `weight-nugget-rules.ts`:

- `thresholdCrossedNugget` — «Under 94 kg for første gang siden mars 2024.»
- `goalProgressNugget` — «Halvveis til 93 kg.»
- `yearOverYearNugget` — «2,4 kg under i fjor på samme dato.»

Den siste krevde en rettelse i `cycle-series.ts`: `describeCycleComparison` sa
«2,4 kg foran i fjor» om et vektNIVÅ. `foran/bak` forutsetter at det finnes en
god retning, og det er en dom flaten ikke har dekning for — samme grunn som at
«over båndet er ikke et helsevarsel». Funksjonen tar nå et ordforråd:
`position` («under»/«over») for et nivå, `progress` («foran»/«bak») der verdien
akkumulerer mot noe. Vektkortets ENDRINGSmodus beholder `progress` — der er
verdien et delta, og «under» om en nedgang sier ikke om du har gått mer eller
mindre ned. Løpekortet og `training-summary.ts` er urørt.

### Fase 5: Målet fikk sin egen baseline, og en dato

`readActiveWeightGoal` (`$lib/server/health/weight-goal-track.ts`) leser
`goals`-raden: målvekt, `metadata.startValue` og fristen. Med den:

- `goalProgressNugget` bruker **målets egen** baseline framfor periodetoppen, og
  sier hvilken av dem tallet kom fra.
- `goalDateNugget` er ny — «På dagens tempo: 90,0 kg i februar 2027», regnet av
  `projectGoal` med `kind: 'state'`, altså samme motor som `/plan/mal`.

Fallback-baselinen regnes PER MÅL som første måling på eller etter målets
startdato, ikke som ett tall kalleren sender inn: et mål startet i april og et
startet i fjor har ulike startpunkter, og den eldste målingen i historikken er
ingen av dem.

## Kjent rest

- **Krydderet kan fortsatt gjenta seg.** De fire som fyrer én gang bryter
  metningen på dagene de fyrer; de andre dagene står tittelen igjen på den
  sterkeste rekorden. Det finnes ingen bokføring av hva vi sa sist (økter har
  `workout_notifications`; vekt har ingen tilsvarende tabell), så en ekte dedup
  ville krevd en ny tabell.
- **Et mål uten frist gir ingen dato**, og faller helt ut av `readActiveWeightGoal`
  — også for andelen, som ellers kunne brukt baselinen. Et mål uten `endDate` er
  uansett ikke noe `projectGoal` kan uttale seg om.
- **Måloppnåelse på et mål som bare finnes i `goals`** (uten et tall i
  terskelarket) gir ingen «nådd»-beskjed: `below-goal` leser
  `metricSettings.weight.goal`, og `goalDateNugget` tier med vilje når målet er
  passert.
- **Runde tall er ikke rangert etter hvor runde de er.** «Under 90» er en større
  nyhet enn «under 94», men begge behandles likt.
- Krydderet finnes bare i pushen. Google Chat-fallbacken for vekt finnes ikke
  (bare for økter), og Ekko har ingen vekt-varsling.
- `HealthKit`-vektbackfillen og manuelle veiinger gir ingen push i det hele
  tatt — varslingen henger på Withings-synken.
