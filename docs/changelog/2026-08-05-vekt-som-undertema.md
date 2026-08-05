# Vekt som eget undertema

Dato: 2026-08-05
Status: ferdig

## Kontekst

Vekt lå på helse-mortemaet fram til nå, med en begrunnelse som står i
`2026-08-02-helse-mortema.md`: vekt er *utfallsmålet* de andre grenene driver, ikke
en gren for seg. Brukeren snudde den: «I høst vil nok det være mitt fokus like mye
som trening og søvn.»

Det er en god grunn til å snu. Et fokusområde trenger tre ting mortemaet ikke kan
gi: sin egen historikk, sine egne milepæler og sin egen graf. Mortemaet viser
sammenhenger — det er hele arbeidsdelingen — og en flate som viser *én* metrikk i
dybden hører per definisjon på et undertema.

Bestillingen hadde to halvdeler: oppmuntrende setninger som utnytter dybden i
historikken («største nedgang siden …», «laveste måling siden …»), og en fleksibel
visualisering.

## Faser

### Fase 1: Hierarkiet

Ny `DashboardKind: 'weight'`. Termene `vekt`, `weight` og `kropp` er **flyttet** fra
health-matcheren til en ny weight-matcher, plassert etter health i
`THEME_DASHBOARD_MATCHERS` — rekkefølgen bevarer at «Helse og vekt» beholder
mordashboardet, mens «Vekt» alene nå får sitt eget.

`HEALTH_SUBTHEMES` har seks navn, med Vekt mellom Ernæring og Egenfrekvens.
Provisjoneringen (`ensureHealthSubthemes`) og `HEALTH_FAMILY_KINDS` følger av
lista og trengte ingen endring.

**En felle her:** `buildSubthemeTiles` slår opp builder på *navn*
(`BUILDERS[subtheme.name]`). Et nytt navn uten builder gir «is not a function» på
hele mor-flaten, ikke en tom flis. Det er nå en vakt som logger og returnerer en
tom flis i stedet.

Ernæringsflisen mistet samtidig fallbacken til vektendring. Den fantes fordi vekt
var det eneste tallet flisen hadde før inntaksloggen; nå ville den vist samme tall
som naboflisen.

### Fase 2: Serien med trend (`weight-series.ts`)

Trenden er et **etterslepende** sjudagerssnitt, ikke et sentrert. Et sentrert snitt
kan ikke regnes for de tre siste dagene, og det er nøyaktig der man ser. Prisen er
etterslep; den er verdt det.

- `MIN_TREND_SAMPLES = 3` — uten det er «trenden» lik den ene målingen i vinduet.
- Hull gir null, aldri en verdi. `MAX_TREND_GAP_DAYS = 10` bryter linja ved tegning.
- `seriesForRange` regner trenden på **hele** historikken før den klipper til
  perioden. Motsatt rekkefølge ville gitt en 30-dagersgraf uten linje den første uka.
- `filterByRange` måler bakover fra **siste måling**, ikke fra i dag: har du ikke
  veid deg på tre uker, skal «siste 30 dager» ikke være ni dager data og tre uker
  tomt felt.
- Lavpunktet er trendens, ikke en enkeltmålings, og hentes fra hele historikken
  også når man ser på 30 dager — «det minste av de tretti» er ikke et lavpunkt.

### Fase 3: Milepælsmotoren (`weight-milestones.ts`)

Ni typer, rangert, maks tre vist. Fire vakter holder dem ærlige:

1. **Rekorder regnes på trenden.** Rå-rekorden finnes også, men rangeres under, og
   droppes helt når den handler om samme periode som trend-rekorden — to setninger
   om samme hendelse leses som to hendelser.
2. **`MIN_RECORD_SPAN_DAYS = 30`.** «Laveste på ni dager» er ikke en milepæl.
3. **Nedgang må overstige `MEANINGFUL_DROP_KG` (0,5)**, og de historiske vinduene
   den sammenlignes med må ikke overlappe det nåværende. Uten det ville et jevnt
   fall gitt «bratteste 90 dager siden for to uker siden» — en periode sammenlignet
   med seg selv.
4. **Kroppssammensetningen kan avlyse feiringen.** Er mer enn halve nedgangen
   muskel, faller tonen til nøytral og setningen sier det. Bruker
   `describeCompositionChange`, som alt fantes.

Atferdsmilepælene (`weigh-in-streak`, `weigh-in-coverage`) er der fordi en motor
som bare feirer synkende vekt er stum i alle ukene vekta stiger — altså akkurat når
man trenger å høre noe. De handler om noe man kontrollerer, og er sanne uansett
retning.

Er siste veiing eldre enn `MAX_STALE_DAYS` (10), stopper alle rekordene og kortet
sier hvorfor. En rekord er en påstand om *i dag*.

### Fase 4: Server og endepunkt

`loadWeightDashboardData` leser `sensor_events` med `dataType: 'weight'` gjennom
`normalizeBodyComposition` — obligatorisk, siden historiske rader har
fettPROSENT i `data.fatMass` tross navnet. Målvekta leses fra mortemaets
`metricSettings.weight.goal` via en ny delt `readHealthMetricSettings`
(søvn-dashboardet hadde en privat kopi og bruker nå den delte).

**Milepælene ser ti år bakover, grafen tre.** Dagene sendes over nettet og caches i
localStorage, og ti år med daglige veiinger er nesten en megabyte JSON for å tegne
en linje. Konsekvensen er at en setning kan peke på en dato utenfor grafens
rekkevidde — `milestonesReachBeyondChart` lar flaten si det, framfor at setningen
gjøres dårligere for å matche grafen.

Rene funksjoner (`toWeightMeasurements`, `summarizeCompositionChange`) ligger i
`domain/health/weight-measurements.ts`, ikke i den db-koblede fila, slik at de kan
testes uten å mocke en database.

### Fase 5: Flaten

Tre kort, i den rekkefølgen brukeren spør: **status** («hvor står jeg») →
**milepæler** («hva betyr det») → **graf** («vis meg»). Milepælene står *før*
grafen fordi de er svaret; grafen er belegget.

- `WeightStatusCard` leder med den **målte** vekta og setter trenden ved siden av.
  Et hovedtall brukeren ikke kjenner igjen fra badet er et hovedtall hun ikke
  stoler på.
- `WeightMilestonesCard` formulerer ingenting selv — setningene kommer ferdige fra
  domenelaget, der vaktene har tester. Tonen bæres av prikk *og* ordlyd, aldri av
  farge alene.
- `WeightTrendChart` er den fleksible visualiseringen: fem perioder
  (30 d / 90 d / 6 mnd / 1 år / alt) × fem metrikker (vekt, fettmasse, fettprosent,
  muskelmasse, fettfri masse), alt klientside uten refetch. Metrikker uten en
  eneste måling kan ikke velges.

## Beslutninger

**Både rå målinger og trend tegnes.** Punktene er sannheten, linja er signalet. Å
vise bare trenden skjuler at målingene spriker et helt kilo på væske alene, og en
bruker som ikke vet at ±1 kg er normalt leser hver svingning som en beskjed. Å vise
bare punktene gir et støybilde man ikke kan lese retning ut av. Sammen lærer de hva
som *er* støy, og det er halve verdien av grafen.

**Én måling, én akse.** Ingen dobbel y-akse her — det er samme enhet hele veien.
Trenden bærer appens vektfarge (`#e8e2d4`, samme som vektoverlayet i
ernæringshistorikken) og de rå punktene samme farge dempet, fordi det er samme
måling. Mållinja er blå og **stiplet**: en referanse, ikke en måling, og formen sier
det før fargen gjør. Validert mot #141414 — kontrast over 3:1 for begge, ΔE 30,6
under protanopi.

**x-aksen er tidsproporsjonal.** To uker uten veiing skal være et bredt tomrom, ikke
to punkter ved siden av hverandre. Datoetikettene fordeles over *tiden*, ikke over
punktene.

**Aksen har et gulv** (`MIN_AXIS_SPAN`, 1,5). Samme lærdom som
`MIN_WEIGHT_AXIS_SPAN_KG` i ernæringshistorikken: en akse som strekkes til
målingene forvandler tre hundre gram til et stup.

**Ingen manuell veiing.** Vekta gjør jobben. Et skjema for å skrive inn kilo ville
vært et skjema ingen bruker, og en kilde som kan sprike fra sensoren.

## Funnet under bygging

**Milepælen brukeren ventet på fyrte aldri.** Første utgave lette etter forrige gang
du var «like lav eller lavere» (`<=`) og lot det stå som platå-vakt. Men en jevn
nedgang på 0,75 kg i måneden gir en trend som — avrundet til én desimal — står
stille i tre-fire dager i strekk. Referansedatoen ble «for tre dager siden», spennet
falt under terskelen, og `lowest-trend` ble filtrert bort. Nettopp denne brukeren,
med jevn nedgang over en høst, ville aldri sett den.

Rettet ved å skille de to tingene `<=` prøvde å gjøre samtidig: referansen finnes
med streng `<` («forrige gang du var LAVERE»), og platå stoppes av
`RECORD_MARGIN_KG` — trenden må ha falt minst 0,2 kg den siste måneden. Avrunding
påvirker ingen av dem. Egen regresjonstest.

**Aksen sløste bort en tredjedel av feltet.** Med data 80,8–83,4 og mål på 80 ble
grafen tegnet 78–84. To feil samtidig: luften ble lagt rundt *midtpunktet* av et
bredere spenn framfor rundt dataene, og steget rundet alltid *opp* til neste pene
tall (1,02 → 2). Nå legges luften symmetrisk om dataene, og steget velges som
nærmeste pene tall i log-rom — som er det et menneske ville valgt.

**«200 % av endringen er fett.»** Første kall mot en ekte database ga
`fatShare: 2` — vekta ned 0,2 kg, fettet ned 0,4, muskelen opp 0,1. `fatShare` er
fettendringen delt på vektendringen, og den er bare en *andel av* når begge peker samme
vei og fettet ikke falt mer enn totalen. Kortet formaterte den rett som en prosent.

Tilfellet er ikke en datafeil — det er det beste utfallet man kan ha, og fortjener sin
egen setning. Tolkningen ligger nå i `interpretCompositionChange` i domenelaget, med
fem grener og tester, framfor i en malstreng.

**Tre etikettkollisjoner**, funnet ved å faktisk rendre kortene i Chromium framfor å
lese koden: mållinjas etikett kolliderte med sluttpunktet i høyre kant (flyttet til
venstre ende), lavpunktsmerket kolliderte med sluttpunktet når du står på lavpunktet
(merket droppes innen fem dager fra siste måling), og «3. aug» ble klippet av kanten
(ytterste datoetiketter ankres innover). Etikettene har nå også halo i flatefargen,
samme prinsipp som ringen rundt sluttpunktet.

## Verifisering

- `npm run check`: 0 feil, 0 advarsler.
- `npm test`: 2577 grønne (fra 2494), 83 nye — 27 for serien, 35 for milepælene, 16 for
  måling/tolkning, pluss fem oppdaterte i flis- og registerprøvene.

**Mot en ekte database** (lokal Postgres, 455 veiinger over 500 dager, med
legacy-formaterte rader i den eldste tredjedelen):

```
GET /api/tema/<vekt>/dashboard/weight → 200, 59 kB
  455 dager · historikk 500 dager · nok historikk: ja · målvekt 80
  Snittvekta på 81,4 kg er den laveste vi har målt — 1 år og 4 måneder med historikk.
  Ned 2,7 kg på 365 dager — den bratteste 365-dagersperioden vi har målt.
  8 dager på rad med veiing.
```

Legacy-raden fra 2025-03-24 hadde `fatMass: 23.6` (altså prosenten) og kom ut som
`fatRatio 23,6` / `fatMassKg 20,4` — normaliseringen virker på gamle rader.

Mor-flatens undertema-stripe viser Vekt-flisen med nivået som hovedtall
(`82,0 kg · 0,0 kg på 30 dager`), og `/tema/vekt?tab=data` rendret i Chromium med alle
tre kortene, fem faner og riktig hue — ingen konsollfeil.

**Gjenstår:** visuelle baselines. `dashboardkort`-seksjonen har seks nye demoer, og
`hjem` og `tema-helse` får en sjette undertema-flis. Chromium her er build 1194 mot
`@playwright/test`s forventede 1223, så en oppdatering fra dette miljøet ville
skrevet feil baselines.

**Ikke gjort, bevisst:** chatten kan ikke lese milepælene. `query_metrics` dekker
vekt som tall alt, men et `query_weight_milestones`-verktøy ville vært en tredje
inngang til samme setninger. Verdt å vurdere når flaten har vært i bruk en stund.
