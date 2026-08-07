# Assistenten fikk lese sitt eget domene

Dato: 2026-08-07
Status: ferdig

## Kontekst

På Trening-temaet spurte brukeren i Samtaler-fanen: «Ser du belastning/effort/trening
denne uka?» Svaret var «10 treningsøkter, samlet distanse 94,2 km, snitt 4,7 km per økt».

I fanen rett ved siden av — Oversikt, samme tema — sto: **426 av 232–278** effort, prognose
**~491**, belastningsforhold **1,48**, **Form (CTL) 54**, **Belastningsbalanse −14 «Sliten»**,
**Balanse 36/100** med «4 løp og ingen styrke denne uka», og **Pulsfall 32 slag på 60 sek**.

Modellen hallusinerte ikke. Den kalte `query_sensor_data` med `metric='workouts'`, som
returnerer `count`/`totalDistance`/`totalDuration` fra `sensor_aggregates`, og svarte
ærlig på det den fikk. Problemet var at hele det beregnede laget ikke fantes for den.

### Hvor tallene bodde

Fire dashboard-lastere hadde **én kaller hver** — sitt eget API-endepunkt:

| Laster | Hva bare den kunne | Verktøy før |
|---|---|---|
| `loadTrainingDashboardData` | ukesbånd, prognose, balanse, pulsfall, VO2max, treningsløp | ingen |
| `loadWeightDashboardData` | trend, milepæler, kroppssammensetning | `query_sensor_data` (siste måling) |
| `loadSleepDashboardData` | netter, døgnrytme, sovepuls, HRV, forstyrrelser | `query_sensor_data` (rå rader) |
| `loadEgenfrekvensDashboardData` | balanse, tanker, følelser, notater | **ingen metrikk i det hele tatt** |

`computeTrainingLoad` (CTL/ATL/TSB) hadde i tillegg bare én kaller: `TrainingDashboard.svelte`.
Belastningsmodellen var altså et rent visningsfenomen.

Ernæring hadde `query_nutrition` og er nettopp derfor det undertemaet som svarte godt —
det er samme grep, gjort én gang før, for én gren.

## Faser

### Fase 1: TSB-klassifiseringen ut av kortet

Grensene for «Sliten» / «I balanse» / «Fersk» lå inni `LoadBalanceCard.svelte`. Skulle
chatten si det samme som skjermen, måtte de deles — to sett grenser ville drevet fra
hverandre, og en assistent som kaller −14 «i balanse» mens flaten sier «Sliten» er verre
enn en som ikke svarer.

`classifyTsb` bor nå i `$lib/util/training-load.ts` ved siden av `computeTrainingLoad`, og
kortet kaller den. Ren refaktorering: samme grenser, samme merkelapper, samme `tone`-klasser.

Filer: `src/lib/util/training-load.ts`, `src/lib/components/composed/LoadBalanceCard.svelte`,
`src/lib/util/training-load.test.ts` (ny — grenseverdiene er testet fordi det er der to
implementasjoner ville sprunget fra hverandre).

### Fase 2: Fire sammendrag, testet uten database

`$lib/domain/ai/{training,weight,sleep,egenfrekvens}-summary.ts`. Hver tar
dashboard-payloaden og gir et smalt utsnitt per `queryType`.

**Hvorfor sammendrag og ikke payloaden:** `loadTrainingDashboardData` returnerer opptil
2000 aktiviteter og 100 rå sensorhendelser med jsonb. Riktig for en flate som tegner grafer,
feil for et verktøysvar — konteksten fylles med rader modellen ikke leser, og det viktige
tallet drukner.

Hvert sammendrag tar en **smal input-type** som beskriver bare feltene det leser, ikke
laster-typen. Da kan testene bygge fixtures uten å konstruere hele payloaden, mens
`npm run check` fortsatt fanger drift på kallstedet i verktøyet.

Reglene fra CLAUDE.md er kodet inn i formen, ikke bare i prompten:

- VO2max og pulsfall gir `best` **og** `latest`, med `window: 'siste åtte uker'` i svaret.
- Søvn/HRV/sovepuls gir siste natt mot brukerens egen baseline — motsatt retning.
- Vektendringer regnes på trenden, og `changes[].actualDays` sier hvor langt tilbake
  referansepunktet faktisk lå.
- `wellAnchored`, `ctlSettled`, `hrvAvailability`, `noteTruncated` og `missing` bærer
  forbeholdene videre, så modellen kan si dem.

### Fase 3: Verktøyene

`$lib/ai/tools/query-{training,weight,sleep,egenfrekvens}.ts`. Tynne: loader inn,
sammendrag ut. Ingen av dem skriver (`evaluateMilestones` bes bevisst ikke om).

Registrert på **begge** flater: `routes/api/chat/+server.ts` (definisjon, dispatch,
fremdriftsmelding) og `server/assistant/shared-tools.ts` for Ekko-stemmen. Beskrivelsene bor
på verktøymodulen og gjenbrukes av chatten, så de to flatene ikke kan få ulike instrukser.

### Fase 4: Å faktisk bli valgt

Et verktøy som finnes men ikke velges, endrer ingenting. Tre grep:

1. `query_sensor_data`-beskrivelsen sier nå eksplisitt hva den **ikke** er til, og navngir de
   fire alternativene per spørsmålstype.
2. `DOMAIN_PROMPTS.health` leder med verktøyvalg framfor med «bruk query_sensor_data», og
   sier hvorfor: «Svarer du "10 økter og 94 km" på et spørsmål om belastning, har du brukt
   feil verktøy.»
3. `detectPromptFocusModules` fanget ikke «belastning», «restitusjon», «pulsfall», «effort»,
   «hvilepuls», «hrv», «vo2» eller «overtrening». Den opprinnelige meldingen kom bare gjennom
   til health-modulen fordi den *også* sa «trening» — uten health-blokka vet ikke modellen at
   verktøyene finnes.

Ekkos systemprompt fikk samme punkt, med den viktigste regelen med: beste observasjon for
kapasitet, siste natt for søvn.

## Beslutninger

**Samme kilde som flaten, ikke en egen spørring.** Verktøyene kaller dashboard-lasterne.
Alternativet — egne, lettere spørringer — ville spart noen millisekunder og garantert at de to
tallene før eller siden ble ulike. Kostnaden er at et `query_training`-kall gjør samme arbeid
som en sidevisning.

**Ingen ny `ChatDomain`.** `training` som eget domene ville krevd endringer i routeren, i
LLM-routerens prompt og i `DOMAIN_PROMPTS`. Helse er mortemaet og de fire er undertemaer —
blokka hører der, og arkitekturen sier det alt.

**Ett verktøy per undertema, ikke ett generisk `query_theme_dashboard`.** Et generisk verktøy
måtte tatt en `kind`-parameter og returnert fire ulike former, og beskrivelsen kunne ikke
båret reglene som skiller dem: beste-observasjon mot siste-natt er motsatte regler, og de må
stå i den beskrivelsen modellen leser når den velger.

**Én deklarert returtype per sammendrag, med valgfrie seksjoner**, framfor en union per
`queryType`. JSON-en er identisk (`JSON.stringify` dropper `undefined`), men kallsteder og
tester slipper å smalne typen først. Der to `queryType`-er ga lister med ulike felt, fikk de
ulike feltnavn (`nights`/`disturbances`, `days`/`dayLevels`) — samme navn på to former gjør
svaret uleselig for både modell og kallsted.

**Egenfrekvens-notatene klippes, ikke utelates.** Fulle refleksjonstråder er det lengste
fritekstmaterialet i basen. `MAX_NOTE_CHARS` (280) med `noteTruncated` satt lar modellen vite
at det står mer og spørre, framfor å oppsummere som om den leste alt.

**Balansetallet får brukerens egen merkelapp med.** «−3» betyr ingenting; brukeren valgte på
en slider merket «Underskudd». Uten `BALANCE_LABELS` i svaret ville modellen laget sin egen
tolkning av tallet, i det domenet der ordvalget er hele poenget.

## Verifisering

- `npm test` — 2680 tester i 203 filer, alle grønne. 56 nye: 16 + 12 + 9 + 11 på de fire
  sammendragene, 6 på `classifyTsb`/`computeTrainingLoad`, og 2 i `registry.test.ts` som
  fanger at Ekko-settet mister et av verktøyene eller begynner å eksponere `userId`.
- `npm run check` — 0 feil, 0 advarsler. Det er også verifikasjonen av at de smale
  input-typene faktisk passer laster-payloadene: kallstedene i de fire verktøyene typesjekkes
  mot de ekte returtypene.
- Testene dekker det som var feil i utgangspunktet, ikke bare de glade stiene: uke over/under
  båndet, prognose under båndet, TSB-grensene mot kortets, beste-mot-siste for kapasitet,
  `actualDays` når brukeren ikke veide seg i vinduet, «vet ikke» mot null minutter våken, HRV
  `band: 'ukjent'`, og hvorfor HRV mangler.
- Ikke kjørt: `npm run test:visual`. Den krever database og dev-server, som ikke finnes i
  dette miljøet. `LoadBalanceCard`-endringen er en ren uttrekking — samme grenser, samme
  merkelapper, samme `tone-*`-klasser — så pikslene er uendret for samme input, men det er
  utledet, ikke målt.
- Ikke verifisert mot prod-data: at modellen nå *velger* det nye verktøyet på den opprinnelige
  meldingen. Det avgjøres av beskrivelsene og domeneblokka, og kan bare måles i bruk.

## Videre

De øvrige tolv dashboardene er ikke kartlagt: `screentime` har `query_sensor_data`-dekning,
og `economics`, `food`, `family`, `home` og `vehicle` har egne verktøy fra før — men
`books`, `film`, `travel`, `ferie` og mortemaet `health` er ikke sjekket for samme mønster
(en laster med én kaller).
