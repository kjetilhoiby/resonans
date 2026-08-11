# Økonomi: tillitsgjennomgang og retning

Dato: 2026-08-11
Status: planlagt (målt mot prod — se Målingen)

## Målingen

`GET /api/admin/debug-sparebank1/dedup?days=365` kjørt mot prod 2026-08-11, vindu
2025-08-11 → 2026-08-10. Tallene under er grunnlaget for prioriteringen, og de flyttet
den.

### De tre lagrene er ikke i nærheten av hverandre

| Lager | Rader | Forbruk |
|-------|------:|--------:|
| `sensor_events` | 8 891 | **6 008 834 kr** |
| `canonical_bank_transactions` | 2 245 | **1 583 723 kr** |
| `categorized_events` | 2 043 | **1 481 802 kr** |

`sensor_events` har **3,8× canonicals kroner**. Hele `/api/economics/*`-familien og
widget-data leser der, og viser altså rundt fire ganger virkeligheten. Sikkerhetsnettet i
synken («remove semantic duplicates in the recent sync window») dekker bare det ferske
vinduet, så historikken står med duplikatene sine.

`categorized_events` mangler 202 rader og 102 000 kr mot canonical. Målene leser der.
Kategoritak måles altså mot et tall som er 6 % lavere enn flatens.

### Interne overføringer er den største enkeltfeilen

**319 par, 1 084 033 kr — altså 68 % av canonicals «forbruk».** Reelt forbruk blir
~500 000 kr på et år, ~42 000 kr/mnd for en husholdning. Det er et plausibelt tall. De
1,58 mill. dashboardet ville summert er 132 000 kr/mnd, og de 6,0 mill. `/economics` ville
vist er 500 000 kr/mnd. Ingen av dem er i nærheten, og det er nok alene til å forklare at
brukeren la fra seg flaten.

### Statusspørsmålet er avklart: to statuser, ingen som faller igjennom

`BOOKED` (7 713 versjoner, rank 20) og `PENDING` (1 091, rank 10). Ingen `unmapped`.
`bookingStatusRank` har altså ikke et hull, og det er ingen tredje status.

**Men PENDING finnes bare fra 2026-04-27.** Før det er alt BOOKED, og da eksisterer ikke
statusovergangen i det hele tatt. Hele overgangsproblemet er dermed avgrenset til de siste
~3,5 månedene — det er langt mindre historikk å reparere enn antatt.

### Tips-hypotesen er avkreftet. Det er datoen som flytter seg, ikke beløpet

Dette var den viktigste korreksjonen målingen ga. Hypotesen var at reservasjoner får tips
lagt på, så beløpet driver. **Den er feil.**

`deltaPct`-histogrammet har sin klare modus på **eksakt 0** (22 av 43 par). Overgangs­
populasjonen er altså *identisk beløp*. Det som flytter seg er datoen:
`deltaDays` fordeler seg −1 (9), 0 (12), +1 (9), +2 (9), +3 (4).

Merk fortegnet: **BOOKED kan være datert TIDLIGERE enn PENDING.** Reservasjonen bærer et
provisorisk tidspunkt, bokføringen får kjøpets faktiske dato. Et vindu som bare ser
framover ville mistet 9 av 43.

De store prosentavvikene i uttrekket (+710 %, −94 %) er **artefakter av diagnosens egen
join**, ikke drift. Joinen sorterte på nær dato før likt beløp, og flere kjøp hos samme
merchant samme dag er vanlig: tre Rema-kjøp 9. august (−417,15, −354,71, −114) ble alle
paret med samme −923,96, og fire Tesla-ladinger 30. juli med samme −104,32. Rettet — joinen
prioriterer nå eksakt beløp først. **Les eldre uttrekk med det i mente.**

Konsekvens for designet: **beløpstoleransen skal være null.** En prosenttoleranse ville
ikke bare vært unødvendig, den ville vært skadelig — den ville slått sammen de fire
Tesla-ladingene til én.

### Multiplisitetsmålingen var tom, og hvorfor

Alle 2 247 bøtter kom ut med `multiplicity: 1` og 0 kr underrapportert. **Det er ikke et
funn, det er en tautologi.** `writeRawAndCanonicalTransactions` ble kalt med den
*kollapsede* batchen for begge tabellene, og `batchMap` kollapser på nøyaktig bøttenøkkelen
— så `raw_bank_transaction_versions` kunne per konstruksjon aldri ha mer enn én rad per
bøtte per svar. Tabellen het «append-only evidence stream» og var det ikke.

Rettet: rå-strømmen får nå alle observasjonene fra svaret, canonical får den kollapsede
batchen. Canonical er uendret — den upserter per bøtte uansett. **Multiplisitet kan først
måles på data synket etter 2026-08-11.**

At `avgFetches` er 3,92 er derimot reelt og nyttig: samme transaksjon observeres i snitt
fire svar, hver gang med ny ID. Det er nettopp derfor alias-tabellen ikke kan bære dedupen.

### Foreldreløse reservasjoner: 97 bøtter, 93 248 kr

Et **øvre** anslag: noen er ekte ubokførte (NYT, GIRO, en IKEA-reservasjon på 4 026), andre
er samme-merchant-samme-dag-tilfeller der joinen brukte opp motparten. Materielt nok til at
livsløpsregelen skal bygges, men en størrelsesorden mindre enn de to feilene over.

## Kontekst

Økonomi har ikke vært rørt siden 2026-07-19 (kategori-tak). Domenet ble gjennomgått
teknisk, og deretter kartlagt med et brukerintervju. Resultatet snudde antakelsen:
problemet er **ikke** manglende funksjoner, og heller ikke datainngangen.

Brukerens egne ord, oppsummert:

- Han har **sluttet å åpne økonomi** i Resonans.
- Grunnen er at han **ikke stoler på tallene**. Han har sett tre ulike feil: ulike tall
  på ulike flater, summer som var åpenbart for lave, og summer som var åpenbart for høye.
- Alle relevante kontoer ligger i SpareBank1. Dekningen er altså komplett — feilen er vår.
- Det han vil ha er **husholdningens** økonomi, og han vil møte den som en **månedlig
  gjennomgang** ved lønn, ikke som et dashboard han må huske å åpne.

Alt annet er nedstrøms av tilliten. Ingen ny visualisering hjelper på en flate brukeren
har lagt fra seg fordi tallene tok feil.

## Hva som faktisk er galt

Alle tre tillitsbruddene har en mekanisk forklaring. Det er den gode nyheten.

### «Ulike tall på ulike steder» — tre parallelle lagre

Dedupliseringen ER løst, én gang, med evidence/canonical-mønsteret (samme form som
`canonical_workouts`):

```
sensor_events (bank_transaction)
  → raw_bank_transaction_versions   (append-only, sha256-fingerprint, seen_count)
  → canonical_bank_transactions     (BOOKED slår PENDING, isActive, evidenceCount)
```

Men resten av domenet leser rundt den, og **splittet følger kodealder, ikke formål**:

| Lager | Hvem som leser det |
|-------|--------------------|
| `canonical_bank_transactions` | Tema-dashboardet, `query_economics`, payday-detektor, lønnsmåned, lønnsrapport, salary-nudge |
| **rå `sensor_events`** | Hele `/api/economics/*`-familien (spending, cumulative-spending, irregular, merchant-analysis, transfers), widget-data, spending-analyzer |
| `categorized_events` | Mål (`category_spend`), prosjektkostnader, `link_to_project` — og den **bygges fra rå sensor_events**, ikke fra canonical |

Konsekvensen er identisk med den helse-domenet hadde i august (se
`2026-08-07-domenedata-til-assistenten.md`): **målstyringen leser et annet tall enn
skjermen.** Et kategoritak leses fra `categorized_events` mens forbrukskortet ved siden
av regnes fra canonical.

### «For høy» — interne overføringer telles som forbruk

Ingen av lesestiene ekskluderer interne overføringer. `economics-dashboard.ts` teller
hver negativ transaksjon som forbruk, inkludert overføring til egen sparekonto (og
`sparing` har `defaultFixed: true`, så den lander som *fast* utgift). Siden en intern
overføring er negativ på én konto og positiv på en annen, blåser den opp `totalSpending`
**og** `totalIncome` samtidig.

### «For lav» — bøtta er en mengde, ikke en multimengde

Her sto det først i dette dokumentet at nøkkelen manglet en forekomstteller, og at
rettelsen var å legge en inn. **Det var feil, og det er verdt å bevare hvorfor:** en
teller i nøkkelen ville fått hver nye status til å se ut som «forekomst nummer 2» og
opprettet en ny rad per statusovergang. Det er trippelregistreringen, ikke kuren mot den.

Kravene trekker i motsatt retning, og begge må innfris samtidig:

1. Samme transaksjon kommer flere ganger etter hverandre med **ny ID og ny status**
   (reservert → behandles → ferdig). De tre skal bli **én**.
2. Sju øl på samme utested samme kveld til samme pris skal bli **sju**.

Maskineriet fra våren 2026 løser (1), og løser det ordentlig:

- `ON CONFLICT (sensor_id, account_id, canonical_date, amount, merchant_key)` samler alle
  observasjoner av samme transaksjon i én rad.
- `status_rank = GREATEST(...)` løfter reservert → ferdig **i samme rad**, og
  `latest_booking_status` følger bare oppover.
- `description_display` velges fra høyeste status, med lengste tekst som tiebreak.
- Alias-tabellen peker alle ID-ene mot samme canonical-rad.

Det som gjenstår er (2). Bøtta er en **mengde**: sju øl gir én rad med
`evidence_count: 7`, og én transaksjon gjennom tre statuser gir også én rad med
`evidence_count: 7`. Fra attributtene alene er de to tilfellene identiske.

**Det som skiller dem er hvor observasjonene ligger.** Sju øl er sju rader i *ett og
samme* API-svar. Én transaksjon i overgang er én rad per svar, spredt over flere svar.
Multiplisiteten er altså antallet innenfor én henting — ikke på tvers av hentinger. Med
én presisering, siden både PENDING og BOOKED kan komme i samme batch (kommentaren på
`sparebank1-sync.ts:649`): tell **per status og ta maks**, ikke summen. Sju øl som
reservert gir maks 7; én transaksjon som dukker opp både som reservert og ferdig i samme
svar gir maks 1.

Signalet finnes i dataene i dag. Koden kaster det: `batchMap` kollapser på semantisk
nøkkel **først**, før noe annet er avgjort, så de sju er én før vi har rukket å telle dem.

### Og der lekkasjen sannsynligvis sitter: beløpet endrer seg underveis

Sju øl er nettopp tilfellet der beløpet **endrer seg** mellom reservert og ferdig — tips
legges på — og der datoen flytter seg, fordi fredagskvelden bokføres mandag. Da endres
bøttenøkkelen, upserten finner ingen konflikt, og det opprettes **en ny rad ved siden av
den gamle reservasjonen**. Altså dobbelttelling, stikk i strid med at mekanismen ellers
virker.

Alias-tabellen kan ikke bøte på det: dens `ON CONFLICT (sensor_id,
external_transaction_id)` treffer aldri, fordi ID-en er ny hver gang. Den er et
revisjonsspor, ikke en dedup-mekanisme — premisset den ble bygget på (stabile ID-er)
holder ikke. Den er likevel nyttig her, som kilden til antall distinkte ID-er per bøtte
per henting.

### Uavklart: hvilke statuser finnes egentlig

**Ingen vet.** Brukeren beskrev forløpet som «reservert → behandles → ferdig», men det var
en beskrivelse av fenomenet, ikke av API-verdier — han kjenner ikke statusnavnene. Første
utgave av dette dokumentet førte de tre ordene inn som om de var observerte strenger. Det
er rettet, fordi det ville sendt neste agent på jakt etter navn som kanskje ikke finnes.

Det vi vet fra koden: `bookingStatusRank` kjenner `BOOKED` (20) og `PENDING` (10) og gir
alt annet 0, og batch-kollapsen sammenligner `=== 'BOOKED'` som ren streng. Er det en
tredje status i dataene, deltar den ikke i `GREATEST`-løftet og treffes ikke av
kollapsen — men om den finnes er **ikke** avgjort.

Svaret ligger i `raw_bank_transaction_versions.booking_status` og `payload`, og hentes med
`GET /api/admin/debug-sparebank1/dedup` (se Verifisering). Antall er ikke poenget: det er
`unmapped`-flagget, altså statuser med rank 0 og mange rader.

### Øvrige funn, i lesingen

- **`detectRecurring` på dashboardet er en no-op.** Den kalles med `month: currentMonth`
  på hver transaksjon (`economics-dashboard.ts:188`), så `monthMap.size` er alltid 1 →
  `< 2` → `continue`. Returnerer alltid tom Set. Fast/variabelt-splitten hviler dermed
  utelukkende på kategoriens `defaultFixed`.
- **Dagligvarer måles på to måter i samme funksjon.** Inneværende periode bruker
  `tx.category === 'dagligvarer'` (full kategorisering med overrides), sammenlignings­
  periodene en hardkodet `GROCERY_KEYWORDS`-liste på 11 ord. «Du ligger over snittet»
  sammenligner to ulike definisjoner av det samme.
- **`typeText` er borte på dashboard-stien.** Canonical-tabellen bærer ikke feltet (rå
  gjør det), så kallet er `categorizeTransaction(desc, null, …)` og SB1s
  typeText-fallback er død der.
- **Månedsgrensa er UTC, ikke Oslo** (`toISOString().slice(0, 7)`). Første og siste dag i
  måneden havner i feil måned.
- **Saldoene leses uten datofilter** — alle `bank_balance`-rader noensinne, sortert, så
  første per konto plukkes i JS.
- **`grocery_spend` har ingen leser i `goal-progress`.** Metrikken står i katalogen, i
  viz-spec og i `create_goal`-beskrivelsen. Et mål opprettet på den viser ingen nåverdi.
- **`query_economics` er ikke registrert i `server/assistant/shared-tools.ts`.** Ekko har
  null økonomiverktøy og kan ikke svare på noe om penger.
- **`src/lib/domains/economics/index.ts` er 109 linjer død kode** med en konkurrerende
  14-kategori-taksonomi, egne regex-triggers og en `ECONOMICS_DOMAIN_PROMPT`. Ingenting
  importerer noen av symbolene. Den er en felle for neste agent, som vil tro det er
  taksonomien.
- **`/api/economics/transfers` har to personnavn hardkodet i kildekoden.**
- **To UI-er for det samme.** `/economics` er 1 730 linjer med egen fanestruktur og
  praktisk talt ingen inngang: eneste lenke er en fallback i `HomeScreen` for når
  Økonomi-temaet ikke finnes. Tema-flaten er den levende. De leser ulike lagre.
- **Testdekningen er den tynneste i repoet:** 35 tester i 2 filer (payday-detektor 22,
  kategorisering 13) mot ~1 900 totalt. Ingen på dedupliseringen — verken den semantiske
  nøkkelen eller BOOKED-over-PENDING — ingen på dashboardet, ingen på lønnsmåned.

### Det brukeren ba om finnes allerede

`/economics/lonnsmaned` er en ferdig bygget månedsrapport med lønnsperiode, innsikter og
refleksjon, og `salary-nudge` varsler når lønna kommer. Den bor i den orfane
`/economics`-delen, og `PageHeader` peker tilbake dit. «Lønnsmåned»-fanen i temaet er noe
helt annet (akkumulert forbruk per kategori). Gjennomgangen han vil ha er altså for det
meste et flytte- og koblingsarbeid, ikke nybygg.

## Faser

Rekkefølgen er ikke forhandlingsbar: **tall før flate.** Å bygge månedsgjennomgangen
oppå tre uenige lagre ville gitt en rapport med samme feil, bare mer selvsikkert
formulert.

**Målingen flyttet rekkefølgen innad.** Første utgave satte dedup-forbedringen som fase 2,
før overføringene. Det var galt målt i kroner: dedup-restene er ~93 000 kr i øvre anslag,
mens interne overføringer er 1 084 000 kr og feil lager er 4,4 mill. Dedupen er den
intellektuelt interessante feilen; den er ikke den store. Fase 1 og 2 under er derfor de to
billige som fjerner nesten hele avviket, og dedup-forbedringen er flyttet til fase 3.

### Fase 1: Én sannhet

Alt som teller kroner leser `canonical_bank_transactions`, gjennom én delt leser.
`categorized_events` reprojiseres fra canonical, ikke fra rå `sensor_events`. Rå lesing
av `bank_transaction`/`bank_balance` vaktes med samme mekanisme som
`sensor-event-access.ts` bruker for `workout`/`weight`/`sleep`, med `knownRawReaders` for
de stedene der per-kilde-visning faktisk er poenget.

### Fase 2: Interne overføringer ut av forbruket

Den største enkeltfeilen: 1 084 033 kr av 1 583 723, altså 68 %. Parvis matching — negativ
på konto A og positiv på konto B, samme dag, samme beløp → merkes intern, ekskluderes fra
både forbruk og inntekt. Brukerens valg var utvetydig: sparing er **ikke** forbruk.

Regnestykket som skal stemme etterpå: ~42 000 kr/mnd for husholdningen. Er tallet
132 000, er overføringene fortsatt med.

### Fase 3: Statusovergang og multiplisitet

Nå med tall bak. Merk at PENDING bare finnes fra 2026-04-27, så det er ~3,5 måneder
historikk å reparere, ikke et år.

1. **Behold bøttenøkkelen** for eksakte overganger — den virker.
2. **Match på eksakt beløp + samme merchant + ±3 dager, i BEGGE retninger.** Beløps­
   toleransen er **null** — målingen viser modus på `deltaPct` = 0, og en prosenttoleranse
   ville slått sammen fire separate Tesla-ladinger. Vinduet må se bakover også: 9 av 43
   par har BOOKED datert *før* PENDING.
3. **Én-til-én tilordning.** Hver PENDING-rad kan brukes opp av høyst én BOOKED. Uten det
   spiser én bokføring tre reservasjoner, som er nøyaktig feilen diagnosens egen join
   gjorde før den ble rettet.
4. **Multiplisitet** som eget felt, utledet som maks distinkte ID-er per (svar, status),
   oppdatert med `GREATEST`. Krever at rå-strømmen er rå — rettet 2026-08-11, så data fra
   den datoen og framover kan måles. `batchMap`-kollapsen må skje **etter** tellingen.
5. **Livsløp for reservasjoner.** En PENDING-rad som aldri ble booket og ikke er sett i de
   siste M svarene settes `isActive = false` framfor å stå som forbruk. Øvre anslag på hva
   det er verdt: 93 248 kr.

Tester på begge sidene av tvetydigheten: sju like kjøp i ett svar skal gi sju, og tre
statusobservasjoner av ett kjøp over tre svar skal gi én. Det er det paret som avgjør om
dette er riktig. Reglene hører i `$lib/domain/` — rene og testbare, ikke inni synken.

### Fase 4: Retting der du ser tallet

Trykk på en transaksjon i lista → rett kategori. Skriver en
`classification_overrides`-rad på fingerprint, som allerede har forrang i
`categorizeTransaction`, og gjelder framover uten at brukeren må si det. Vipps-beløp over
en terskel spørres det om i månedsgjennomgangen — ikke som avbrudd.

### Fase 5: Sparekontoen over tid — går den ned, og når kniper det

Bestilt av brukeren 2026-08-11: se at sparekontoen **ikke** går ned, og hvis den gjør det,
få frekvens og størrelse på trekkene for å se hvor og når det kniper.

**Designet finnes og er riktig. Inngangsdataene er korrupte.** `buildDailyBalances`
(`balance-reconstructor.ts`) bruker alle `bank_balance`-snapshots som ankre og anvender
transaksjoner forover mellom dem, med reset til ankeret — altså selvhelende mot drift. Det
er den rette formen. Men transaksjonene leses fra rå `sensor_events`, som er ~3,8×
duplisert:

- Innenfor et ankergap drifter linja og snapper tilbake ved neste anker: en sagtann.
  Ferske perioder har daglige ankre (synk hvert 5. minutt), så feilen er liten der. Den
  PDF-importerte historikken har spredte ankre, og **der er formen innad i måneden søppel.**
- **`uttak` er nøyaktig tallet brukeren ber om, og det er det som er ~4× galt.** Frekvensen
  blåses opp, størrelsene er riktige. Det er verst mulige utfall for spørsmålet: flaten vil
  si at sparekontoen raides fire ganger så ofte som den gjør.
- `openingBalance = firstSnapshotBalance − txSumBeforeFirstSnapshot`. Duplikater før første
  anker gjør åpningsbalansen feil med duplikatsummen, og serien starter ved første
  *transaksjon* — potensielt langt før første anker. **Den eldste delen av kurven er derfor
  den minst pålitelige**, som er stikk motsatt av hva «går den ned over tid» trenger.
- Den samme funksjonen mater `salary-report`, `salary-month` og `salary-nudge` — altså den
  månedsgjennomgangen brukeren har bedt om. Fase 1 er en forutsetning, ikke en parallell.

**`monthly_savings` har feil fortegn og kan ikke brukes.** `readMonthlySavings` summerer
`Math.abs()` av hver rad kategorisert `sparing`. Begge sidene av en intern overføring
telles, så én overføring teller dobbelt — og et **uttak** fra sparekontoen teller som
positiv sparing. Å tømme sparekontoen *øker* metrikken. Den leser dessuten
`categorized_events`, som mangler 202 rader.

**Tvingende føring på fase 2: klassifiser, ikke filtrer.** Et uttak fra sparekonto til
brukskonto **er** en intern overføring — de samme radene fase 2 skal ta ut av forbruket. De
er gale som *forbruk* og helt riktige som *sparebevegelse*. Samme rader, to spørsmål. Blir
fase 2 en ren filtrering, mister denne funksjonen datagrunnlaget sitt. Overføringene skal
merkes og beholdes, med motkontoen navngitt.

**Aksen er lønnsmåned, ikke kalendermåned.** Et uttak tre dager etter lønn er planlagt; et
uttak på dag 26 betyr at måneden ikke bar. «Når kniper det» er posisjon i lønnsperioden, og
`detectGlobalPayday` gir allerede periodegrensene.

**Kadens-fella, kjent fra livvidde:** ankertettheten er ikke konstant — daglig nå, månedlig
i historikken. Et fast trendvindu kopiert fra vekt vil stille produsere ingenting eller
tull på den historiske delen (`MIN_TREND_SAMPLES` slår inn). En saldo er dessuten et
**nivå**, ikke en støyende måling: den trenger ikke glatting mot væskevekt, den trenger å
skille «dippet og kom tilbake» fra «synker strukturelt». Månedsslutt-nivåer er den robuste
primitiven her, ikke et etterslepende snitt over dager.

Antakelser, siden de ikke er avklart: hver sparekonto følges **for seg** og i sum, og et
uttak rapporteres som et faktum — dommen ligger i trenden, ikke i den enkelte hendelsen.
Samme linje som `checkAgainstWeight`, som korrigerer ingenting og bare rapporterer avviket.

Åpent spørsmål som endrer designet: **er sparekontoen en buffer som er *ment* å tas av,
eller skal den være urørt?** Er den en buffer, er et uttak i seg selv ikke et varsel — bare
en trend som ikke kommer tilbake er det. Er den urørlig, er hvert uttak verdt å si fra om.

### Fase 6: Månedsgjennomgangen som inngang

Fire spørsmål, i denne rekkefølgen, ved lønn:

1. Bærer måneden som kommer?
2. Hva var uvanlig forrige måned?
3. Gikk vi over noe vi hadde avtalt?
4. Hva er én ting å gjøre noe med?

Lønnsrapporten flyttes inn i Økonomi-temaet. Nudgen ved lønn er inngangen.

### Fase 7: Rydding

Slett `src/lib/domains/economics/index.ts`. Avgjør `/economics`: redirect til temaet
eller slett. Hardkodede personnavn ut av `transfers`. Registrer `query_economics` i
`shared-tools.ts`. Gi `grocery_spend` en leser eller fjern metrikken.

## Beslutninger

- **Tillit før funksjoner.** Brukeren har lagt fra seg flaten fordi tallene tok feil.
  Ingen ny graf endrer det. De tre feilmekanismene rettes først.
- **Sparing er ikke forbruk** (brukerens valg, utvetydig). Interne overføringer ut av
  både forbruk og inntekt.
- **Månedlig kadens, ikke daglig flate.** Han vil ikke ha et dashboard å huske på. Én
  rytme ved lønn, med fire spørsmål som er verdt å lese.
- **Retting skjer der tallet vises**, ikke i en innstillingsside. Overstyringen skal
  gjelde framover av seg selv.
- **Vipps spørres det om, tolkes ikke.** Samme prinsipp som `log_hunger`: modellen skal
  ikke gjette hva en overføring til en venn var.
- **Canonical er sannheten, ikke sensor_events.** Dedupen bor der. Alt som teller kroner
  må gå gjennom den, ellers driver flatene fra hverandre igjen.
- **Multiplisitet er et eget felt, ikke en del av nøkkelen.** Nøkkelen må fortsette å
  kollapse statusoverganger; det er antallet som må bæres ved siden av. Forslaget om en
  teller *i* nøkkelen står bevart over med begrunnelsen, fordi det er den nærliggende og
  gale rettelsen.
- **Overganger måles før de modelleres.** Dette var ikke retorikk: målingen avkreftet
  hypotesen den skulle kalibrere. Tips-teorien var plausibel, og beløpstoleransen den
  krevde ville aktivt slått sammen separate kjøp. Svaret var ±3 dager og **null**
  beløpstoleranse. Samme grunn som `MET_CALIBRATION` er utledet framfor valgt.
- **En diagnose kan lyve, og gjorde det to ganger her.** Multiplisitetsmålingen leste en
  tabell der signalet var fjernet oppstrøms, og drift-joinen mispairet fordi den sorterte
  på dato før beløp. Begge ga *plausible* svar — 1,0 og «beløpet driver 22–710 %». En
  måling som bekrefter det du trodde skal kontrolleres like hardt som en som avviser det.
- **Prioriter på kroner, ikke på hvor interessant feilen er.** Dedupen var den morsomme
  feilen og er den minste (93 000 kr i øvre anslag). Feil lager (4,4 mill.) og interne
  overføringer (1,08 mill.) er kjedelige og er nesten hele avviket.
- **Interne overføringer klassifiseres, de slettes ikke.** De er feil som forbruk og
  riktige som sparebevegelse. Fase 2 må derfor merke dem og beholde dem med motkonto, ikke
  filtrere dem bort — ellers står fase 5 uten datagrunnlag. Føringen kom fra en bestilling
  som landet *etter* at fase 2 var skrevet, og den ville vært dyr å oppdage etterpå.
- **En saldo er et nivå, ikke en måling.** Trendapparatet fra vekt og livvidde skal ikke
  kopieres hit uten videre: der glatter man mot målestøy, her skal man skille en dipp som
  kom tilbake fra en varig nedgang. Ankertettheten varierer dessuten over historikken, og et
  fast vindu ville vært stumt på de eldste årene — samme felle som livvidde gikk i.

## Verifisering

Feilene over er lest ut av koden og er entydige i lesingen, men **ingenting er målt i
prod ennå.** Diagnosen finnes nå som endepunkt — samme mønster som
`withings/debug/coverage`, der regelen er at spørsmålet besvares av et kall og ikke av å
lese kode:

```
GET /api/admin/debug-sparebank1/dedup?days=365
```

Kun lesing: ingen SB1-kall, ingen skriving. Den svarer på alle fire designspørsmålene til
fase 2, pluss de to som tallfester tillitsbruddet:

| Felt | Spørsmål det avgjør |
|------|---------------------|
| `statuses[].unmapped` | Finnes det en status med rank 0 og mange rader — altså en som faller igjennom `bookingStatusRank`? |
| `multiplicity[]` | Hvor ofte er den ekte multiplisiteten > 1, og hvor mange kroner underrapporterer vi? Dette er «for lav», tallfestet. |
| `drift.deltaDaysHistogram` / `deltaPctHistogram` | Driver dato og beløp mellom statuser? En **tett** klynge gir tersklene i fase 2 punkt 3. En diffus fordeling betyr at hypotesen er feil — og da skal ingen terskel velges. |
| `drift.orphans` / `orphanNok` | Hvor mange reservasjoner ble aldri ferdige? Avgjør om livsløpsregelen i fase 2 punkt 4 er verdt å bygge. |
| `stores[]` | Sprik i radtall og kroner mellom de tre lagrene for samme periode. Dette er «ulike tall på ulike steder», tallfestet — og regresjonstesten etter fase 1. |
| `internalTransfers` | Hvor stor andel av «forbruket» er egne overføringer. Dette er «for høy», tallfestet. |

To feller i lesingen av svaret:

- **`multiplicity` er maks distinkte ID-er per (svar, status), ikke summen.** Begge
  statuser kan komme i samme batch, og summen ville tolket én transaksjons to statuser som
  to kjøp.
- **`drift.samples` er kandidatpar, ikke bekreftede sammenhenger.** Er
  `stalledWithCandidate` 0 fordi alle bøtter har samme toppstatus, gjelder ikke
  driftshypotesen for lagrede data. Det er også et svar.
