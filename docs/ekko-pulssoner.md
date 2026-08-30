# Pulssoner: kontrakten mellom Resonans og Ekko

Resonans eier pulsbaselinen og sonegrensene. Ekko henter dem, cacher dem og
coacher mot dem. Appen regner **aldri** sonegrenser selv.

## `GET /api/apps/heart-rate-baseline`

```json
{
  "restHr": 50,
  "maxHr": 180,
  "restHrSource": "sleep_min",
  "maxHrSource": "age",
  "derived": true,
  "easyPaceSecPerKm": 330,
  "usable": true,
  "basis": "hrr",
  "zones": [
    { "zone": 1, "label": "Restitusjon", "purpose": "aktiv restitusjon", "lowerBpm": 50, "upperBpm": 127 },
    { "zone": 2, "label": "Rolig", "purpose": "rolig utholdenhet — grunnmuren", "lowerBpm": 128, "upperBpm": 140 },
    { "zone": 3, "label": "Moderat", "purpose": "moderat aerobt arbeid", "lowerBpm": 141, "upperBpm": 153 },
    { "zone": 4, "label": "Terskel", "purpose": "terskelarbeid", "lowerBpm": 154, "upperBpm": 166 },
    { "zone": 5, "label": "Maksimal", "purpose": "maksimalt arbeid", "lowerBpm": 167, "upperBpm": 180 }
  ]
}
```

Autentisering som resten av `/api/apps/*`.

## Feltene som betyr noe

| Felt | Hva appen skal gjøre med det |
|---|---|
| `zones[].lowerBpm`/`upperBpm` | **Autoriteten.** Inklusive grenser, sammenhengende, ingen hull. Klassifiser og coach mot disse. |
| `usable` | `false` → skru AV sonecoaching og si hvorfor. Ikke fall tilbake på et gjettet bånd. |
| `derived` | `false` betyr at både hvile- og makspuls er fallback (60/190). Sonene er da formelle, ikke personlige — verdt en setning i UI. |
| `maxHrSource` | `manual` = brukerens egen verdi. `age` = Tanaka. `observed` = trimmet topp fra økter. `default` = 190. |
| `restHrSource` | `sleep_min` er best. `default` = 60. |
| `basis` | Alltid `hrr` i dag. Feltet finnes for at et framtidig modellbytte skal være synlig for appen framfor stille. |
| `easyPaceSecPerKm` | Referansetempo for rolig løping. Brukes til å oversette «du ligger 8 slag over» til «sakk ned ~20 sek/km». |

## Regler

- **Sonegrensene skrives aldri av i Swift.** De bor i
  `$lib/domain/health/hr-zones.ts` og sendes ferdig utregnet. To kopier av en
  sonegrense i to språk driver fra hverandre uten at noe sier fra — det var
  nettopp feilen denne kontrakten retter (appen regnet %makspuls, serveren HRR,
  og puls 135 var «Moderat» i appen og «Rolig» på nettet).
- **Modellen er HRR (Karvonen)**, ikke %makspuls. Hvilepulsen er med i
  regnestykket, så båndene flytter seg når formen endrer seg.
- **Cache med dato.** Baselinen endrer seg over uker, ikke minutter. Ekko henter
  ved oppstart og før en økt starter, og bruker sist kjente verdi offline —
  en tur uten dekning skal ikke miste sonecoachingen.
- **En cachet baseline uten `usable: true` er ikke en baseline.** Lagre flagget
  sammen med tallene, ellers ser en avvist baseline ut som en gyldig etter en
  omstart.

## Hvorfor båndene er heltall

Båndet blir SAGT høyt («Sone 2 i dag. 128 til 140»). Klassifiserte coachen på
`hrr >= 0.6` mens flaten viste avrundede tall, kunne puls 128 være «under sonen»
i det ene laget og «i sonen» i det andre. Nå er de avrundede grensene
autoriteten begge steder — se modulens toppkommentar.
