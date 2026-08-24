# Streak-historikk i bunnpanel, og streaks på temasidene

Dato: 2026-08-24
Status: ferdig

## Kontekst

Streak-kortene svarte på ett spørsmål — «hvor mange på rad nå» — og trykket på dem
navigerte til `/plan/rutiner`, altså til en liste over de samme kortene. Det neste
spørsmålet brukeren har er alltid «hva skjedde?»: når brøt den, hvor tett har det
egentlig vært, var forrige måned bedre. Et tall kan ikke svare på det.

Samtidig levde streakene bare på hjemskjermen. En løpestreak er et treningstall, og
åpner man Trening-temaet for å se på treningen sin, er «8 dager på rad» en del av
svaret — men man måtte tilbake til forsiden for å se om rekka fortsatt lever.

## Faser

### Fase 1: Historikken som kalender

`GET /api/streaks/[id]/history` gir dagene bak én streak, gjennom
`loadStreakHistory` i streak-tjenesten. Samme kilde, samme lookback-vindu og samme
`computeStreak` som telleren på kortet — kalenderen skal summere til tallet ved
siden av. En egen spørring med et annet vindu hadde gitt en kalender som ikke
stemmer med kortet den ble åpnet fra.

Egen rute framfor et felt på `/api/streaks`: dagslistene for alle streaks ville
ellers ligget i hver hjem- og temalasting uten at noen hadde åpnet et panel.

Kalenderen bygges rent i `$lib/domain/streak-history.ts`:

- **Radene ER periodene.** For `count_per_window` med sju dagers vindu grupperer
  streaken på mandag-ankrede uker, og `monthGrid` legger ukene som rader
  mandag–søndag. Hver rad bærer derfor periodens fasit («2 av 2 ✓»), og den regnes
  på **hele** historikken: en uke som krysser månedsskiftet viser samme tall i
  begge månedene.
- **Andre vindulengder får ingen periodemarkør.** Et 10-dagersvindu faller ikke
  sammen med kalenderrader, og en rad merket «1 av 2» for en periode den bare
  dekker halve er verre enn ingen merking.
- **Framtida er tom, ikke glemt.** En dag som ikke har vært, kan ikke være brutt.
  `isFuture` skiller den fra en dag man hoppet over, og dekningstallet nederst
  teller bare dager som er gått.
- **Antallet per dag bevares.** To løpeturer samme dag er to hendelser (det er
  slik ukesterskelen teller dem), og cellen får en ring framfor et nytt tall.

Periodegrensene deles med streak-motoren gjennom `windowIndex`/`windowStartDay`,
som nå er eksportert fra `streaks.ts`. En kalenderrad som dekket en annen uke enn
streaken teller i, ville vist et tall brukeren ikke kan kjenne igjen.

### Fase 2: Trykket åpner panelet

`StreakCard` fikk `onpress`. **Trykkflaten dekker ring + tekst, ikke hele kortet:**
`action` er ofte en knapp («Logg» på manuelle streaks), og en knapp inni en knapp
er ugyldig markup som nettleserne løser opp på hver sin måte. De to er søsken.

`StreakHistorySheet` bruker det delte `BottomSheet`-skallet og henter historikken
når det åpnes. Feil vises med melding fra `extractApiErrorMessage` — et `catch {}`
med «kunne ikke laste» gjør en prod-feil uløselig.

Panelet bærer også det kortet ikke har plass til: beste rekke (så historikken ikke
føles tapt ved brudd), hvor mange dager som er registrert i vinduet, og at tallene
regnes fra hendelsene framfor fra en lagret teller. Lenka til `/plan/rutiner` står
nederst, siden trykket på hjemskjermen tidligere gikk dit.

### Fase 3: Streaks på temasidene

`$lib/domain/streak-relevance.ts` avgjør hvor en streak hører hjemme, med to veier
inn:

1. **Eksplisitt `metadata.themeId`** — brukeren har bestemt seg, og det valget
   overstyrer. Det **utelukker** også andre temaer: har man koblet løpestreaken til
   «Maraton 2027», skal den ikke også stå på Trening.
2. **Utledet av kilden** — en `workout`-streak hører på trening, en
   `sensor_event`-streak der datatypen hører.

Utledningen treffer `DashboardKind`, ikke temanavn, fordi det er dashboardtypen
temasiden alt resolver seg til. Et tema som heter «Løping» får `training` uten at
en navneliste må vedlikeholdes i streak-koden.

Manuelle streaks utledes ingen steder. «Badevask» hører kanskje på Hjem, men å
lese det ut av tittelen treffer *nesten*, og et kort på feil tema er verre enn et
kort som ikke kommer.

`loadRelevantStreaks` filtrerer definisjonene **før** tilstanden regnes: relevansen
er ren og gratis, mens hver tilstand koster en spørring. Et tema uten relevante
streaks (film, økonomi) betaler bare for definisjonslista.

Chipen (`StreakChip` + `StreakStrip`) er streaken i kompakt form. På en temaside er
den en påminnelse i toppen, ikke det man kom for, og et bredt kort per streak ville
skjøvet dashboardet under falsen. Strippen står øverst i **oversikt-fanen**, som er
standardfanen for temaer med dashboard — og skjuler seg helt når ingenting er
relevant, siden en tom rad med et seksjonsnavn ser ut som noe som mangler.

### Fase 4: `month-grid` flyttet til domenelaget

`$lib/client/month-grid.ts` var ren måneds-matematikk under `client/` fordi
MonthCalendar var eneste kaller. Et domenemodul som importerer fra `client/` snur
lagene, så den ligger nå i `$lib/domain/month-grid.ts`.

### Fase 5: Se forbi «møtte opp» — fargefeltet i cellene

En kalender som bare viser at dagen ble holdt, skjuler forskjellen mellom en rolig
treningstur på tre kilometer og en hard tolv. For trenings-streaks bærer marken nå
tre kanaler over to akser:

    lyshet = tempo      lyst er fort, mørkt er rolig
    kulør  = distanse   gult er kort, rødt er langt
    areal  = distanse   samme akse igjen, i en kanal fargen ikke eier

Feltet interpoleres bilineært mellom fire hjørner, så en dag midt på skalaen havner
midt i feltet framfor i nærmeste hjørne.

**Lysheten er tempoets akse alene.** Fristelsen er å gjøre de lange dagene litt
mørkere også — det ser rikere ut. Da er lysheten ikke lenger tempo, og en lang rask
dag leses som roligere enn en kort rask. Kroma og kulør varierer med distansen;
lysheten aldri.

#### Runden om kulør-aksen

Første utgave droppet kulør-aksen og la distansen i arealet alene, etter
palettvalidatoren. Brukeren overstyrte: han er ikke fargeblind, dette er ikke
kritisk funksjonalitet, og en tjeneste skal være vakker og informativ også for den
som ser godt. Det er hans flate og hans kall — men rundens tall er verdt å beholde,
fordi de skiller det som er en smakssak fra det som var reelle feil.

Prisen ved kulør-aksen, målt mot flaten #141414:

| Sjekk | Første utgave | Nå |
|---|---|---|
| CVD-separasjon (alle par) | ΔE 0,7 (deuteranopi) | ΔE 3,6 — fortsatt praktisk borte |
| Normalsyn-gulv (≥ 15) | **ΔE 12,6 — FAIL** | **ΔE 16,8 — PASS** |
| Kontrast mot flaten | 2,0–2,2:1 på mørke hjørner | alle fire **over 3:1** |
| Kromagulv | mørk gul på C 0,084 («leses som grå») | kulør dreid til 105°, kroma hevet |

De tre siste radene handlet ikke om fargesyn — de var dårlig lesbarhet for alle, og
de er rettet: kulørspennet er utvidet (105° → 22°), lysheten løftet i den mørke
enden, og kroma taper mot mørkt framfor å bli klippet uforutsigbart av gamut.

CVD-raden står igjen som et bevisst valg. Distansen ligger derfor **også** i arealet:
en kanal som ikke kan kollapse for noen, og som ikke koster den som ser fargene noe.
Lys rød kan ikke bli mettet i sRGB — den blir korall — og det er en gamut-grense, ikke
et valg, siden lysheten eies av tempoet og ikke kan senkes for å gi rødt mer kroma.

#### Resten av skalaen

- **Arealet er lineært, ikke sidekanten.** En mark med dobbel bredde dekker fire
  ganger flaten og leses som fire ganger så mye, så sidekanten går gjennom
  kvadratroten (`distanceSize`).
- **Skalaen er brukerens egen** — 10.–90. persentil av egne dager. Persentiler
  framfor min/maks fordi én glemt tracker (2 t 20 min på 9 km) ellers presser alle
  andre dager sammen i den lyse enden. Tempoet regnes på elapsed tid, som er den
  eneste varigheten `canonical_workouts` bærer; skalaen tåler det, men tallet er
  ikke korrigert.
- **Gulv på spennet** (`MIN_DISTANCE_SPAN_KM` 2, `MIN_PACE_SPAN_SEC` 30): er alle
  turene like, skal de SE like ut. Samme lærdom som `MIN_AXIS_SPAN` i vektgrafen.
- **Under fem målte dager fargelegges ingenting**, og panelet sier hvorfor. En
  kalender som plutselig er ensfarget ser ellers ut som en feil.
- **Hendelse uten tall får en grå mark** — en styrkeøkt inne i en løpestreak møtte
  opp, men har ingen distanse. Nesten uten kroma, så den ikke kan forveksles med et
  hjørne i feltet.
- **Verdien er aldri bare farge.** Trykk på en dag skriver tallene under kalenderen
  («11. august · 1 økt · 12,1 km · 6:23 /km»). På en telefon finnes ingen hover, så
  en `title` alene ville gjort tallene utilgjengelige. Trykkflaten er hele cella,
  ikke marken: en mark på 52 % er 21 px, under minstemålet for en trykkflate.
- **Tegnforklaringen er feltets fire hjørner**, i det samme rutenettet aksene har.
  Fire ruter framfor ni: hjørnene er det leseren skal kjenne igjen, og alt mellom
  dem leses som en retning.

OKLCH regnes til hex i domenelaget (`$lib/domain/oklch.ts`) framfor å bruke `oklch()`
i CSS: en ugyldig fargeverdi i en gammel nettleser gir en gjennomsiktig celle, altså
en kalender som ser ødelagt ut framfor en farge som ser litt annerledes ut. Utenfor
sRGB reduseres kroma — aldri lysheten (det ville brutt tempo-aksen) eller kuløren
(det ville flyttet betydningen).

Trenings-streaks leser nå historikken gjennom metrikk-spørringen framfor
`readEventDayKeys`, så kalenderen, telleren og fargene er bygget av nøyaktig de
samme radene.

## Beslutninger

- **`StreakCalendar` er en egen komponent, ikke MonthCalendar med flere props.**
  `ui/MonthCalendar.svelte` er dagbokas datovelger: markerte dager er de eneste
  trykkbare, markøren er en prikk under datotallet, og etikettene sier «meldinger».
  I streak-kalenderen er ingenting trykkbart, cellen SELV er markøren (en rekke
  fylte celler er formen på en streak), og radene bærer periodens fasit. Å presse
  begge uttrykkene inn i én komponent ville kostet fire props og en layoutvariant
  for å spare tjue linjer markup. Den delte matematikken — mandag-ankrede uker og
  norske månedsnavn — er felles gjennom `month-grid`, og det er der duplisering
  faktisk hadde gjort vondt.
- **Trykket åpner historikk framfor å navigere.** Spørsmålet man har foran en
  streak er «hvordan har det gått», og svaret er kalenderen — ikke en liste over de
  samme kortene. Lenka til lista er beholdt i panelet.
- **Strippen bor i oversikt-fanen, ikke over fanene.** Streaken er et datapunkt
  blant datapunkter; over fanene ville den spist høyde i chat-visningen også.
- **Ingen ny lagring.** Streaks beregnes fortsatt on-demand fra hendelser, og
  historikken er samme lesing med dagene beholdt. En teller i basen ville måttet
  vedlikeholdes av alt som skriver en økt.
- **Fargevalg regnes, men avgjøres av brukeren.** Validatoren fant fire problemer med
  fire-hjørners-feltet; tre var reell dårlig lesbarhet og er rettet, det fjerde er
  fargeblindhet og ble et bevisst valg. Tallene står i tabellen over nettopp fordi de
  to slagene ikke skal blandes: det ene er en feil, det andre er en prioritering.
- **En overstyrt anbefaling skal etterlate seg tallene.** Neste gang noen ser på
  feltet, er spørsmålet ikke «var dette gjennomtenkt» men «gjelder avveiningen
  fortsatt».

## Verifisering

- `npm test` — 3723 grønne. Nye: `streak-relevance.test.ts` (9),
  `streak-history.test.ts` (13).
- `npm run check` — 0 feil, 0 advarsler.
- Kjørt i Chromium på 390 px mot `/design`: chipene rendrer med tellerne motoren
  regner (8 dager på rad, 4 uker på rad fra samme mockdager), og bunnpanelet åpnes
  fra en chip med kalender, fasit-kolonne, dekningstall og lenke videre. Panelets
  API-kall ble mocket, siden dev-miljøet her er uten database.
- Fase 5 verifisert i Chromium på 390 px: feltet leses som det skal (12,1 km @ 6:23
  er stor og mørk rød, 3,2 km @ 4:50 er liten og knallgul, 2,2 km @ 6:59 er liten og
  mørk oliven, styrkeøkta uten distanse er grå), tegnforklaringens fire hjørner
  stemmer med cellene, og trykk på en dag skriver tallene under kalenderen. Nye
  tester: `oklch.test.ts` (5), `workout-day-scale.test.ts` (19).
- **Piksel-baselines er ikke oppdatert:** `dashboardkort`-seksjonen har nye demoer,
  og temasider med relevante streaks får en rad mer. `npm run test:visual:update`
  krever databasetilgang som ikke fantes i miljøet endringen ble skrevet i.
