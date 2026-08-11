# Økonomi: tillitsgjennomgang og retning

Dato: 2026-08-11
Status: planlagt

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

Brukeren beskriver **reservert / behandles / ferdig** (tre). Koden kjenner `BOOKED` og
`PENDING` og gir alt annet `status_rank` 0, og batch-kollapsen sammenligner
`=== 'BOOKED'` som ren streng. Enten mapper integrasjonen om underveis, eller så finnes
det en tredje status som faller igjennom. **Dette avgjøres ikke ved å lese koden** — svaret
ligger i `raw_bank_transaction_versions.payload`, som lagrer råsvarene.

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

### Fase 1: Én sannhet

Alt som teller kroner leser `canonical_bank_transactions`, gjennom én delt leser.
`categorized_events` reprojiseres fra canonical, ikke fra rå `sensor_events`. Rå lesing
av `bank_transaction`/`bank_balance` vaktes med samme mekanisme som
`sensor-event-access.ts` bruker for `workout`/`weight`/`sleep`, med `knownRawReaders` for
de stedene der per-kilde-visning faktisk er poenget.

### Fase 2: Multiplisitet uten å ødelegge statusovergangen

Dette er nøkkelen til tørre tall, og den må gjøres i denne rekkefølgen:

1. **Mål først.** Hva statusene faktisk heter, hvor ofte beløpet endrer seg mellom
   reservert og ferdig, hvor ofte datoen flytter seg, og hvor mange distinkte ID-er som
   opptrer per bøtte per henting. Alt ligger i `raw_bank_transaction_versions.payload`.
   Uten disse tallene er tersklene i punkt 3 gjetninger.
2. **Behold bøttenøkkelen** for eksakte overganger — den virker. Legg til multiplisitet
   utledet som maks-per-status innenfor én henting, oppdatert som
   `GREATEST(eksisterende, ny observasjon)`. Alle lesere må gange beløp med multiplisitet.
   `batchMap`-kollapsen må skje **etter** tellingen, ikke før.
3. **Bundet uskarpt match** for en innkommende ferdig som ikke treffer eksakt: mot en
   *ubrukt* reservert-rad på samme merchant innenfor ±N dager og ±X % beløp, før ny rad
   opprettes. Dette er et tilordningsproblem, ikke en dedup — greedy, men bundet, og med
   hver reservert-rad brukbar bare én gang.
4. **Livsløp for reservasjoner.** En reservert-rad som aldri ble ferdig og ikke er sett i
   de siste M hentingene settes `isActive = false` framfor å bli stående som forbruk.

Tester på alle fire, og eksplisitt på begge sidene av tvetydigheten: sju like kjøp i én
henting skal gi sju, og tre statusobservasjoner av ett kjøp over tre hentinger skal gi én.
Det er det paret som avgjør om dette er riktig.

### Fase 3: Interne overføringer ut av forbruket

Parvis matching: negativ på konto A og positiv på konto B, samme dag, samme beløp →
merkes intern, ekskluderes fra både forbruk og inntekt. Brukerens valg var utvetydig:
sparing er **ikke** forbruk og skal ut av tallet.

### Fase 4: Retting der du ser tallet

Trykk på en transaksjon i lista → rett kategori. Skriver en
`classification_overrides`-rad på fingerprint, som allerede har forrang i
`categorizeTransaction`, og gjelder framover uten at brukeren må si det. Vipps-beløp over
en terskel spørres det om i månedsgjennomgangen — ikke som avbrudd.

### Fase 5: Månedsgjennomgangen som inngang

Fire spørsmål, i denne rekkefølgen, ved lønn:

1. Bærer måneden som kommer?
2. Hva var uvanlig forrige måned?
3. Gikk vi over noe vi hadde avtalt?
4. Hva er én ting å gjøre noe med?

Lønnsrapporten flyttes inn i Økonomi-temaet. Nudgen ved lønn er inngangen.

### Fase 6: Rydding

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
- **Overganger måles før de modelleres.** Tersklene for det uskarpe matchet (±dager,
  ±prosent) skal utledes av råsvarene, ikke velges. Samme grunn som `MET_CALIBRATION` er
  utledet framfor valgt: et hardkodet tall arver stille feilen i det det en gang ble
  tunet mot.

## Verifisering

Gjenstår — dette er et planleggingsdokument. Feilene over er lest ut av koden og er
entydige i lesingen, men **tallene i prod er ikke målt ennå**. Før fase 1:

- Mål hvor mye de tre lagrene faktisk spriker for samme periode. Det tallet er både
  bevis på diagnosen og regresjonstesten etterpå.
- Mål hvor stor andel av «forbruk» som er interne overføringer.

Og for fase 2, alt fra `raw_bank_transaction_versions.payload` — disse fire avgjør
designet, og ingen av dem kan leses ut av koden:

- Hvilke `bookingStatus`-verdier som faktisk forekommer (koden kjenner to, brukeren
  beskriver tre).
- Hvor ofte beløpet endrer seg mellom reservert og ferdig, og hvor mye. Gir ±X %.
- Hvor ofte datoen flytter seg mellom reservert og ferdig, og hvor langt. Gir ±N dager.
- Fordelingen av distinkte ID-er per bøtte per henting — altså hvor ofte den ekte
  multiplisiteten er > 1, og dermed hvor mye tall det står om.
