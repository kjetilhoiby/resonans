# Skjermtid: oppmerksomhet er ikke det samme som at skjermen sto på

Dato: 2026-08-26
Status: ferdig

## Kontekst

Brukerens egen beskrivelse: «Sliter litt med at jeg sovner fra telefonen med
skjermen på, eller at jeg løper 30–60 minutter med skjermen (ekko) på for tida.
Det er vanskelig å følge skjermtid.» Forslaget som fulgte var konkret: kan vi
filtrere vekk 100 %-timer?

Fem dagsbilder fra iOS Skjermtid viser hvor stort det er. 24. august sto timene
00–05 alle på 60 av 60 minutter — seks fulle timer av dagens **13t 24m**. 21.
august: fire fulle timer 00–04 av 10t 21m. 25. august: tre. Toppappen er
Instagram med 7t 12m på en dag der Sosialt er 7t 53m, altså er nattetimene
sosiale medier man har scrollet seg i søvn til. Med det inne er tallet på
skjermen ikke et mål på oppmerksomhet, og en flate som ikke måler noe man kan
handle på blir ikke åpnet.

De to mønstrene brukeren beskriver krever **ulike mekanismer**, og det er derfor
de er to felt og ikke ett:

- **Sovnet fra telefonen** kan leses ut av timeprofilen. Ingen konfigurasjon
  trengs — dataene sier det selv.
- **En app som kjører mens man gjør noe annet** kan ingen timeprofil avsløre. En
  løpetur med coachen på er 30–60 minutter der skjermen er på og blikket er
  andre steder, og bare brukeren kan si at Ekko ikke teller.

## Faser

### Fase 1: Ren domenemodul + tester

`src/lib/domain/health/screen-time-attention.ts` (ny), 46 enhetstester.

- `findPassiveRuns` finner rekker av «fulle» timer. `FULL_HOUR_THRESHOLD_MINUTES`
  er **57, ikke 60**: timeprofilen leses av GPT-4o fra søylehøyder i et
  skjermbilde, så en søyle som traff taket kommer tilbake som 57–63.
- `MIN_PASSIVE_RUN_HOURS` er **2**. Én full time er en film; to eller flere på rad
  er skjermen som står på. Brukerkonfigurerbar 2–6.
- `computeAttentionDay` trekker fra i rekkefølge: passive timer først, appfradraget
  kappet mot det som er igjen.
- `buildAttentionDays` kobler nabodagene sammen, `buildWeekAttention` legger
  fradragene på iOS' eget ukesnivå, `describeAttention` skriver setningen.

### Fase 2: Innstillinger med én skrivevei

`metricSettings.screenTime` på Helse-mortemaet, gjennom
`$lib/server/health/screen-time-settings.ts` og
`GET/PUT /api/sensors/screen-time/settings`. Feltene: `filterPassiveHours`,
`minPassiveRunHours`, `ignoredApps`.

Skrivingen bevarer nøkler arket ikke eier — samme regel som
`PUT /api/tema/[id]/metric-settings`, av samme grunn.

### Fase 3: Flaten

`loadScreenTimeDashboardData` beregner oppmerksomhetstid **ved lesing** og legger
`attention` på hver uke, pluss `attentionMinutes`/`passiveMinutes` per dag.
Målene evalueres mot det filtrerte grunnlaget, og både denne uka og uka før måles
på samme grunnlag.

`ScreenTimeCard` fikk en toggel: **Oppmerksomhet** (standard) mot **Slik iOS
teller**. Visuelt språk: **dempet/skravert = filtrert bort**, og søylene beholder
rå høyde, så natta man sovnet fra telefonen blir *synlig* framfor bare å
forsvinne. Under tallet står én setning om hva som ble trukket fra, og hvor mange
dager som manglet time-for-time.

`ScreenTimeDashboard` fikk seksjonen «Hva skal ikke telle?»: av/på,
rekkelengde, og avkryssing per app fra `knownApps` (alt vi har sett i vinduet).

### Fase 4: Chatten og widgetene svarer det samme

- `query_sensor_data` med `metric='screen_time'` returnerer de filtrerte tallene
  på alle fire stiene (latest, summary, trend, rå-fallback), med iOS' tall under
  `filtered.rawMinutes`. Verktøybeskrivelsen sier hva feltet betyr og at dager
  uten time-for-time ikke er filtrert.
- `/api/widget-data/[id]` fikk en egen rad-lesende sti for `screen_time`, siden
  den generiske SQL-stien aggregerer `data->>'totalMinutes'` rått i basen.
- `detectPromptFocusModules` fikk `scroll`, `mobilbruk` og `telefonbruk`.

### Fase 5: Galleriet

`/design` viser den nye tilstanden med tre netter som «sovnet fra telefonen».
Fixturen bygges FRA timeprofilene, og oppmerksomhetstiden regnes med de samme
funksjonene flaten bruker.

## Beslutninger

- **Filtreringen skjer ved LESING, ikke i `sensor_aggregates`.** Legger brukeren
  en app i ignoreringslista, skal historikken endres med — uten en
  reberegningsjobb. Lagret i aggregatet ville hver eldre uke stått på gammel
  regel til noen kjørte om, samme felle som lagret `effortScore`.
  Aggregatet betyr derfor fortsatt «det iOS rapporterte», som er stabilt.
- **Fradraget er det nye; nivået er fortsatt iOS'.** Ukesbildet er autoritativt
  for ukestotalen og kan avvike fra summen av dagsevents. Bygde vi et eget nivå av
  dagene, ville flaten hatt to konkurrerende ukestotaler som begge ser plausible
  ut — og de ville sprikt nettopp i ukene der data mangler. Snittet skaleres med
  samme brøk framfor å regne nevneren på nytt.
- **Rekka skjøtes over midnatt.** Sovner man 22:30 og skjermen slukker 01:10, er
  hver av dagene bare én full time — under terskelen — mens rekka i virkeligheten
  er to. Uten naboderne er nettopp innsovningen usynlig for regelen. Skjøtingen
  krever **kalendernaboer**: en liste som mangler 24. august gjør ikke 23. til nabo
  av 25., for da skjøtes rekka over en natt vi ikke har målt.
- **Bare hele timer, ikke de delvise kantene.** Sovner man 23:40 er time 23
  delvis; den står. Å under-filtrere er trygt, å filtrere bort en time brukeren
  faktisk brukte er ikke.
- **Appfradraget rører ikke kategorisplitten.** Skjermbildet sier ikke hvilken
  kategori en app hører til, så vi kan ikke vite om Ekkos minutter var Sosialt.
  Flaten sier det i klartekst framfor å gjette.
- **Passive timer og apper trekkes aldri fra samme minutt.** Appfradraget kappes
  mot det som er igjen etter passivfiltreringen; ellers ville en app som kjørte
  inne i en passiv time blitt trukket to ganger.
- **Ingen apper ignoreres som standard.** At Ekko ikke er skjermtid er brukerens
  utsagn, ikke vår slutning. Passivfiltrering er derimot på: den leser dataene.
- **Ingen påstander om søvn.** En full time betyr at skjermen sto på. Vi kaller
  det «passiv», ikke «sov» — vi måler skjermen, ikke brukeren.
- **Grafen bytter grunnlag med toggelen.** Begge akkumulerte serier sendes ned.
  Med bare den ene ville toggelen endret overskriften og latt grafen stå, og
  legenden ville sagt 33t 8m rett under et tall på 24t 8m. Referanselinjene og
  «forrige uke»-søylene følger med — nattetimene er de høyeste, så en filtrert uke
  mot en ufiltrert forrige uke ser ut som et kraftig fall mot en uke som var like
  ille.
- **Skalaen i grafene står på de rå verdiene.** Søylene skal ikke endre høyde når
  man veksler visning; det som endrer seg er hva som er skravert.

## Verifisering

- `npm test`: 3927 tester grønne (49 nye).
- `npm run check`: 0 feil, 0 advarsler.
- `npm run build`: OK (adapter-node).
- Kortet rendret og inspisert i `/design` i alle tre tilstander (filtrert, rå,
  per time). Galleriet avdekket fire feil som ellers ville nådd prod:
  1. Akkumulert graf sto på filtrert grunnlag mens overskriften sa rå.
  2. «Forrige uke»-søylene sto ufiltrerte ved siden av de filtrerte.
  3. `.hour-stack` manglet `height: 100%`, så de skraverte timene var 0 piksler
     høye — regelen virket, men var usynlig.
  4. Klokkeslettene under timegrafen kolliderte med legenden (eldre feil).
- **Visuelle baselines er IKKE oppdatert.** En `--update-snapshots` i dette
  miljøet regenererte alle 22 design-baselines, også seksjoner endringen ikke
  rører — rendringen her avviker fra miljøet som lagde dem. `design-dashboardkort`
  og `tema-skjermtid` må derfor regenereres der baselinene hører hjemme.

## Kjent rest

- **Dager uten time-for-time kan ikke filtreres.** Et dagsbilde (Dag-fanen) må
  lastes opp per dag; ukesbilder gir bare dagstotaler. Flaten og verktøysvaret
  sier hvor mange dager det gjelder, men ukestallet er da delvis ufiltrert.
- **«Mest brukt» er avkortet i skjermbildet.** Ligger en ignorert app under
  topplista for dagen, blir den ikke trukket fra den dagen.
- **Løpeturer kunne matches mot egne økter.** Vi vet fra `canonical_workouts` når
  brukeren løp; en overlapp mot skjermtimene ville truffet Ekko-minuttene mer
  presist enn en appliste. Ikke bygget — applista er etterprøvbar for brukeren, og
  en overlapp er et anslag.
- Månedlige og årlige aggregater filtreres på samme vis gjennom
  `attentionForPeriods`, men er ikke gjennomgått på flatene.
