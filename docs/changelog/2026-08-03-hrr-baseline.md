# HRR-baseline: prioritert hvilepuls og manuell makspuls

Dato: 2026-08-03
Status: ferdig

## Kontekst

Spørsmålet var om punktpulsen fra vekta kan brukes til å regne HRR. Svaret er ja —
den er `restHr`-leddet i heart rate reserve (`maxHr − restHr`), som bærer
TRIMP-skåringen i `effort-service`, sonefordelingen i `computeHrZoneDistribution`
og %VO2max-proxyen i `vdotFromPaceAndHr`.

Men gjennomgangen avdekket at grunnlaget under HRR var feil på to måter, og at den
ene feilen var noe jeg selv innførte dagen før.

## Feil 1: all `hr_min` i én bøtte

`getEffortBaseline` samlet *alle* `hr_min`-verdier fra 30 dager og tok medianen.
`hr_min` betyr tre helt ulike ting:

| Kilde | `hr_min` er | Hvilepuls? |
|---|---|---|
| økt (`workout`) | lavest puls **under trening** | nei, typisk 90–120 |
| dag (`activity`) | lavest puls over døgnet | nesten |
| søvn (`sleep`) | lavest puls om natta | ja, best |

Medianen over den blandede bøtta er ingen av dem. Og `hr_average` fra søvn ble
lagt i samme bøtte med et 30–80-filter som rest-proxy.

**Verre: dette var en regresjon jeg shippet.** Da søvn-`hr_min` ble hentet inn i
`2026-08-03-withings-flere-felt.md`, endret bøttas sammensetning seg — og dermed
effort-skåringen — uten at noe i koden sa fra.

Rettet med prioritering framfor pooling: `sleep_min` → `scale_spot` → `daily_min` →
`sleep_avg` → default. Første kilde med minst tre observasjoner vinner, og medianen
tas *innenfor* kilden. Økt-`hr_min` er helt ute av hvilepulsberegningen.

Hver kilde har sitt eget plausible område: en sovende puls over 90 er ikke hvile,
mens en stående måling fra vekta naturlig ligger høyere (35–110).

## Feil 2: makspuls som `Math.max(...)`

Maksimum av et støyende sett er systematisk for høyt — én pulsspike satte
makspulsen for 30 dager. Og for høy makspuls gir *for lav* VDOT og for lave soner.

To ting gjort:

1. **Manuell makspuls** i `themes.metricSettings.maxHr.goal` på Helse-mortemaet,
   samme konvensjon som søvnmålet. Den vinner alltid når den er satt og troverdig
   (140–220). Dette er den store feilkilden: 10 slag feil makspuls flytter VDOT 3,6
   poeng, mot 1,6 for 10 slag feil hvilepuls. Å bare fikse hvilepulsen ville flyttet
   den minste av de to feilene.
2. **~90-persentil framfor maks** når den utledes. Fra fem observasjoner og opp
   forkastes alltid minst den høyeste.

## Hvorfor punktpuls ikke er øverst

Vektas punktpuls (Withings type 11) tas **stående**, rett etter at man er opp, og
ligger typisk 5–15 slag over ekte hvilepuls. Søvn-`hr_min` er nærmere sannheten.

Punktpulsens verdi er at den er daglig og pålitelig — man veier seg de fleste
morgener, mens søvndata krever at klokka var på. Derfor: søvn først, punktpuls som
utfylling.

## Feil 3: terskel-arket slettet ernæringsmålene

`PUT /api/tema/[id]/metric-settings` bygget hele `metricSettings` fra en whitelist
og skrev det over. Da ernæringsloggeren begynte å lagre dagsmål i
`metricSettings.nutrition`, betydde det at målene ble **slettet** i det øyeblikket
noen lagret terskler i arket — en stille sletting av data brukeren satte et helt
annet sted.

Endepunktet bevarer nå nøkler det ikke eier.

## Feil 4: terskel-arket åpnet seg aldri

Funnet ved å faktisk klikke tannhjulet i nettleseren — ingen automatisk test hadde
åpnet arket før.

`fields` ble bare fylt i en `$effect`, så under den *første* renderen av
`{#if open}` var kartet tomt og `bind:value={f.goal}` kastet «Cannot read
properties of undefined (reading 'goal')». Arket kom aldri opp; tannhjulet på Helse
gjorde ingenting.

`fields` initialiseres nå ved deklarasjon, og effekten er bare oppfriskning ved
gjenåpning. Eldre bug enn dette arbeidet.

## Verifisering

- `npm run check`: 0 feil, 0 advarsler.
- `npm test`: 2175 grønne (fra 2156), 19 nye.

**Mot en ekte database**, med søvn (`hr_min` ~51), økter (`hr_min` 95, én
`hr_max`-spike på 215) og punktpuls seedet:

| | hvilepuls | makspuls | HRR |
|---|---|---|---|
| **gammel logikk** | 58 (blandet median av 18 verdier, 7 fra økter) | 215 (spiken) | 157 |
| **ny logikk** | 51 (`sleep_min`) | 193 (spiken forkastet) | 142 |

15 slag forskjell i HRR, altså 10 %. Regnet ut fra samme rader med SQL.

Med manuell makspuls satt til 186: `restHr=51 (sleep_min) maxHr=186 (manual)
HRR=135`.

**Bevaring:** satte `nutrition.kcalTarget` direkte i basen, lagret terskler via
arket med `maxHr: 186`, og bekreftet at resultatet ble
`{maxHr, sleep, nutrition}` — ernæringsmålene overlevde.

**Arket** åpner seg nå i Chromium uten konsollfeil, med makspuls som eget felt og
186 lest tilbake fra basen.

## Gjenstår

**Pulsfall mellom intervalldrag** — heart rate *recovery*, som er en sterkere
formmarkør enn reserven. Trackpoints med puls ligger alt lagret fra Ekkos
`.gpx`/`.tcx`-opplastinger, men en GPX stopper når økta stopper, så de 60 sekundene
etter siste innsats mangler oftest. Intervalløkter har fysiologien innebygd i
pausene, og der finnes dataene.
