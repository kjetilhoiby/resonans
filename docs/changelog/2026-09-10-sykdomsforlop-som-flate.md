# Sykdomsforløpet som flate: én tidsakse, seks signaler

Dato: 2026-09-10
Status: ferdig

## Kontekst

En sykeperiode har siden september 2026 vært en rad som unnskylder streak-dager,
og et kort på Helse som sier «er jeg syk nå». Det svarer ikke på spørsmålet man
faktisk sitter med underveis og etterpå: **hva har skjedd med kroppen siden dette
begynte?**

Utløseren var et konkret forløp: en uke etter at det begynte, og etter et par
dager på bedringens vei, ble brukeren dårligere igjen — hodepine, trykk i
bihulene. Lite bevegelse, og vekta hadde falt. Alle tallene som beskriver det lå
i basen, spredt over fire flater med hver sin tidsakse, og ingen av dem visste at
det pågikk et forløp.

Sammenligningen brukeren selv gjorde er den riktige: **en ferie eller en tur er
alt en flate som samler helsedata over en avgrenset periode** (`TripHealthStats`).
Et sykdomsforløp er samme form.

## Faser

### Fase 1: Reglene, rent

`src/lib/domain/health/sick-episode.ts` (+ 30 tester). Ingen DB, ingen henting.

- `buildEpisodeWindow` — baselinedager før onset, sykedagene, og dagene etter.
- `buildEpisodeTrack` — én rad: punkter per dag, baseline, avvik, dekning, setning.
- `episodeAxis` — y-spennet med gulv per rad.
- `findRelapse` / `describeLevelCourse` — forløpets form av de selvrapporterte nivåene.
- `buildSymptomBars` — symptomene klippet til den samme aksen.
- `describeEpisode` — overskriften.

### Fase 2: Datainnhentingen

`src/lib/server/health/sick-episode.ts` mater domenelaget gjennom de delte
leserne — `readWeightDays`, `readNightlyPhysiology`, `readSleepNights`,
`loadTemperature`, `listSymptoms` — pluss to nye:

- `readDailyMinHeartRate` (`daily-heart-rate.ts`), dagens laveste puls fra
  `activity`. Egen fil fordi den er en KILDE, ikke en beregning, og fordi neste
  kaller ellers skriver den på nytt.
- `listSickLevels` i `sick-log.ts`, nivåmålingene som serie. `lastSickLevel`
  svarte bare på «forrige», som er alt innsjekken trengte.

### Fase 3: Flaten

`/helse/sykdom/[id=uuid]` med `SickEpisodeView` + `SickEpisodeTrack`. Lenket fra
`SickStatusCard`: «Se forløpet →» på den aktive perioden, «Forløp» per rad i
historikken. Egen `/design/flater`-seksjon med mock bygget av de ekte
domenefunksjonene.

## Beslutninger

- **Felles x-akse, separate y-akser.** Hele poenget: «vekta stupte samtidig som
  sovepulsen steg» kan bare LESES når samme dato ligger på samme piksel — samme
  begrunnelse som at livvidde tegnes inni `WeightTrendChart`. Derfor kommer
  `days` fra vinduet og sendes ned i hver rad; radene regner ikke sin egen akse.
  Y-aksene er derimot uavhengige, fordi kg, slag/min og timer ikke har en felles
  skala (samme lærdom som vekt mot energi).
- **Baselinen er de fjorten dagene FØR, ikke historikken.** Et forløp spør «hvor
  mye flyttet dette seg», og referansen må være det du var like før. Fjorten
  dager er valgt mot kadensen til de tynneste seriene, ikke mot statistikk. Under
  `MIN_BASELINE_SAMPLES` (3) oppgis INGEN avvik — bare tallet, og hvorfor det
  ikke sammenlignes.
- **Dagene ETTER perioden er med.** «Kom vekta tilbake?» er spørsmålet man har
  når forløpet er over, og uten dem kan flaten ikke svare. De stopper ved i dag:
  en tom kolonne i høyre kant leses som et hull i dataene, ikke som framtid.
- **Én kilde per rad, navngitt.** Dagpuls leses BARE fra `activity.hr_min`.
  Punktpulsen vekta måler er tatt stående og ligger 5–15 slag høyere, så en serie
  som blandet dem ville vist et hopp på veiedagene som ser ut som en endring i
  kroppen — nøyaktig fella `heart-rate-baseline.ts` finnes for.
- **Hudtemperatur vises som AVVIK, aldri absolutt.** Flagget
  `absoluteIsMeaningless` på radspesifikasjonen er kontrakten: uten baseline sier
  raden det, framfor å falle tilbake på råtallet. Håndleddstemperatur har ingen
  normtabell, og 34,8 °C ser autoritativt ut uten å være det.
- **Nivået er ryggraden, ikke en av seks like rader.** Det er det eneste signalet
  ingen sensor kan hente, og dermed det eneste som kan si «jeg ble bedre og så
  dårligere igjen». Derfor står `levelText` og et eventuelt tilbakefall over
  grafene.
- **`RELAPSE_DROP` er 2, ikke 1.** Skalaen har fem trinn, og ett hakk er
  vingling — 3 → 4 → 3 er en middels dag, ikke en vending. Krever vi to, betyr
  ordet «tilbakefall» noe. Prisen er at et langsomt tilbakefall over mange dager
  kan gå under radaren; kurven viser det uansett. Toppen må dessuten ha ligget
  over et tidligere lavpunkt — ellers ville hver periode som begynner høyt og
  faller vært et «tilbakefall», og det er bare å bli syk.
- **Ingen dom, ingen forklaring.** Vi sier hva som er målt og hvor mye det
  avviker. Ingen «feber», ingen «dehydrering», ingen «normalt varer». Radene med
  `risingIsNotable` får en dempet gulfarge på tallet, aldri varselfarge —
  akutt/kronisk er fortsatt det eneste signalet som får uttale seg om kroppen.
- **Vektraden bærer sitt eget forbehold** (`WEIGHT_CAVEAT`), på raden og ikke i
  en hjelpetekst: et tall man ikke skal sammenligne ser nøyaktig ut som et tall
  man skal sammenligne. Samme grunn som at måleprotokollen står i
  livvidde-kortet.
- **En rad uten en eneste måling filtreres bort.** Et tomt spor ser ut som en
  feil; en sensor brukeren ikke har er ikke et hull å forklare.
- **Dekningen står under hver rad** («4 av 10 sykedager målt»). Et snitt uten
  nevner ser like sikkert ut enten det hviler på ni netter eller tre.

## Verifisering

- `npx vitest run` — 4708 tester i 322 filer, alle grønne. 30 av dem er nye og
  dekker vindu, baseline, hull, dekning, akse-gulv, tilbakefall og
  symptom-klipping.
- `npm run check` — 0 feil.
- `npm run build` — grønn.
- **Ikke verifisert:** `npm run test:visual` krever database og dev-server, som
  ikke finnes i dette miljøet. `sykdomsforlop` er lagt til i `flateSections`, så
  baselinen må genereres én gang med `npm run test:visual:update`. Flaten er
  heller ikke sett mot ekte data — mocken er bygget av de ekte
  domenefunksjonene, men `activity.hr_min` og `body_temperature` er ikke
  bekreftet å finnes i prod for denne brukeren (temperatursynken har aldri kjørt
  mot ekte Withings-data, se changeloggen for symptomer og temperatur).

## Kjent rest

- **Vekt-krydderet vet ikke om sykeperioder.** `weight-nugget.ts` kan sende
  «Laveste snittvekt vi har målt» om et fall som skjedde under et forløp — altså
  feire noe som ikke er framgang, og som kommer tilbake. Gaten finnes ikke; den
  ville vært `getSickState().active` i `buildWeightNugget`, men om den skal
  UNDERTRYKKE varselet eller bare merke det er en beslutning som ikke er tatt.
- **Bevegelse er ikke en rad.** Økter og effort er den mest direkte målingen av
  «ute av stand til å trene», og de ligger klare i `readDeduplicatedWorkouts` og
  effort-budsjettet. Utelatt her fordi de er en mengde per uke, ikke en verdi per
  dag, og en rad som er 0 på ti av ti dager sier mindre enn setningen
  «budsjettgulvet var 0 fordi du var syk» som effort-flaten alt har.
- **Chatten kan ikke lese et forløp.** Det finnes ikke noe `query_*`-verktøy over
  `loadSickEpisode`, så «hvordan gikk det forrige gang jeg var syk?» må fortsatt
  besvares av `query_sensor_data`-rader. Briefingen har nå-tilstanden, ikke
  historikken.
- **Ingen sammenligning mellom forløp.** «Er dette verre enn i februar?» krever
  at to forløp legges oppå hverandre — `cycle-series.ts` er motoren som gjør det
  for år, og formen ville vært den samme.
- `RECOVERY_DAYS` (7) er en gjetning på hvor lenge man er interessert i
  etterspillet, ikke en måling.
