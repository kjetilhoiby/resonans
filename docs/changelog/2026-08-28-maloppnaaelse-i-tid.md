# Måloppnåelse i tid: datoen framfor tilstanden

Dato: 2026-08-28
Status: ferdig

## Kontekst

To observasjoner fra måloversikten, begge med samme rot: kortet snakket om
verdier der spørsmålet handlet om tid.

1. **Et nådd mål ble tegnet som om det akkurat kom i mål.** «Løpe 80 km i
   august» sto på 103,7 km, men kurven flatet ut på 80 og lå på taket resten av
   måneden.
2. **Estimatet svarte på feil spørsmål.** Et mål om 85 kg innen juni 2028 fikk
   «Estimat ved dagens snitt: ~70,4 kg (14,6 kg under mål)» — en ekstrapolasjon
   av dagens tempo tjue måneder fram. Ingen fortsetter å gå ned et halvt kilo i
   uka i to år, og selv om noen gjorde det, er ikke 70,4 kg det man lurer på.
   Man lurer på **når** man er på 85.

## Faser

### Fase 1: Grafen slutter ikke på måltallet

`GoalTrajectorySection` sendte `maxValue={sensorProgress.targetKm}` til
`TrajectoryChart`, og charten klipper verdier mot domenet (`clamp` i `yAt`).
Alt over målet ble derfor tegnet PÅ målet: en måned med 30 % overoppfyllelse så
ut som en måned som akkurat kom i mål og så stoppet.

Taket følger nå det høyeste av mål og faktisk verdi, og måltallet beholder sin
egen rutelinje — det er den man måler mot. Rutelinjene dedupliseres, ellers
tegnes samme etikett to ganger så lenge målet ikke er passert.

### Fase 2: Dagen målet ble nådd

`TrajectoryChart` fikk `reachedDate`: en loddrett markør i seriens egen farge,
med etiketten «Nådd 19. aug.». Heltrukken og farget, i motsetning til
i-dag-linja som er stiplet og grå — to loddrette streker med samme uttrykk ville
vært to streker uten betydning.

Måloppnåelsen leses av **serien**, ikke av dagens verdi: «nådd» er en dato, og
den ligger i historikken. Et mål som ble nådd og siden mistet (vekta opp igjen)
har fortsatt en dag det ble nådd, så vi leter etter første passering.

### Fase 3: Datoen som estimat

`$lib/domain/goals/goal-projection.ts` regner begge veier:

- `reachedOn` + `reachedDaysBeforeDeadline` — når, og hvor tidlig.
- `projectedDate` + `projectedDaysBeforeDeadline` — når man er der på dagens
  tempo, og hvordan det står mot fristen.

`describeGoalProjection` skriver setningen, med forbeholdene i seg: «På dagens
tempo er du der rundt 7. juli 2027 — 12 måneder før fristen.»

**To målformer, to spørsmål.** Et volummål («løp 80 km i august») har vinduet
som poeng — august slutter uansett, og summen ved fristen er det interessante.
Et tilstandsmål («ned til 85 kg innen juni 2028») har tilstanden som gitt, og
da er datoen estimatet. Formen kan ikke utledes av tallene: begge har en
startverdi, en målverdi og to datoer. Kalleren sier hvilket spørsmål målet
stiller.

Er målet nådd, vinner datoen uansett form — «estimat ~111 km» er en påstand om
noe som alt er avgjort.

### Fase 4: Vurderingen får det samme

`buildGoalAssessmentInput` i `/plan/mal` bygger teksten den AI-genererte
fremdriftsvurderingen leser. Uten projeksjonen så modellen bare «estimat ved
dagens snitt: ~70,4 kg» og gjentok ekstrapolasjonen. Nå får den den samme
setningen som skjermen — samme regel som ellers i repoet: to veier til samme
tall driver fra hverandre.

## Beslutninger

- **En dato som ikke finnes, skal sies med ord.** Går utviklingen motsatt vei,
  står den stille, eller ligger datoen forbi `MAX_PROJECTION_DAYS` (ti år), er
  svaret «utviklingen går motsatt vei» eller «for lite bevegelse til å anslå en
  dato» — ikke en tom linje, og ikke et tall som er en divisjon framfor et
  estimat.
- **Datoen er ærligere enn verdien nettopp fordi den avslører seg selv.** Et
  vekttall på 70,4 kg ser presist ut uansett hvor gal forutsetningen er; en
  dato i 2031 ser gal ut med en gang.
- **Spennet sies med ord, ikke i dager.** «12 måneder før fristen» framfor «361
  dager før fristen»: presisjonen i det andre tallet er falsk, siden hele
  estimatet hviler på at dagens tempo holder.
- **Markøren for måloppnåelse er heltrukken og farget.** I-dag-linja er stiplet
  og grå. Var de like, ville de vært to streker uten betydning.
- **Projeksjonen bor i domenelaget**, ikke i `components/domain/plan/helpers.ts`
  der `computePaceEstimate` ligger. Den er ren, testbar, og kan leses av et
  `query_*`-verktøy uten at noe importerer fra komponentmappa.

## Verifisering

- `npm test` — 3988 grønne. 16 nye på projeksjonen: begge retninger, første
  passering etter et tilbakefall, de tre grunnene til at en dato mangler, taket
  på ti år, og setningene.
- `npm run check` — 0 feil.
- Rendret `/design#dashboardkort` på 390 px: et volummål nådd 19. august med
  kurven som fortsetter til 109 km, og et tilstandsmål med datoestimat.

## Kjent rest

- Galleriets første mock var ikke selvkonsistent — `currentKm` var hardkodet til
  103,7 mens dagsverdiene summerte til 73, så målet ble aldri nådd og seksjonen
  viste ikke tilfellet den ble laget for. Summen utledes nå av dagene.
- Chatten har ingen `query_*`-inngang til projeksjonen. Fremdriftsvurderingen
  får den gjennom `buildGoalAssessmentInput`, men «når er jeg på 85 kg?» i en
  vanlig samtale svares fortsatt uten den.
- Andre måltyper (søvn, skjermtid, metrikk-mål) har egne evalueringer og er
  ikke koblet på projeksjonen.
