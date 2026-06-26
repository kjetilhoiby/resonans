# Kart: stedsnavn og mildere veistreker

Dato: 2026-06-26
Status: ferdig

## Kontekst

Tilbakemelding på de delte tur-/posisjonskartene (f.eks. `SharedTripPositionView`,
`GpxMap`, live-sporing): kartene viste ingen stedsnavn, og veiene tegnet seg som
brede, dominerende streker som tok oppmerksomheten bort fra ruten.

Alle MapLibre-kart deler basiskart-stilen `static/maps/resonans-dark.json`
(`RESONANS_DARK_MAP_STYLE`), så begge problemene løses ett sted.

## Faser

### Fase 1: Stedsnavn vises igjen

Alle symbol-lag brukte `"text-field": "{name:nb}"`. For mange norske
OpenMapTiles-features er `name:nb` tomt (det norske navnet ligger i `name`),
så tokenet løste til tom streng og etiketten forsvant.

Byttet alle fire etikett-lag (`place-label-water`, `road-label`,
`place-label-other`, `place-label-town`) til en `coalesce`-uttrykk med
fallback-kjede:

```json
"text-field": ["coalesce", ["get", "name:nb"], ["get", "name:latin"], ["get", "name"]]
```

Stedsnavn (tettsteder, bydeler, nabolag) og veinavn dukker nå opp der dataene
finnes, uavhengig av om `name:nb` er fylt ut.

### Fase 2: Mildere veistreker

Reduserte linjebreddene kraftig på alle veiklasser slik at de ikke dominerer
ved typisk turzoom (~13). Eksempel (z13 → faktisk bredde, før → etter):

| Veiklasse  | Før (z13) | Etter (z13) |
|------------|-----------|-------------|
| secondary  | ~4,3 px   | ~1,6 px     |
| primary    | ~6,8 px   | ~2,8 px     |
| motorway   | ~8,4 px   | ~3,8 px     |

Konkret i `resonans-dark.json`:
- `road-minor` 0.7→5 ⇒ 0.4→2.5, casing 1.5→7 ⇒ 0.8→3.5
- `road-secondary` 0.6→8 ⇒ 0.4→3.5, casing 1→10 ⇒ 0.6→5
- `road-primary` 0.8→11 ⇒ 0.5→4.5, casing 1.2→13 ⇒ 0.7→6
- `road-motorway` 1→13 ⇒ 0.7→5.5, casing 1.4→15 ⇒ 0.9→7

Dempet også fargekontrasten litt på de tyngste klassene (`secondary`
`#27272e`→`#25252b`, `primary` `#34343d`→`#2e2e36`, `motorway`
`#3f3f4d`→`#36363f`) så hovedveier ikke lyser opp mot den mørke bakgrunnen.

## Beslutninger

- **Felles stil, ikke per-komponent overstyring.** Endringene gjøres i den delte
  `resonans-dark.json` slik at alle kart (GpxMap, TripDashboard, live-sporing,
  delt posisjon) får samme uttrykk.
- **`coalesce` fremfor å bytte til `{name}`.** Beholder norsk preferanse
  (`name:nb`) der det finnes, med trygg fallback ellers.
- **Rutestreken er fortsatt den dominerende.** Veiene er bevisst dempet slik at
  den tegnede ruten (blå/rød linje lagt på i komponentene) skiller seg tydelig ut.

## Verifisering

- `static/maps/resonans-dark.json` validert som gyldig JSON.
- Linjebredder regnet ut for typisk turzoom (z13) for å bekrefte at veiene blir
  vesentlig tynnere enn før.
- Live piksel-render i headless Chrome var ikke mulig i agent-miljøet
  (vektortiles fra `tiles.openfreemap.org` nås ikke via WebGL-nettverkslaget i
  sandboxen), så stilen bør sjekkes visuelt på et reelt kart etter deploy.
