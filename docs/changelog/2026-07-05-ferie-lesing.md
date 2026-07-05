# Lesing i ferien på feriesida

Dato: 2026-07-05
Status: ferdig

## Kontekst

Bøker har fremdriftslogg (`book_progress_log`: én rad per slider-lagring med
`currentPage`/`currentMinutes`/`loggedAt`), men lesingen var bare synlig inne
på bok-temaet. Ønsket: en seksjon på feriesida som viser hvilke bøker som ble
lest i løpet av ferien, med et diagram over fremdriften. Signalet er upresist
(slideren dras «nå og da»), men nok til å se når lesingen startet og sluttet.

## Faser

### Fase 1: Ren beregningslogikk

`src/lib/ferie/ferie-reading.ts` — `buildFerieReadingSeries(books, start, end)`:

- Kollapser loggen til siste snapshot per dag (samme som bokas egen graf).
- Baseline = siste kjente verdi før ferien; uten tidligere logg regnes boka
  som påbegynt i ferien (baseline 0).
- Metrikk følger bokformatet: `print` → sider, ellers minutter.
- Lesestart/-slutt utledes fra første og siste dag med økning i vinduet;
  bøker uten økning filtreres bort.
- y normaliseres mot bokas total (sider/minutter), ellers mot største
  observerte verdi. Serier sorteres mest lest (relativt) først.

16 enhetstester i `ferie-reading.test.ts`.

### Fase 2: API og TripApi

- `GET /api/tema/[id]/ferie/books?start&end` — alle brukerens bøker (på tvers
  av temaer) med loggpunkter i vinduet + ett baseline-punkt før. Rådata;
  serieberegningen skjer klient-side.
- `TripApi.getFerieBooks()` i `trip-api.ts` (+ mock i `/design`-mocks).

### Fase 3: UI — mål-kort per bok

- `src/lib/components/domain/ferie/FerieBooksSection.svelte` — presentasjons-
  komponent med ett ekspanderbart mål-kort per bok:
  - **Kollapset**: fremdriftslinje (før-ferien som dempet segment, ferie-
    lesingen som lyst), prosent, og «Ferdig 4. juli 🎉» / «ferdig ~12. juli».
  - **Ekspandert**: akkumulert-mot-total-graf — punkter = faktiske slider-
    snapshots, stiplet prediksjonslinje mot 100 % fra lineær regresjon over
    ferie-tempoet, ferieslutt- og «i dag»-markører, tempo-etikett og lenke
    til boka.
- `FerieExecutionView` laster dataene og rendrer seksjonen «Lesing» mellom
  «Trening & helse» og «Økonomi» — skjult helt når ingenting er lest.
- Demo i `/design` → Reise-seksjonen (fast periode 1.–4. juni,
  `defaultExpanded` så grafene vises i katalogen).

### Fase 4: Forventet ferdig (ETA)

`ferie-reading.ts` beregner ETA per bok: regresjon over dagene med kjent
verdi (ekte baseline-dag før ferien teller med, den syntetiske gjør ikke).
x-domenet i grafen strekkes til ETA når den ligger maks én ferielengde etter
ferieslutt; ellers klippes prediksjonslinja ved høyre kant med regresjons-
verdien der (stigningen forvrenges ikke). Ferdige bøker får `finishedDate`
(siste økning) i stedet for ETA.

## Beslutninger

- **Dataeierskap**: seriene bygges i FerieExecutionView, ikke i seksjonen,
  slik at kortet kan skjules helt ved tom tilstand (scoped styles hindrer at
  barnet gjenbruker `.ferie-dash`-rammen).
- **Én graf per bok** (mål-kort som ekspanderer) i stedet for ett felles
  flerlinje-diagram — da trengs ingen kategorisk fargepalett; kurven bruker
  temaets `--tp-accent` (med `#5b93e8`-fallback utenfor ThemePage, f.eks. i
  `/design`). Alle `--tp-*`-variabler i komponenten har fallbacks av samme
  grunn.
- **Baseline-antagelse**: bok uten logg før ferien = påbegynt i ferien.
  Bevisst valg; første logg kan i teorien være en «sett posisjon»-justering.

## Verifisering

- `npm test`: 1054 tester grønne (20 nye). `npm run check`: 0 feil.
- `/design`-demoen rendret i Playwright og inspisert manuelt: baseline-punkt,
  delta-etiketter, leseperioder, prosent-spenn og ETA (kryssjekket for hånd:
  125 min/dag → 340 min nås 5. juni) stemmer med mock-dataene.
- Piksel-baselines er IKKE oppdatert fra denne sesjonen: containeren har
  annen Chromium-versjon (1194) enn baselines, og 17 urelaterte seksjoner
  diffet også. `design-reise`-baselinen må oppdateres i vanlig miljø
  (`npm run test:visual:update` eller `test:visual:review`).
