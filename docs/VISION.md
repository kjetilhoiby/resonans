# Resonans — Produktvisjon

## Kjerneide

Resonans er en personlig AI-coach som kobler hverdagens datastrømmer — helse, økonomi, familie, jobb, selvrefleksjon — til handling gjennom en norskspråklig samtaleflate. Appen er bygget rundt ideen om at verdifull innsikt oppstår i krysningspunktet mellom domener: treningsbelastning påvirker søvn, som påvirker jobbkapasitet, som påvirker økonomi, som påvirker familieliv.

Brukeren skal aldri måtte oppsøke data — Resonans surfacer det relevante til riktig tid, gjennom nudges, dashboards og samtale.

## Arkitekturprinsipper

### Signaler, ikke data

Rådata (vektmålinger, transaksjoner, treningslogger) er backstage. Det brukeren møter er **signaler** — beregnede, kryss-domene innsikter med lav kognitiv kostnad:

- `economics_budget_pressure_7d` → "Du bruker mer enn vanlig denne uken"
- `health_training_load_trend` → "Treningsbelastningen har økt 30% — vurder en rolig uke"
- `family_coverage_gap` → "Ingen dekning for barna 15.–17. juli"

Signaler produseres av `SignalService`, lagres i `domain_signals`, og konsumeres av AI-kontekstbyggeren og tema-dashboards. Domener eier sine rådata; andre domener konsumerer kun signaler.

### Tema som brukerkomponert linse

Kjernedomener (helse, økonomi, hjem, familie) er forhåndsdefinerte med egne dashboards og datapipelines. Men brukeren komponerer **temaer** som samler relevante signaler på tvers: et "Sommerferie 2026"-tema trekker inn feriedekning fra familie, budsjettpress fra økonomi, og treningsstatus fra helse.

Hvert tema har en kanonisk samtale, mål, sjekklister, filer og et valgfritt dashboard. Temaer er brukerens organiserende prinsipp — ikke mapper, men levende prosjekter.

### Frontstage enkel, backstage kompleks

Appen skal oppleves enkel og "magisk". Under overflaten:
- Modular system-prompt bygges dynamisk basert på routing-beslutning (domener, skills, hints)
- AI-verktøy kalles transparent (query data, opprett mål, logg aktivitet)
- Nudges orkestreres med respekt for tidssone, stille timer og brukerprofil
- Kategorisering av transaksjoner kjører tre prioritetsnivåer (manuell override → LLM → regex)

## Dataflyt

```
Sensorer (Withings, SpareBank1, Spond, Dropbox, Strava, manuell input)
  ↓
Sync-jobber (cron eller webhook)
  ↓
sensor_events (unified, append-only event stream)
  ↓
Spesialiserte views: categorized_events, canonical_bank_transactions, canonical_workouts
  ↓
sensor_aggregates (uke/måned/år-aggregater)
  ↓
domain_signals (beregnede kryss-domene signaler)
  ↓
AI-kontekst → GPT-4o → streaming chat / verktøy-kall
  ↓
Nudges (Google Chat, Web Push) → brukerhandling → nye events
```

Dataflyten er syklisk: brukerens handlinger (logge trening, svare på nudge, kategorisere transaksjon) genererer nye events som påvirker fremtidige signaler.

## Domener

### Helse
Withings-data (vekt, søvn, skritt, puls, VO2max), treningsfiler (GPX/TCX via Dropbox/e-post), Strava-synk. Aggregeres til ukentlige/månedlige helsetrender. Treningsbelastning beregnes via Banister TRIMP / MET-scoring. VDOT-estimering fra best efforts. Treningsprogrammer genereres av LLM og valideres programmatisk.

### Økonomi
SpareBank1-transaksjoner kategorisert i tre lag. Lønnsdeteksjon via fingerprinting-algoritme. Forbrukstrend per måned/kategori. Kumulativ forbrukskurve siden lønning. Daglig balanse-rekonstruksjon fra snapshot-ankre.

### Familie
Spond-aktiviteter synket nattlig. Familiemedlemmer med relasjoner og Spond-mapping. Ferieplanlegging med oppholdstilbud-modell (subtraktiv: finn hullene, fyll dem).

### Egenfrekvens
Daglig selvinnsjekk (humør, energi, overskudd). Parsjekk med partner (synkronisert reveal). Refleksjonssynteser. Signaler for mental helse-trend.

### Hjem
Smarte enheter (strømmålere, IoT). Rutiner og prosedyrer. Prosjektsporing.

### Jobb
Fokusøkter, quick wins, oppgavesporing. Integrert med ukeplanen.

## Planlegging og handling

### Ukeplan
Sentral planleggingsflate: ukens oppgaver (med frekvens-slots), daglig sjekkliste, dagplannotat, målbilde og retning. Automatisk autocheck matcher gjennomførte treningsøkter mot mål.

### Dagplan
Morgen-nudge foreslår dagens prioriteringer basert på sjekkliste, vær, treningsstatus og kalender. Kveldsnudge oppsummerer dagen.

### Innboks → Gjøres → Ugjort
Oppgaver triages fra innboks (AI-assistert: estimat, tema, delsteg) til "gjøres" (klare oppgaver med estimat og tema) eller "ugjort" (passerte frist).

## Integrasjon med Ekko

Ekko er en iOS-app for live treningsoppfølging. Resonans fungerer som backend:
- OAuth-basert tilkobling (`/api/apps/authorize`)
- GPS-uploads med trackpoints (`/api/apps/upload`)
- Hybride treningsprogrammer: LLM-generert, validert programmatisk, levert som JSON
- Live session tracking med readiness-assessment
- Test-økter (Cooper, 5k, 10k, styrketester) for rekalibrering

## Retning fremover

### PWA og ytelse
Appen beveger seg mot en PWA-retning: frikoblet navigasjon fra datalasting, klientcache med stale-while-revalidate, prefetch fra hjemskjermen. Service worker og offline-støtte kommer når grunnflyten er riktig.

### Designsystem
Pågående migrasjon fra ad hoc-styling til et komponentbasert designsystem. Levende stilguide på `/design`. Mål: nye skjermer skal kunne bygges av eksisterende primitiver uten ny CSS.

### Forenkling
Schema-konsolidering planlagt: `activities`/`sensor_events` overlapper, tre klassifiseringsmekanismer gjør samme jobb. Målbilde: færre tabeller, tydeligere domene-eierskap, enklere parsing.

### Overvåking og robusthet
Nylig innført: cron-tracking, daglig helsesjekk med Google Chat-varsling, sensor-ferskhetskontroll. Mål: ingen stille feil — integrasjoner som bryter skal varsle samme kveld.
