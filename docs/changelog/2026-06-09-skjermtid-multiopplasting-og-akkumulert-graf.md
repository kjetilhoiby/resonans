# Skjermtid: multi-opplasting og akkumulert ukegraf

Dato: 2026-06-09
Status: ferdig

## Kontekst

Tre brukerønsker for skjermtid-siden:

1. **Multi-opplasting**: Kunne velge mange skjermbilder (multi-select) og analysere
   alle med én knapp, i stedet for ett-og-ett-bilde-flyten. Analysen treffer alltid,
   bortsett fra ukesbilder der datoen må justeres manuelt (iOS-ukesbildet inneholder
   ingen dato).
2. **Akkumulert ukegraf**: «Tid på døgnet»-histogrammet (snitt per klokketime) erstattes
   som standardvisning av en akkumulert linje for hele uka — mandag 00:00 / 0 minutter
   nede til venstre, søndag 24:00 / ukestotal oppe til høyre — i samme stil som
   løpe-målgrafen (`RunningProgress`). Siste fire uker tegnes som tynne grå
   referanselinjer.
3. **Time-sammenligning**: Alternativ visning som viser snitt per klokketime denne uka
   vs. forrige uke, slik at reduksjon/økning per time blir synlig.

## Faser

### Fase 1: Ren seriemodul + tester

`src/lib/utils/screen-time-series.ts` (ny): rene hjelpere uten server-avhengigheter,
brukt både server- og klientside:

- `hourlyArrayFromBuckets()` — `ScreenTimeHourBucket[]` → 24-elements array.
- `buildCumulativeWeekSeries(days, fallbackProfile)` — akkumulert serie med ett punkt
  per time (169 punkter for full uke). Dager med time-detalj skaleres slik at timesummen
  treffer dagstotalen; dager uten detalj (fra ukesbilder) fordeles etter ukens
  timeprofil, ellers flatt. Serien kuttes etter siste dag med data så pågående uker
  ikke får flat hale.
- `mondayOfWeekISO()` / `previousWeekMondayISO()` — dato-snapping for ukesbilder.

18 enhetstester i `screen-time-series.test.ts`.

### Fase 2: Server-data

`src/routes/skjermtid/+page.server.ts`: dagsevents leser nå også `hourly`-buckets, og
hver uke i `weeks[]` får `cumulativeSeries: number[]` (bygget med metrikens `byHour`
som fallback-profil).

`src/lib/server/integrations/screen-time.ts`: `ingestWeeklyScreenTime` snapper nå
`weekStartISO` til mandag i ISO-uken — brukeren kan oppgi hvilken som helst dato i uka.

### Fase 3: Grafer i ScreenTimeCard

`src/lib/components/composed/ScreenTimeCard.svelte`: nye valgfrie props `cumulative`
og `cumulativeRefs`. «Tid på døgnet»-seksjonen har nå en toggle:

- **Akkumulert** (standard): SVG-linjegraf man→søn, denne uka i aksentfarge med
  areal-fyll og endepunkt-dot, referanseuker som tynne grå linjer, dagsgrenser og
  M T O T F L S-etiketter på x-aksen.
- **Per time**: histogram som før, men med forrige ukes snitt som grå parsøyle ved
  siden av denne ukas (med sosialt-overlegg). Tooltip viser begge verdier + differanse.

Kompakt modus (hjem-widgeten) er uendret.

### Fase 4: Multi-opplasting

`src/routes/skjermtid/+page.svelte`: fil-input med `multiple`; valgte bilder legges i
en kø. «Last opp og analyser (N)» kjører opplasting + GPT-4o-tolking sekvensielt per
bilde med status per element. Tolkede elementer viser nøkkeltall og redigerbar dato
(dagsbilder forhåndsutfylles fra bildet, ukesbilder med forrige ukes mandag).
«Lagre alle (N)» ingester alt; feilede elementer blir stående med feilmelding.

### Fase 5: Bugfiks — uka vist som søndag–lørdag

Skjermtid-siden viste uka som «7.–13. jun» (søn–lør) og la mandagens tall i
tirsdagens søyle. Rotårsak: `time-periods.ts` lagde `startDate`-strenger med
`toISOString()` på en **lokal-midnatt**-Date — i en tidssone foran UTC blir
mandag 00:00 til søndag 22:00 UTC, altså dagen før. Raden i `sensor_aggregates`
ble i tillegg aldri reparert, fordi upserten kun oppdaterte `metrics`/`eventCount`.

Fiks i tre lag:

1. `time-periods.ts`: datostrenger formateres nå med lokale getters
   (`toLocalISODate`), og ukedatoene genereres med `setDate` (DST-trygt).
   Ny eksport `isoWeekKeyToMonday('2026W24')` → mandag i ISO-uken.
2. `aggregation.ts`: alle upserts oppdaterer nå også `startDate`/`endDate`,
   slik at tidssoneskjeve rader heles ved neste re-aggregering.
3. `skjermtid/+page.server.ts`: ukestart utledes fra `periodKey` i stedet for
   lagret `startDate` — visningen er riktig uavhengig av gamle rader i DB.

Dagseventene var aldri feil (lagres ved lokal middag, robust mot ±12t skjevhet),
så søylene flytter seg automatisk til riktig dag.

## Beslutninger

- **Fordeling av dager uten time-detalj**: ukens timeprofil (normalisert `byHour`)
  brukes som fasong i den akkumulerte grafen, flat fordeling som siste utvei. Gir
  realistiske natt-platåer uten å finne på data — endepunktene (dagstotalene) er
  alltid eksakte.
- **Dato-snapping for ukesbilder** gjøres både klient- og serverside: brukeren slipper
  å treffe nøyaktig mandag, og API-et er robust mot feil ukedag.
- **Serien beregnes serverside** (i load) slik at logikken er ren og testbar, og
  klienten bare tegner.

## Verifisering

- `npm test`: 385 tester grønne (18 nye for seriemodulen).
- `npm run check`: 0 feil, 0 advarsler.
- Visuelle tester ikke kjørt i dette miljøet (mangler DB/API-nøkler); skjermtid-siden
  er ikke blant baseline-sidene, og hjem-widgetens kompakt-modus er uendret.
