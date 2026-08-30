# Pulssoner: én modell, to repoer

Dato: 2026-08-30
Status: pågår

## Kontekst

Ekko skal kunne coache mot en pulssone — «hold sone 2» framfor «hold 5:30/km» —
fordi et sonemål er robust mot form, varme og dagsform på en måte et tempomål
ikke er. På en rute med bakker er tempomålet dessuten direkte feil: å holde
tempoet oppover er å sprenge seg.

Før den coachingen kan bygges må ett problem ryddes: **systemet hadde to
sonemodeller, og de var uenige.**

- Resonans: HRR (Karvonen) i `computeHrZoneDistribution` — `basis: 'hrr'`.
- Ekko: ren %makspuls i `Models/HeartRateZones.swift`.

Med maks 180 og hvile 50:

| Sone | %makspuls (Ekko) | HRR (Resonans) |
|---|---|---|
| Z2 «Rolig» | 108–125 | 128–140 |
| Z3 «Moderat» | 126–143 | 141–153 |
| Z4 «Terskel» | 144–161 | 154–166 |

Puls 135 var Z3 i appen og Z2 på nettet. Hele mellomområdet lå én sone for høyt i
appen — og det er nettopp der «rolig» bor. Bygget vi sonecoaching på den
modellen, ville en genuint rolig løpetur på 135 utløst «du ligger over sonen, roe
ned», og brukeren ville gått ned i gange for å nå «sone 2».

To ting til, funnet i samme gjennomgang:

- `Views/CockpitDetailsPage.swift` kalte `HeartRateZones(maxHr: nil)` og fikk
  hardkodet 190 selv når brukeren hadde satt `userMaxHr`. Sonefargen i cockpiten
  var feil i dag, uavhengig av modellvalget.
- Ekkos makspuls var en `UserDefaults`-verdi med fallback 190, mens Resonans hele
  tiden har utledet den ordentlig (`resolveMaxHr`) uten å eksponere den på
  `/api/apps/*`. Soner er *definert* av makspulsen: ti slag feil flytter
  Z2-båndet rundt sju slag, altså mer enn slingringsmonnet en coach har.

## Faser

### Fase 1: Delt sonemodell i domenelaget (ferdig)

Ny `src/lib/domain/health/hr-zones.ts` — eneste sted en sonegrense skrives.
`computeHrZoneDistribution` klassifiserer nå gjennom `zoneForHeartRate` framfor en
lokal `hrrToZone`.

Filer: `src/lib/domain/health/hr-zones.ts` (ny), `hr-zones.test.ts` (ny, 17
tester), `src/lib/server/workouts/workout-analytics.ts`.

### Fase 2: Baselinen eksponert for Ekko (ferdig)

`GET /api/apps/heart-rate-baseline` returnerer `restHr`, `maxHr`, kildene,
`derived`, `easyPaceSecPerKm`, `usable` og de fem båndene ferdig utregnet i bpm.
Kontrakten er dokumentert i `docs/ekko-pulssoner.md`.

### Fase 3–7: Ekko (pågår)

HRR i `HeartRateZones`, `targetZone` i `SessionGoal`, soneregulatoren med dødbånd
og lås, bakke-forvarsel mot sonetaket, og sonefasit i øktoppsummeringen. Bor i
`kjetilhoiby/resonans-lab`.

## Beslutninger

**HRR framfor %makspuls.** Brukeren hadde ingen preferanse, så valget er teknisk:
HRR var alt modellen effort-skåringen og VDOT-proxyen hviler på, den tar hensyn
til hvilepulsen (som vi måler hver natt), og den plasserer «rolig» der rolig
faktisk er. Ett bytte i appen, ikke tre på serveren.

**Båndene er heltall, ikke brøker.** Båndet blir sagt høyt («Sone 2 i dag. 128 til
140») og vist på flaten, så klassifiseringen må gå mot de samme avrundede tallene.
Klassifiserte coachen på `hrr >= 0.6` mens flaten viste avrundede grenser, kunne
puls 128 vært «under sonen» i ett lag og «i sonen» i et annet — et avvik på en
halv slag som er usynlig i koden og synlig for brukeren.

Prisen: sonefordelinger kan flytte seg inntil ett slag på grensene mot det som ble
beregnet før. Det er under en prosent av tiden i en sone, og det er hva det koster
at appen og nettet endelig sier det samme.

**Båndene sendes ferdig utregnet, ikke som `restHr`/`maxHr`.** Serveren kunne latt
appen regne. Men da bor grensene to steder, i to språk — nøyaktig feilen dette
arbeidet retter. Appen skal kunne si båndet uten å ha en formel.

**`usable: false` skrur av sonecoaching.** Uten troverdig pulsreserve er et
sonebånd oppdiktet presisjon. Et gjettet bånd er verre enn ingen: det ser like
autoritativt ut, og brukeren kan ikke se forskjell.

## Verifisering

- `npm test`: 4005 tester, 282 filer — grønt.
- `npm run check`: 0 feil, 0 advarsler.
- `hr-zones.test.ts` har en vakt som går gjennom **hvert eneste slag** fra hvile til
  maks og krever at `zoneForHeartRate` og `hrZoneBands` er enige. Det er den
  invarianten som gjør at coachen kan lese båndet høyt og klassifisere pulsen uten
  at de to kan si ulike ting.
- Egen regresjonsvakt på puls 135 → sone 2, altså feilen som gjorde arbeidet
  nødvendig.
