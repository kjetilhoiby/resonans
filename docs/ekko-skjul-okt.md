# Skjule en økt fra Ekko

Kontrakt mellom Ekko (`resonans-lab/ekko`) og Resonans. Serverdelen er
implementert; app-delen står igjen.

## Hvorfor endepunktene finnes

En sporing kan startes ved et uhell. Konkret tilfelle: en treåring trykket i
gang treningsmodus på klokka mens den lå på gulvet, og resultatet ble en
«løpetur» på 0,32 km over fem timer. Den økta skårer **~457 effort** mot ~77 for
en ekte rolig 45-minutters løpetur — altså seks reelle økter i én rad. Den dro
CTL opp 16 poeng på fjorten dager og TSB ned til −45, og formkortet ba om hvile
brukeren ikke trengte.

Brukeren skal kunne rydde opp der hen står — i appen — og få det ryddet i
Resonans i samme handling.

## Det viktigste: økta skjules, den slettes ikke

Dette er ikke forsiktighet, det er den eneste semantikken som varer.

Økta i eksempelet ble registrert av **Withings**, ikke av Ekko. Withings-synken
henter sju dagers overlapp hvert femte minutt for å fange retroaktive
revisjoner. En slettet rad ville altså vært tilbake innen fem minutter, og
brukeren ville sett den igjen neste gang hen åpnet appen. Et flagg på raden
overlever synken; en sletting gjør det ikke.

Svaret sier derfor `hidden: true` og `reversible: true`, ikke `deleted`.
**Appen bør bruke et ord som holder** — «Skjul økt» framfor «Slett økt». Sier
appen «slett» og økta senere kan gjenåpnes, har appen løyet om noe brukeren kan
etterprøve.

Skjulingen er full: økta forsvinner fra aktivitetslista, fra løpemål og
uke-/månedsprogresjon, OG fra form- og belastningskurven (CTL/ATL/TSB) — alt i
samme kall, ikke ved neste nattjobb.

## `GET /api/apps/workouts`

Dedupliserte økter på tvers av **alle** kilder — ikke bare de Ekko lastet opp.
Det er hele grunnen til at endepunktet finnes: en økt fra klokka finnes bare i
Resonans, og uten en liste er den uåtkommelig fra appen.

| Parameter | Default | Maks | Merknad |
|-----------|---------|------|---------|
| `days` | 30 | 365 | Vindu bakover |
| `limit` | 50 | 200 | Tak på antall |

Ugyldige verdier gir defaulten, og verdier utenfor spennet klippes — appen får
en liste, ikke en 400.

```json
{
  "ok": true,
  "days": 30,
  "workouts": [
    {
      "id": "3f2a…",
      "startTime": "2026-08-13T15:48:00.000Z",
      "sportType": "running",
      "distanceMeters": 320,
      "durationSeconds": 18060,
      "paceSecondsPerKm": 56734,
      "elevationMeters": null,
      "avgHeartRate": null,
      "maxHeartRate": null,
      "sources": ["withings"],
      "evidenceCount": 1
    }
  ]
}
```

Allerede skjulte økter er **ikke** med — lista er det brukeren ville sett.

`sources` er verdt å vise. Den forteller hvor økta kom fra, og dermed hvorfor
den ikke kan slettes ved roten.

## `POST /api/apps/workouts/:id/dismiss`

Skjuler økta. `DELETE` på samme URL angrer.

`:id` er `id` fra lista over (`sensor_events.id`). En canonical-workout-id
godtas også — samme konvensjon som `/api/apps/workouts/:id/analysis` — men
**foretrekk den fra lista**: canonical-id-er skrives om hver gang
projeksjonen kjører, så en lagret canonical-id kan være borte neste gang.

```json
{ "ok": true, "id": "3f2a…", "scope": "activity", "hidden": true, "reversible": true }
```

`404` med `{ "ok": false, "error": "Økt ikke funnet" }` hvis id-en ikke finnes
for brukeren.

### `?scope=source`

Uten scope skjules hele økta. Med `?scope=source` avvises bare **én
kilde-registrering**, og aktiviteten består på sine gjenværende kilder. Det er
til noe annet: en tur der f.eks. klokkas distanse er feil mens GPX-fila er
riktig. For «denne økta skjedde ikke» er det scope-løse kallet riktig.

Ukjent scope faller til `activity` framfor å feile — en skrivefeil skal ikke
gjøre knappen død.

## `hidden` på opplastingssvaret

`POST /api/apps/upload` returnerer nå `hidden: true` når økta du lastet opp er
svartelistet. Økta ER lagret — svaret er `ok: true` som før — men den vises
ikke noe sted i Resonans.

Feltet finnes fordi en re-eksport ellers ser helt vanlig ut for appen: brukeren
eksporterte en økt på nytt, fikk `ok: true`, og lurte med rette på hvor den ble
av. Vis det gjerne som «skjult i Resonans» framfor å tie om det.

To bivirkninger stoppes samtidig, og de er verdt å kjenne til:

- **Ingen Strava-push.** En svartelistet økt legges ikke ut på Strava, verken
  fra opplastingen eller fra `POST /api/apps/strava/sync`. Det er den ene
  bivirkningen brukeren ikke kan angre fra Resonans.
- **Ingen push-varsel.** Varsling går gjennom aktivitetslaget, som filtrerer
  svartelistede klynger.

Raden skrives fortsatt. Skrivestien skal være additiv og idempotent, og et
avvist opplastingssvar ville sett ut som en feil i appen.

## Forholdet til «rett og slett» (`/api/apps/workouts/<sessionId>`)

De to er komplementære, og valget avhenger av **hvem som skrev raden**.

| | `PATCH`/`DELETE /workouts/<sessionId>` | `POST /workouts/<id>/dismiss` |
|---|---|---|
| Virker på | rader Ekko selv skrev | økta, uansett kilde |
| Gjør | retter idretten, eller sletter raden | skjuler økta |
| Id | Ekkos `data.sessionId` | `sensor_events.id` fra lista |

**Pass på id-typen.** `/workouts/<X>` tar en Ekko-sessionId, mens
`/workouts/<X>/dismiss` tar `id` fra `GET /api/apps/workouts` — altså en
`sensor_events.id`. Samme posisjon i URL-en, to ulike id-er. Bytter du dem, får
du 404 uten forklaring.

**Når hva:**

- Feil idrett på din egen økt → `PATCH`. Turen skjedde; rett merkelappen.
- Ekte søppel du selv lastet opp → `DELETE`.
- Søppel fra klokka, Dropbox eller Strava → `dismiss`. `DELETE` svarer
  `matched: 0` her, siden de radene ikke er Ekkos å fjerne.
- Beskriver flere kilder samme søppeløkt → `dismiss`. Den treffer hele økta;
  en sletting av Ekkos rad ville bare fjernet én av beskrivelsene.

## Det Ekko må gjøre

1. Vis økt-lista fra `GET /api/apps/workouts` (alle kilder, ikke bare egne).
2. «Skjul økt» kaller `POST …/dismiss` og fjerner raden lokalt.
3. Bruk ordet **skjul**, ikke slett. Tilby gjerne angre — det er gratis.
4. Er økta Ekkos egen og fortsatt lokal, må appen også rydde sin egen kopi;
   Resonans eier bare sin side.
