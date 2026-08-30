# Distanserekorder og PR-flagg

Dato: 2026-08-11
Status: ferdig · 400 m krever reanalyse av historikken

## Kontekst

«Kan jeg få liste over distanserekorder i resonans? (100, 400, 1000, 3000, 5000)»
og «flagg på økt når jeg setter PR».

`bestEfforts` — raskeste sammenhengende strekk på hver distanse innad i en økt —
har vært regnet og lagret på `canonical_workouts` hele tiden. Men den ble bare
brukt til VDOT-estimering og athlete-kontekst; ingen flate viste tallene, og
ingenting sammenlignet dem på tvers av økter.

1000, 3000, 5000 og 10000 fantes altså allerede. 400 gjorde ikke.

## Endring

- **400 m lagt til** i `BEST_EFFORT_DISTANCES_M`, med `bestEffortKey()` som gir
  meter-nøkkel under kilometeren (`400m`) og beholder `1k`/`3k`/`5k`/`10k`.
- **`$lib/domain/health/distance-records.ts`** (rent): `distanceRecords` (beste
  tid per distanse), `recordsSetBy` (hvilke PR-er en økt satte), `recordNuggetText`.
- **Rekordkort på Trening** med tid, tempo per km og dato.
- **PR-en driver krydderet**: `pickNugget` tar en ferdig rekordtekst og setter den
  øverst i prioriteringen.

## Beslutninger

**100 m er utelatt, og det er ikke en forglemmelse.** Sporet nedsamples til 2000
punkter (`MAX_STORED_TRACK_POINTS`) og GPS-posisjonsfeilen er 2–5 m. En
100-meter tatt i 4:00-fart varer 24 sekunder. Et «beste 100 m» skannet ut av et
slikt spor finner den bratteste nedoverbakken med mest støy — en rekord i
GPS-feil, ikke i løping, og den ser like troverdig ut som de andre. 400 m tar
90+ sekunder og tåler et par meters feil.

Veien til 100 m går gjennom Ekkos banerunder, der lengden er kjent, ikke gjennom
å skanne en skogstur.

**«Satte PR» og «holder rekorden» er to ulike flagg, og bare det første hører på
en økt.** Holder-rekorden flytter seg når du slår den, så merket ville forsvunnet
fra en økt du husker som god, og lista blitt et øyeblikksbilde framfor en
historikk. `recordsSetBy` måler derfor mot øktene FØR økta — samme prinsipp som
at en median holder dagens observasjon utenfor seg selv.

**Første gang en distanse løpes er ikke en PR.** Uten et tidligere tall å slå
ville hver ny distanse gitt et rekordflagg, og «PR» sluttet å bety noe.

**Bare løping.** En «5 km-rekord» på sykkel er en annen øvelse, og el-syklens er
motorens.

**Den lengste distansen vinner i krydderet.** En 5 km-rekord er en større nyhet
enn 400-meteren som ligger inni den, og de kommer nesten alltid sammen.

**Rekordlista har ingen datogrense.** En rekord er en rekord uansett alder; et
vindu ville fjernet den den dagen den ble for gammel.

## Verifisering

- 19 nye enhetstester i `distance-records.test.ts`.
- `npm test`: 3229 tester passerer. `npm run check`: 0 feil. Build går gjennom.

**Ikke verifisert mot prod.**

## Viktig: 400 m finnes ikke i historikken før den reanalyseres

Å legge distansen til i `BEST_EFFORT_DISTANCES_M` gjelder bare økter som
analyseres etterpå. Gamle rader har fortsatt bare `1k`/`3k`/`5k`/`10k`, så
400 m-raden er tom til `POST /api/sensors/workouts/reanalyze` har kjørt over
historikken.

Det er ikke en feil i lista — men det ser ut som en, siden alle de andre
distansene har tall.
