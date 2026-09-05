# Livvidde i helsebriefingen

Dato: 2026-09-05
Status: ferdig

## Kontekst

Vekt-pushen åpner en chat. Brukeren spurte der: «Jeg er 187 cm og har en
livvidde på 101 cm nå. Hvordan vil denne utvikle seg mot 85 kg?»

Coachen svarte at «vi har ikke historikk på livvidde her», ga et **grovt,
praktisk anslag på 8–12 cm** på en slik vektnedgang, og anbefalte deretter å
*begynne å måle livvidde fast, én gang i uka, samme tidspunkt*.

Tre ting er galt med det svaret, og ingen av dem er modellens skyld:

1. **8–12 cm er et populasjonstall**, presentert midt i en samtale om brukerens
   egne kurver. Det er nøyaktig det `query_*`-verktøyene og briefingen finnes
   for å slippe.
2. **Rådet er å begynne med noe appen alt har.** Livvidde logges under
   `/api/helse/livvidde`, har sin egen motor i `$lib/domain/health/waist.ts`, og
   tegnes i `WeightTrendChart` på samme x-akse som vekta — nettopp fordi «vekta
   står stille mens livvidda faller» er hele grunnen til at den måles.
3. **Modellen kunne ikke vite hvilken av delene som var sann.** «Vi har ikke
   historikk» var en påstand om dataene, men det den beskrev var sin egen
   kontekst.

Årsaken: `loadWeightDashboardData` returnerer `waist` og `waistDays`, men
`toBriefingWeight` plukket seks felter ut av payloaden og lot livvidda ligge.
Og det finnes **ingen livvidde-verktøy** — `query_weight` dekker trend,
milepæler og kroppssammensetning, ikke livvidde. Livvidda var altså utilgjengelig
fra chatten på alle veier samtidig.

## Faser

### Fase 1: `WaistStatus` går hel inn i briefingen

`BriefingWeight` fikk `waist: WaistStatus | null`, og `toBriefingWeight` sender
`payload.waist` videre urørt. `describeWaist` i `health-briefing.ts` rendrer
linjene.

### Fase 2: Forholdstallet fikk to desimaler

Fanget av en test underveis: `num()` runder til én desimal, så midje/høyde 0,54
ble «0,5» — presis samme tall som referansen setningen sammenligner med. `ratio()`
gir to desimaler.

## Beslutninger

**Livvidde står i VEKT-seksjonen, ikke i en egen.** «Vekta står stille mens
livvidda faller» kan bare formuleres av noen som ser begge tallene samtidig. Det
er den samme begrunnelsen som at livvidda tegnes i `WeightTrendChart` framfor i
sin egen graf; to seksjoner ville blitt lest som to saker. En test vokter at
`LIVVIDDE:` ikke finnes som egen overskrift.

**`WaistStatus` gjenbrukes HEL, i motsetning til vekt og trening.** De to har
sine egne flate former fordi dashboard-payloadene er store; `WaistStatus` er alt
lite og rent. Og en oversettelse er nettopp der feltet ble borte sist — en
utplukking som glemmer et felt sier ikke fra.

**«Ikke logget» får en linje, mot regelen om tomme rubrikker ellers.** Regelen
finnes fordi en modell som ser mange «ukjent» begynner å gjette. Her er fraværet
motsatt: det er nettopp fraværet som utløste gjetningen. Linja er derfor ikke en
tom rubrikk, men en fakta med et neste steg — og den sier eksplisitt at livvidda
ikke skal anslås fra vekta.

**Støygulvet gjelder også her.** Under `WAIST_NOISE_CM` (1 cm) sier blokka
«uendret» og hvorfor, aldri et tall. Målebåndet spriker 1–2 cm for utrent hånd,
altså like mye som to måneders framgang.

**«Gammel måling» og «gammel trend» er to setninger.** `stale` (28 dager) sier
at trenden ikke beskriver nå; `fresh` (60 dager) sier om tallet kan kalles «nå»
i det hele tatt. En livvidde fra i vår er ikke dagens, og en modell som ikke får
vite det sammenligner den med dagens vekt som om de var samtidige.

**Forbeholdet om midje/høyde står i setningen, ikke i en fotnote.** Vi måler
livvidde og høyde; vi diagnostiserer ingenting.

## Verifisering

- Ni nye tester i `health-briefing.test.ts`: trend og rå måling side om side,
  endringen med spennet den er målt over, «uendret» under støygulvet uten et
  tall, forbeholdet i setningen, to desimaler på forholdstallet, manglende
  høyde, stale mot ikke-fersk, målinger igjen til trend, «ikke logget» for både
  `null` og 0 målinger, og at blokka står i VEKT-seksjonen.
- `npm test`: 4561 tester i 314 filer, grønt. `npm run check`: 0 feil.
- Forhåndsvist mot fem tilstander (målt/støygulv/gammel/uten høyde/ikke logget).

## Kjent rest

- **Fortsatt ingen livvidde-VERKTØY.** Briefingen dekker nå-tilstanden;
  historikk («hvordan har livvidda utviklet seg siden april?») kan ikke hentes.
  Et `query_waist` — eller livvidde som en `queryType` på `query_weight` — er
  den naturlige neste veien.
- ~~**Ernæring er fortsatt ikke i briefingen.** `query_nutrition` finnes og
  sendes alltid, men ingenting ber modellen om å bruke det i en vektsamtale.~~
  Rettet i `2026-09-05-ernaering-i-vektsamtalen.md` — verktøyet står nå i
  verktøyvalget i helse-prompten. Briefingen selv er fortsatt uten ernæring, og
  det er et bevisst valg (se det dokumentet).
- Prosjektsjonen mot en målvekt («hvor mye faller livvidda mot 85 kg?») kan
  fortsatt ikke besvares fra data — den krever brukerens egen kg/cm-sammenheng
  over tid, og den finnes først når det er nok målinger.
