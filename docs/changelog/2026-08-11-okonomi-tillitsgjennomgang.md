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

### «For lav» — den semantiske dedupe-nøkkelen mangler forekomstteller

Dette er den alvorligste. SB1 utsteder ikke stabile `transactionId`, så dedupen må være
semantisk. Nøkkelen er `konto:dato:normalisert beskrivelse:beløp` — **uten teller for
hvor mange ganger den forekom**. To like kjøp samme dag til samme beløp kollapser derfor
til én: to kaffe à 45 kr, to bomstasjoner, to enkeltbilletter.

Verre for nettopp overføringer: `normalizeTxDescription` kollapser
«OVERØRSEL MELLOM EGNE KONTI…» til generisk `OVERØRSEL`. To *ulike* interne overføringer
samme dag med samme beløp blir da én rad. Normaliseringen som skulle gjøre dedupen robust
gjør den for aggressiv.

**Det holder ikke å rette JS-en.** `canonical_bank_transactions` håndhever samme
kollisjon i et unikt indeks på `(sensorId, accountId, canonicalDate, amount, merchantKey)`.
Rettelsen krever migrasjon og reprojeksjon.

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

### Fase 2: Rett dedupen

Forekomstteller inn i den semantiske nøkkelen, unikt indeks endret tilsvarende
(migrasjon), historikken reprojisert. Tester på den semantiske nøkkelen,
BOOKED-over-PENDING, og eksplisitt på to like kjøp samme dag — det er nettopp den saken
som er gal i dag.

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

## Verifisering

Gjenstår — dette er et planleggingsdokument. Feilene over er lest ut av koden og er
entydige i lesingen, men **tallene i prod er ikke målt ennå**. Før fase 1:

- Mål hvor mye de tre lagrene faktisk spriker for samme periode. Det tallet er både
  bevis på diagnosen og regresjonstesten etterpå.
- Tell hvor mange canonical-rader som er tapt til nøkkelkollisjon (grupper rå-versjoner
  på semantisk nøkkel og se hvor mange som har flere distinkte forekomster).
- Mål hvor stor andel av «forbruk» som er interne overføringer.
