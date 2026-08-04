# Dagsmål: satt fra chatten, vist og justert i UI

Dato: 2026-08-04
Status: ferdig

## Kontekst

Makromålene var den siste innstillingen uten flate. `PUT /api/helse/ernaering/mal`
fantes, men uten et kcal-mål er konsekvensene stille: andelene kan ikke regnes om til
gram, `frameDay` måler «Igjen i dag» mot forbruksanslaget framfor mot et mål, og
`sendFuelNudge` returnerer `no-kcal-target` og sier ingenting.

Brukeren spurte også om det er noe som kan **settes via chat** og **ses/justeres i UI**.
Svaret var nei for dagsmålene: chatten kunne lese loggen (`query_nutrition`) og skrive
til den (`log_nutrition`), men ikke røre målene man styrer etter. Det er nå rettet i
begge ender.

## Faser

### Fase 1: Feltlogikken ut i domenelaget

`src/lib/domain/nutrition/target-settings.ts` *(ny)* med `TARGET_FIELDS`,
`TARGET_LIMITS`, `TARGET_LABELS`, `validateTargetField`, `macroPctWarning` og
`DEFAULT_MACRO_SPLIT`. 10 tester.

Tre inngangsdører skriver de samme fem tallene — endepunktet, kortet og chat-verktøyet.
Grensene og meldingene bor derfor på ett sted. Duplisert ville chatten kunnet «lagre» et
mål endepunktet avviser, eller motsatt.

### Fase 2: Én skrivevei

`src/lib/server/nutrition/save-targets.ts` *(ny)*. Endepunktet er skrevet om til å bruke
den, og chat-verktøyet bruker den samme. Begge må bevare `metricSettings`-nøkler de ikke
eier — nettopp feilen `PUT /api/tema/[id]/metric-settings` gjorde i august, da den bygde
hele objektet fra sin egen whitelist og slettet `nutrition`-målene.

### Fase 3: Chat-verktøyet

`src/lib/ai/tools/manage-nutrition-targets.ts` *(ny)*, registrert i
`api/chat/+server.ts` og i `SHARED_ASSISTANT_TOOLS`.

`action: 'get' | 'set'`. `proteinPerKg` regnes om med siste vekt, siden det er måten
protein faktisk settes. `useDefaultMacroSplit` setter 30/40/30 for den som vil ha en
fordeling uten å ha en mening om tallene.

### Fase 4: Kortet

`src/lib/components/domain/nutrition/NutritionTargetsCard.svelte` *(ny)* på
Ernæring-flaten, mellom dagskortet og energibalansen. Sammenleggbart, lukket til
vanlig, med oppsummeringslinja som hovedsak.

`latestWeightKg` lagt til i dashboard-payloaden, til proteinforslaget.

## Beslutninger

### Målene hører på Ernæring, ikke i metrikk-arket

`ThemeMetricSettingsSheet` eier terskler for helse-widgets og skriver gjennom
`/api/tema/[id]/metric-settings` med sin egen whitelist. Dagsmål er noe annet: man
justerer dem **mens man ser på loggen**, ikke i et innstillingsark bak et tannhjul.
Kroppsprofilen gikk motsatt vei — den er statiske fakta om kroppen og hører i
`/settings/profile`.

### `get` finnes som egen handling

En modell som skal endre *ett* mål må se de andre først: setter man proteinandelen til
40 uten å vite at karbo står på 55, lager man en umulig kombinasjon. Svaret bærer derfor
alltid hele settet pluss advarselen.

### Advarselen om andelene er ikke en feil

Andelene trenger ikke summere til 100 — de er tre uavhengige mål, og man kan sette bare
protein. Men summerer de til 60 eller 140, er de umulige å nå samtidig. `macroPctWarning`
holder kjeft under tre satte andeler (har man satt bare protein, er de to andre *usatte*,
ikke 0 %) og ellers når summen ligger mellom 90 og 110.

Kortet viser advarselen **live** mens man skriver, ikke først etter lagring.

### Å fjerne et mål er et gyldig valg

`null` betyr «fjern». Kortet sender tomme felt som null nettopp derfor: utelot vi dem,
ville et tømt felt betydd «ingen endring», og da kan man ikke slette et mål man har satt.
Verktøyet svarer med konsekvensen når kcal-målet forsvinner, framfor å la brukeren
oppdage at sultvarslene ble stille.

### Utkastet friskes opp ved åpning, ikke ved hver prop-endring

Chatten kan ha satt målene siden sist kortet var åpent. Men å følge propen kontinuerlig
ville overskrevet et utkast midt i skrivingen hvis dashboardet ble hentet på nytt under.
Samme mønster som `ThemeMetricSettingsSheet`.

## Verifisering

- `npm run check`: 0 feil. `npm test`: 188 filer, 2428 tester (10 nye).
- Endepunktet mot lokal Postgres: `260` avvist med «Kalorimål må være mellom 800 og
  6000»; delvis oppdatering av bare `proteinTarget` bevarte kcal; 20/20/20 ga warning om
  60 %; 30/40/30 ga ingen; ukjent nøkkel ignorert.
- Verktøyet, kjørt i dev-serveren mot samme base — alle ni tilfellene:
  `get` ga mål + `suggestedProteinG: 148` + `weightKg: 82`; `proteinPerKg: 2` ble 164 g
  med note «Regnet ut fra 82 kg»; delvis oppdatering bevarte resten; 50/50/40 ga warning
  om 140 %; `useDefaultMacroSplit` satte 30/40/30; `proteinTarget: 1800` ga samme
  feilmelding som flaten; ingen felt ga en brukbar feil; `kcalTarget: null` fjernet målet
  og svarte med konsekvensen.
- Kortet i Chromium på 390 px: lukket viste «2 600 kcal · 180 g protein»; åpnet fylte
  feltene; «Sett 30/40/30» og «Foreslå 148 g protein (82 kg)» virket; fett 60 ga live
  warning om 130 %; `260` deaktiverte lagreknappen med samme melding som serveren;
  gyldig lagring ga «Lagret ✓». Ingen konsollfeil.
- Rettet etter visuell gjennomgang: hinten skrev «1.6–2» der norsk er «1,6–2,0»
  (`String(2.0)` gir «2»).

## Merknad om denne økta

Containeren ble tilbakestilt midt i arbeidet, og den lokale klonen havnet fire commits
bak (`77eb2ec`) med objektene borte og reflogen avkuttet. Ingenting var tapt — begge
remote-refs sto på `8c8eeef` — men `git log` og `origin/main` som remote-tracking-ref
viste den gamle tilstanden, så det *så* ut som tapt arbeid. Gjenoppretting: stash av
pågående arbeid, `git fetch origin`, `git reset --hard origin/main`, `git stash pop`.

Lærdommen for neste gang: sjekk `git ls-remote origin` før du konkluderer at commits er
borte. Remote-tracking-refs er lokale kopier og lyver etter en tilbakestilling.
