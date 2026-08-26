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

### Fase 6: Dagsbilder er alltid kilden

Brukeren opplyste at hen **alltid** tar dagsbilder, aldri ukesbilder. Det flytter
hvor risikoen ligger: forbeholdet om dager uten time-for-time blir uaktuelt, mens
vision-lesingen av timegrafen blir det ENESTE som avgjør om filtreringen virker.
To deler av den lesingen var ustyrt, og begge feiler stille.

1. **Taket.** Prompten sa bare «les time-for-time-grafen så godt du kan». Leser
   modellen en stolpe som treffer 60-minutters-taket som 50, faller den under
   terskelen på 57 og filtreringen gjør ingenting — uten en feilmelding. Y-aksen i
   dagsvisningen står alltid på 60 (en klokketime kan ikke inneholde mer), så
   regelen kan gjøres eksplisitt: en stolpe som når taket ER 60.
2. **Fargene per time.** Prompten inviterte til å utelate dem
   («Hvis kategorifargene ikke kan skilles per time, utelat …»). Uten dem er
   `socialHourly` fraværende, `passiveSocialMinutes` blir 0, og scrollingtallet
   står ufiltrert ved siden av en filtrert total — 7t 53m mot 1t 53m på
   brukerens 24. august. Prompten ber nå om fargene per time, og tillater å
   utelate dem for en ENKELT stolpe som er for liten, aldri for hele grafen.

Fordi lesingen likevel kan svikte, er utfallet gjort synlig framfor antatt:
`AttentionDay.socialFilterable` skiller «0 vi har målt» fra «0 vi ikke har målt»,
`WeekAttention.socialFiltered` løfter det til uka, kortet merker scrollingtallet
«ufiltrert — se under», og `describeAttention` sier hvor mange dager det gjaldt.
Verktøysvaret bærer `filtered.socialFiltered` med samme betydning.

I tillegg: **«Mest brukt» var helt dødt** for den som bare laster opp dagsbilder.
Seksjonen leste `screen_time_week`-eventets applister, som aldri finnes da. Den
summerer nå dagsbildenes egne applister og merker seg selv «summert fra
dagsbilder» — og det er nettopp den lista man trenger for å velge hvilke apper som
ikke skal telle.

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

- `npm test`: 3933 tester grønne (55 nye).
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
  Gjelder ikke denne brukeren, som alltid tar dagsbilder.
- **Prompt-endringene er ikke målt mot ekte skjermbilder.** Både taket-regelen og
  fargene per time er skrevet ut fordi de er løsbærende, men ingen kjøring mot de
  fem faktiske bildene er gjort (krever `OPENAI_API_KEY`). `socialFiltered` gjør
  utfallet synlig på flaten, så en svikt melder seg selv framfor å bli stille — men
  første ekte opplasting er verifikasjonen.
- **«Mest brukt» er avkortet i skjermbildet.** Ligger en ignorert app under
  topplista for dagen, blir den ikke trukket fra den dagen.
- **Løpeturer kunne matches mot egne økter.** Vi vet fra `canonical_workouts` når
  brukeren løp; en overlapp mot skjermtimene ville truffet Ekko-minuttene mer
  presist enn en appliste. Ikke bygget — applista er etterprøvbar for brukeren, og
  en overlapp er et anslag.
- Månedlige og årlige aggregater filtreres på samme vis gjennom
  `attentionForPeriods`, men er ikke gjennomgått på flatene.
