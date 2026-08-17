# Livsløp: måle at forrige status forsvinner

Dato: 2026-08-12
Status: pågår — målt to ganger 2026-08-16; matcher bygget, fix ikke bygget

## Kontekst

Fase 3 sto uløst fordi vi ikke visste hvordan to versjoner av samme kjøp skulle kjennes
igjen. Brukeren sendte et skjermbilde av «Dagligvarer siden lønn» (68 transaksjoner,
20 778 kr) med synlige par:

| Sted | Beløp | Datoer | Beskrivelsesform |
|------|------:|--------|------------------|
| COOP MEGA BØLER | 255 kr | 29.7 + 28.7 | lang + kort |
| KIWI BØLERL | 113 kr | 30.7 + 29.7 | lang + kort |
| ICA NARA HAGA | 74 kr | 27.7 + 27.7 | `SEK ICA…` + `ICA…` |

Seks av tretten synlige rader var tre par.

Og deretter en modell som er bedre enn den jeg foreslo:

> «Det jeg tror er at den første statusen forsvinner når den neste dukker opp. Så om vi
> sjekker stort nok vindu og også sjekker etter ting som har blitt borte, skal vi kunne
> isolere oppdateringer og matche disse (f.eks) på sum.»

## Hvorfor modellen er bedre enn attributt-likhet

Mitt forslag var «samme beløp, samme `merchant_key`, ±3 dager, og én side nådde aldri
BOOKED». Det er en **likhetsgjetning**, og den har en farlig feilmodus: to ekte Kiwi-kjøp på
113 kr to dager på rad er helt plausibelt, og å slå dem sammen fjerner reelt forbruk. Samme
regel som for treningsøkter — å telle for mye er trygt å rette, å fjerne noe brukeren
faktisk gjorde er det ikke.

Forsvinning er en **observasjon**, ikke en gjetning. Erstatter banken reservasjonen med den
bokførte raden, slutter reservasjonen å komme i svarene. Et ekte kjøp fortsetter å komme.
Det gir tre konsekvenser som gjør fixen trygg:

1. **Beløp alene er nok som match**, fordi forsvinningen alt har fastslått at raden ble
   erstattet. Uten forsvinningskravet ville samme match slått sammen ekte kjøp.
2. **Datoen er irrelevant.** Datodriften (−1 til +3 dager) trenger ingen terskel.
3. **Beskrivelsen er irrelevant.** `SEK ICA NARA HAGA` mot `ICA NARA HAGA` løses av seg
   selv, uten å røre `normalizeTxDescription` og uten å endre nøkkelform — altså uten å
   måtte skrive om historikken.

## To rettelser av mine egne påstander

**Målingen min hadde en blindsone.** Jeg skrev i tillitsgjennomgangen at drift-målingen viste
«beløpet er identisk, bare datoen flytter seg, altså skal beløpstoleransen være null». Det
holder for datodrift-tilfellet. Men drift-spørringen joiner på `f.mk = s.mk` — **samme
`merchant_key` er et krav** — så `SEK ICA` kunne per konstruksjon aldri parres med `ICA`.
Hele valutaprefiks-mekanismen var usynlig for den. Skjermbildet fant det histogrammet ikke
kunne se.

**`normalizeTxDescription` er ikke problemet jeg trodde.** Den kollapser faktisk stedsnavnet:
`KIWI ` tar første to ord, `COOP MEGA ` første tre, så `KIWI BØLERL BØLERLIA OSLO` og
`KIWI BØLERL` gir samme nøkkel. Datoen i konflikt-målet
`(sensor_id, account_id, canonical_date, amount, merchant_key)` er det som splitter dem.
Valutaprefikset er en separat mekanisme, fordi `SEK ` står foran alle prefiksreglene.

## Porten jeg bygget — og som var feil konstruert

> **Avkreftet 2026-08-16. Avsnittet står som dokumentasjon av en gal antakelse, ikke som
> gjeldende forklaring.** Se «Porten var feil konstruert» lenger ned for hva som faktisk
> gjelder.

Resonnementet var: `raw_fingerprint` hasher
`sensorId|accountId|txDate|amount|descriptionNorm|descriptionRaw|externalId|booking`, med
`ON CONFLICT DO UPDATE SET seen_count = seen_count + 1`. Altså — trodde jeg — to muligheter:

- ID **stabil innenfor en status** → en uendret rad treffer samme fingerprint ved neste synk,
  `seen_count` vokser, forsvinning er observerbar.
- **Ny ID ved hver henting** → hver synk lager en ny rad, `seen_count` er alltid 1, og
  forsvinning kan ikke skilles fra «fikk ny ID».

**Dikotomien var falsk.** Det finnes en tredje mulighet jeg ikke tenkte på, og den er den som
gjelder: synken spør bare om det som er *endret*, så en uendret rad hentes ikke i det hele
tatt. `seen_count = 1` følger av henterutinen, uansett hva ID-en gjør.

## Hva som er bygget

Fire nye seksjoner i `GET /api/admin/debug-sparebank1/dedup`, alle **kun lesing**:

| Felt | Spørsmål |
|------|----------|
| `lifecycle.seenCountHistogram` | Blir en rad sett mer enn én gang? (Se rettelsen: nei, og det er henterutinen som avgjør det.) |
| `lifecycle.disappeared` | Rader som sluttet å bli sett, per status, med kroner |
| `lifecycle.superseded` | Forsvunne rader med en beløpslik etterfølger — fordelt på `deltaDays` og `merchantKeyChanged` |
| `lifecycle.disappearedWithoutMatch` | Restposten: forsvunne rader UTEN beløpsmatch |

Og i `EconomyDiagnosticsCard`, med porten først. Intensjonen var riktig — et svar på «0
forsvunne» skal ikke leses som «hypotesen er feil» når det betyr «vi kan ikke se det». Men
porten trakk en gal slutning om *hvorfor* vi ikke kan se det, og sendte leseren til å nøkle om
rå-strømmen. `fingerprintStableAcrossFetches` er derfor erstattet av
`singleSeenExplainedByIncrementalFetch`, `versionsPerCanonicalRow` og
`disappearanceMeasurable`.

### Fella i forsvinningsmålingen

`last_seen_at` stopper av en **godartet** grunn når transaksjonen faller ut av synkvinduet.
Sammenligningen er derfor mot det nyeste tidspunktet noen rad på **samme konto og dato** ble
sett, ikke mot nå: ble andre rader den dagen fortsatt hentet, hentet vi fortsatt den dagen,
og denne raden var ikke der. Terskelen er én time, mot en synk hvert 5. minutt.

### Restposten skal sies

`disappearedWithoutMatch` finnes fordi to helt ulike ting gjemmer seg der, med motsatt
handling: beløpet endret seg mellom versjonene (valutakurs på et utenlandskjøp, eller tips),
eller raden var en kansellert reservasjon som aldri ble noe. Er tallet stort, dekker ikke
beløpsmatching alene fenomenet. En stille utelatelse ville sett ut som full dekning.

## Målt i prod 2026-08-16, vindu 90 dager

| Lager | Rader | Forbruk |
|-------|------:|--------:|
| `sensor_events` | 925 | 655 430 kr |
| `canonical_bank_transactions` | 1 125 | 936 489 kr |
| `categorized_events` | 295 | 215 549 kr |

Statuser: BOOKED 4 485 versjoner, PENDING 1 165. Ingen utenfor rank-mappingen.
Multiplisitet: 1 123 bøtter på 1, én på 2, én på 3 (60 kr underrapportert).
Statusdrift: 34 par, 30 av dem med **eksakt 0 %** beløpsavvik. 109 foreldreløse
reservasjoner, 97 830 kr.
Livsløp: **5 650 rader, alle med `seen_count` 1.**

## Porten var feil konstruert, og konklusjonen den ga var gal

Kortet sa: «ingen rad er sett mer enn én gang → SB1 minter en ny ID ved hver henting → nøkle
rå-strømmen på attributter uten ID-en». Det ville vært bortkastet arbeid.

**Årsaken er vår egen synk, ikke banken.** `sparebank1-sync.ts` har
`const since = options.fromDate ?? sensor.lastSync`, altså et **inkrementelt** kall som bare
ber om det banken har endret siden sist. En uendret rad kommer derfor aldri tilbake, treffer
aldri `ON CONFLICT`, og `seen_count` **kan ikke** vokse — uansett hvor stabil ID-en er. Porten
målte henterutinen vår.

**Radtallet avkrefter dessuten ID-churn direkte.** Med synk hvert 5. minutt og sju dagers
vindu ville en ny ID per henting gitt ~2 000 versjoner per transaksjon, altså millioner av
rader. Målt: 5 650 rå mot 1 125 canonical, **~5 versjoner per kjøp**. Banken sender en håndfull
versjoner, ikke én per henting.

Hypotesen er altså **uavklart, ikke avkreftet** — og den er utestbar med dagens henterutine:
et fravær og en uendret rad ser identiske ut når man bare spør om det som er endret.
Forsvinning krever en **fullstendig vindusavstemming** som ignorerer `lastSync` og henter
siste N dager i sin helhet. Den er ikke bygget.

Lærdommen er den samme som med drift-joinen: **et instrument kan bekrefte en konklusjon det
ikke har grunnlag for.** Begge gangene fordi målingen hadde en betingelse jeg ikke tenkte på
som en betingelse — `f.mk = s.mk` der, `lastSync` her.

## Tre feil i diagnosen, rettet samtidig

1. **Overføringstellingen var mange-til-mange.** SQL self-joinen ga 950 050 kr i «interne
   overføringer» mot 936 489 kr totalt forbruk — mer enn alt som fantes — og kortets nettotall
   ble **−4 581 kr/mnd**, et negativt forbruk. Tre uttak på 500 og tre innskudd på 500 samme
   dag ga ni par. Nå brukes `readTransactions`, altså **samme én-til-én-matching flaten
   bruker**. At diagnosen hadde sin egen variant var nøyaktig feilen fase 1 gikk løs på,
   gjentatt i verktøyet som skulle avdekke den. Et negativt nettoforbruk flagges nå som umulig
   framfor å vises som et tall.
2. **`sensor_events` kom inn LAVERE enn canonical** (0,7×), og kortet sa «det er forventet».
   Teksten godkjente begge retninger, og dermed også den umulige: rå-strømmen kan ikke ha
   færre kroner enn den deduperte utgaven av seg selv. Nå sier kortet fra under 0,95×. Årsaken
   er uavklart — enten mangler `sensor_events` rader canonical har, eller de to vinduene måler
   ulike datofelt (`timestamp` mot `canonical_date`).
3. **`disappeared`/`superseded` rendres ikke lenger.** De hentes fortsatt, men kan ikke tolkes
   uten avstemmingen, og å vise dem ville invitert til samme feilslutning.

## Det målingen faktisk ga: multiplisitet er et ikke-problem

«Sju øl samme sted samme kveld» var halve begrunnelsen for fase 3. Målt: **2 av 1 125 bøtter**
hadde ekte gjentak, 60 kr over 90 dager. Det er avklart og kan legges bort.

**Og det låser opp den trygge regelen.** Faren ved å matche reservasjon mot bokført på beløp
uten beskrivelse var å slå sammen to ekte kjøp. Hyppigheten er nå målt til 0,2 % av bøttene, og
PENDING-mot-BOOKED er dessuten en tryggere par-form enn to vilkårlige rader: to reelle kjøp gir
to BOOKED, ikke én PENDING og én BOOKED.

Derfor er `orphanMatches` lagt til — foreldreløs reservasjon mot bokført rad på samme konto og
**eksakt samme beløp, uten `merchant_key`-kravet**. Det er nettopp de parene drift-målingen
aldri kunne se, og prod viste tre av dem i ett enkelt skjermbilde av dagligvarer. 109 foreldreløse
reservasjoner à 97 830 kr over 90 dager er ~10 % av alt «forbruk» i vinduet.

## Neste steg

1. Kjør diagnosen igjen og les **«Reservasjon mot bokført»**. Antall par og kroner er størrelsen
   på feilen; raden «Beskrivelse: endret» er kroner den forrige målingen var blind for.
2. Er tallet stort, bygg fixen: `is_active = false` på den foreldreløse reservasjonen når en
   bokført rad med eksakt samme beløp finnes på samme konto innen ±3 dager. **Aldri slett.**
3. Vindusavstemmingen (full henting uten `lastSync`) er en separat oppgave, og bare nødvendig
   hvis punkt 2 ikke dekker nok. Brukerens modell er verdt å teste, men den er ikke lenger
   forutsetningen for å fikse dette.

## Andre måling 2026-08-16, etter at diagnosen var rettet

| Felt | Verdi |
|------|------:|
| canonical, 90 dager | 1 136 rader, 942 406 kr |
| interne overføringer (én-til-én) | 110 par, 386 132 kr |
| nettoforbruk | **187 897 kr/mnd** |
| reservasjon mot bokført | 271 par, 154 703 kr |
| — av dem med endret beskrivelse | 110 par, 103 165 kr |
| multiplisitet > 1 | 2 bøtter, 60 kr |

### Rettelse: «~42 000 kr/mnd» var mitt eget feiltall

Jeg har gjentatt gjennom hele dette arbeidet at reelt forbruk er **~42 000 kr/mnd** og at
flatens «180 424 kr/mnd» derfor var 4,3× for høyt og en bug.

**Det var galt, og feilen var min.** Tallet kom fra første måling:
`(1 583 723 − 1 084 033) / 12 = 41 641`. Men `1 084 033` var overføringssummen fra
mange-til-mange-joinen, altså kraftig overtelt. Med korrekt én-til-én-matching er
nettoforbruket **187 897 kr/mnd**, og flatens 180 424 var i praksis riktig hele tiden.

Konsekvenser som må rettes i hodet, ikke bare i koden:

- **Dekningen på ~0,5 måneder på sparekontoflaten er ikke en åpenbar bug.** Den åpne saken jeg
  førte opp — «180 424 er 4,3× for høyt» — er lukket, og lukket motsatt vei.
- Trekker man fra de dobbelttalte reservasjonene (~52 000 kr/mnd) lander det på
  ~136 000 kr/mnd. Fortsatt høyt, og nå er det et *spørsmål om hva som ligger i tallet*
  (boliglån? begge kort? faste regninger?) framfor en mistanke om en dedupfeil.
- Lærdommen: **et avledet tall arver feilen i grunnlaget uten å se usikkert ut.** 41 641 ser
  like presist ut som 187 897.

### Den samme én-til-én-feilen, gjentatt i samme fil

`orphanMatches` var en LATERAL join med `LIMIT 1` per reservasjon. Den reserverer ikke
motparten, så tre PENDING på 255 kr på samme konto kunne alle peke på det **samme** bokførte
kjøpet. Nøyaktig samme feil som overføringstellingen hadde, gjentatt noen linjer unna i samme
fil, i samme runde som jeg fikset den andre.

Grunnen den overlever: en `JOIN LATERAL … LIMIT 1` *ser* ut som «velg én», og gjør det — per
rad, ikke per motpart. Derfor er matchingen nå flyttet ut av SQL til
`$lib/domain/economics/reservation-matching.ts`, ren og med 15 tester, hvorav én er nettopp
denne regresjonen. Samme grep som `findInternalTransfers`: parring hører i domenelaget, ikke i
en spørring.

`271 par / 154 703 kr` fra forrige kjøring er derfor et **øvre anslag**. Det korrigerte tallet
kommer av neste kjøring.

### Modulen er fixens motor, ikke bare en måling

`matchReservationsToBooked` er skrevet for å bli brukt av fixen:

- **Eksakt beløp**, ingen toleranse — 33 av 35 par hadde 0 % avvik, og en toleranse ville
  åpnet for å slå sammen ulike kjøp.
- **`merchant_key` er preferanse, ikke krav.** Det er hele forskjellen fra drift-målingen, og
  det er forsvarlig fordi ekte gjentak er målt til 2 av 1 136 bøtter.
- **Én-til-én**, håndhevet ved at motparten fjernes fra puljen.
- **Negativ datoforskjell tas med** — prod viste −1 og −2 dager, så retningen er ikke gitt.
- `unmatched` rapporteres, så restposten ikke forsvinner stille.

Fixen setter `is_active = false` på reservasjonen. **Aldri slett.**

## Verifisering

`npm run check` (0 feil) og `npm test` (3 416 tester). Ingen nye tester — endringene er SQL og
visning; testene kommer med fixen.
