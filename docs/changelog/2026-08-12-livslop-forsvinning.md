# Livsløp: måle at forrige status forsvinner

Dato: 2026-08-12
Status: pågår — tørrkjøringen avslørte to feil i fixen; rettet, ikke kjørt

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


## Tredje måling 2026-08-16: tallet gikk OPP, og det var en ny feil

Etter at matchingen ble flyttet ut av SQL viste diagnosen **269 par / 258 117 kr**, mot
271 par / 154 703 kr før. Færre par, 67 % mer kroner — umulig for en én-til-én-matching over
et *smalere* vindu (3 dager mot 7).

**Årsaken: `amount` på et par er absoluttverdi, og summeringen var fortegnsblind.** Den gamle
SQL-en hadde `CASE WHEN s.amount < 0 THEN ABS(s.amount) ELSE 0 END`; `doubleCountedTotal`
hadde ingenting tilsvarende. Så en **reservasjon på et lønnsinnskudd** — like duplisert, men
ikke forbruk — ble telt som dobbelttalt forbruk. Raden `0 d / endret` gikk fra 69 123 til
157 858 kr på uendret 43 par, som er signaturen: samme par, andre kroner.

Rettelsen: `ReservationMatch.direction` (`out`/`in`) bæres på paret, og `doubleCountedTotals`
returnerer `{ spend, income }` framfor ett tall. Histogrammet viser bare forbrukspar;
inntektsparene rapporteres for seg. Andelen «av alt forbruk» kan bare regnes mot `spend`.

Fixen skal deaktivere **begge** — et dobbelttalt innskudd blåser opp inntekten på samme måte —
men de to skal ikke summeres.

### Og en stille no-op i mitt eget verktøy

Doc-kommentaren i `EconomyDiagnosticsCard` sa fortsatt «månedsforbruket lande rundt 42 000 kr»
etter at jeg hadde meldt den rettet. En `str.replace` manglet den ledende tabulatoren i
søkestrengen, traff ikke, og **en replace som ikke treffer er en no-op uten feilmelding**.
Commit-meldingen påsto at rettelsen var gjort. Bruk `assert` på at mønsteret finnes før
erstatning — det er den samme klassen feil som resten av dette dokumentet handler om: et
verktøy som rapporterer suksess uten å ha gjort noe.


## Fjerde måling 2026-08-16: internt konsistent for første gang

| | Par | Beløp |
|---|---:|---:|
| Forbruk | 249 | 152 982 kr |
| Inntekt | 20 | 105 136 kr |
| **Sum** | **269** | **258 118 kr** |
| Uparet (restpost) | 33 | — |

Tre kryssjekker, og alle holder:

1. **Histogrammet summerer eksakt til overskriften** — 97+46+31+26+25+10+8+3+2+1 = 249 par, og
   34 244+15 187+7 865+13 905+69 123+9 464+1 079+124+1 950+41 = 152 982 kr.
2. **Forbruk + inntekt = 258 118 kr**, mot 258 117 i forrige kjøring. Fortegnsdelingen forklarer
   altså *hele* spriket, og ingenting annet endret seg.
3. **`0 d / endret` gir 69 123 kr både nå og i den ALLER FØRSTE målingen** — den som var
   mange-til-én men bare summerte negative beløp. To uavhengige veier til samme tall.

Restposten falt fra 271 → 269 par mens 33 reservasjoner nå står uparet mot 0 før. Det var hele
poenget med én-til-én.

### En femte feil, samme familie

Setningen sa «51 674 kr/mnd av et nettoforbruk på 189 037 kr/mnd — altså **16 %**». 16 % er
regnet mot **brutto** (947 780), mens kronetallene er netto. Mot netto er svaret **27 %**. To
nevnere i én setning, altså samme feilform som alt annet i denne diagnosen har hatt: to ledd i
en brøk målt mot ulike grunnlag. Rettet til én nevner.

## Fixen: bygget, med tørrkjøring, ikke kjørt

`$lib/server/economics/deactivate-superseded.ts` +
`POST /api/admin/economics/deaktiver-reservasjoner` + `ReservationCleanupCard`.

- **Leser CANONICAL, ikke rå-strømmen.** `is_active` bor på canonical, og en fix som måler på
  ett lag og skriver på et annet kan avvike uten at noe sier fra. Diagnosen måler rått fordi den
  svarer på hva banken sendte; fixen leser der den skriver. **Tørrkjøringen er derfor den
  autoritative målingen for hva som faktisk vil skje** — den kan avvike fra diagnosens 249, og
  gjør den det, er det canonical som gjelder.
- **`is_active = false`, aldri slett.** Reversibelt, og samme regel som for treningsøkter.
- **Dry-run er standard**, og skriveknappen finnes ikke i UI før en tørrkjøring har vist planen.
  `dryRun=false` må sendes eksplisitt.
- **Idempotent:** bare aktive rader vurderes, så en andre kjøring finner ingen nye par.
  `is_active = true` er dessuten et vilkår i UPDATE-en, så to samtidige kjøringer ikke kan
  telle samme rad to ganger.
- **Toppstatus utledes av dataene**, ikke hardkodet til rank 20. Med bare PENDING i vinduet blir
  ingenting regnet som bokført, altså ingen par — som er riktig.
- **Taket er 730 dager**, og over det avvises kallet: hele vurderingen hviler på en måling over
  90 dager, og et vindu på flere år ville anvendt terskler på data ingen har sett på.
- **Største par vises først** i tabellen, siden det er dem en feilaktig parring ville kostet
  mest.

Både forbruks- og inntektspar deaktiveres — et dobbelttalt innskudd blåser opp inntekten på
samme måte — men tallene rapporteres for seg og skal ikke summeres.

## Femten feil senere: hva som faktisk gikk galt hver gang

Fem feil i denne diagnosen, og **alle fem har samme form**: en betingelse jeg ikke så som en
betingelse.

| Feil | Betingelsen jeg ikke så |
|------|------------------------|
| Drift-joinen mispairet | `ORDER BY` på dato før beløp |
| «Beløpet er identisk» | `f.mk = s.mk` gjorde valutaprefikset usynlig |
| Porten | `since = sensor.lastSync` gjør `seen_count = 1` uunngåelig |
| Overføringstellingen | self-joinen var mange-til-mange |
| `orphanMatches` | `LATERAL … LIMIT 1` velger per RAD, ikke per motpart |
| Fortegnsblind sum | `CASE WHEN s.amount < 0` fantes i SQL-en, ikke i JS-en |
| «16 %» | brøkens to ledd målt mot ulike grunnlag |

Og «~42 000 kr/mnd» var et avledet tall som arvet feilen i grunnlaget uten å se usikkert ut.

**Det som til slutt avslørte hver av dem var ikke kodelesing, men en kryssjekk som ikke stemte:**
et negativt forbruk, et tall som gikk opp der det måtte gå ned, et histogram som ikke summerte
til sin egen overskrift. Derfor er tre slike kryssjekker nå bygget inn i kortet — `impossible`
på negativt nettoforbruk, retningen på lagerforholdet, og skillet mellom «målt til 1» og «ikke
målbart».


## Tørrkjøringen i prod fanget to feil FØR noe ble skrevet

Planen foreslo 269 rader. Brukeren limte inn tabellen «Største par», og den var gal:

```
28 700 kr  ut   0  endret
23 000 kr  inn  0  endret
23 000 kr  inn  0  endret
 7 600 kr  inn  0  endret
 7 600 kr  ut   0  endret
 4 000 kr  ut   0  endret
 4 000 kr  inn  0  endret
 3 668 kr  ut/ut/inn
 2 500 kr  ut/inn/ut/inn
 2 000 kr  inn/ut
```

Runde beløp, som både `inn` og `ut`, 0 dager, «endret». **Det er signaturen på interne
overføringer** — og diagnosen hadde selv målt 111 slike par til 388 132 kr.

### Feil 1: ukjent status ble lest som reservasjon

```ts
booked: (Number(row.statusRank) || 0) >= topRank
```

`bookingStatusRank` gir **0 for manglende status**, så `booked` ble falsk og raden en
«foreldreløs reservasjon». `latest_booking_status` er nullable, så rader skrevet før
statuslogikken eller uten feltet fra banken havnet alle der.

Det er samme felle som `startWorkout.type` hadde, dokumentert i CLAUDE.md: **en stille default
som gjetter en KONKRET verdi er verre enn et avslag**, og skillet som må holdes er «ikke
oppgitt» mot «oppgitt, men ukjent». Jeg siterte den lærdommen til brukeren tidligere i samme
arbeid og gjorde den så selv.

Rettelsen: `status` er tri-tilstand (`pending` | `booked` | `unknown`), lest av
`latest_booking_status` som **tekst**, aldri utledet av rangen. `unknown` deltar ikke — verken
som reservasjon eller som motpart. Typen nekter nå å representere feilen, som `savingsRole`.

### Feil 2: lisensen var målt på en annen populasjon

Jeg begrunnet beløpsmatching uten beskrivelse med at ekte gjentatte kjøp er målt til
**2 av 1 141 bøtter**. Men multiplisiteten teller gjentatte kjøp **innenfor ett API-svar**,
per (svar, status). To overføringer av 2 500 kr på ulike dager er to *separate bøtter*, ikke
multiplisitet > 1.

Så tallet sa ingenting om hvor ofte man flytter 2 500 kr — og det var nettopp det regelen ble
anvendt på. **Et kalibreringstall målt på én populasjon er ikke en garanti for en annen.**

Rettelsen: interne overføringer merkes med `findInternalTransfers` — den delte matchingen, ikke
en egen variant — og holdes utenfor på begge sider.

### Hva som virket

Kortet viste **de største parene først**, med begrunnelsen «det er dem en feilaktig parring
ville kostet mest». Det var det som gjorde feilen synlig: 28 700 kr og fire femsifrede
`inn`-beløp øverst i en liste som skulle handle om dagligvarer.

Hadde tabellen vist et tilfeldig utvalg, eller bare et totaltall, ville 269 rader blitt
deaktivert. **Tørrkjøringen var ikke en formalitet — den var det som stoppet dette.**

Utelatelsene sies nå med ord på flaten: `skippedUnknownStatus` og `skippedInternalTransfers`.
En stille utelatelse ville sett ut som full dekning.

### Sjette feil, og formen er den samme

| Feil | Betingelsen jeg ikke så |
|------|------------------------|
| … (fem tidligere, se tabellen over) | |
| Ukjent status som reservasjon | `bookingStatusRank` returnerer 0 for «ingen status» |
| Overføringer paret med hverandre | multiplisiteten var målt per API-svar, ikke per dag |

Den andre er ikke en kodefeil men en **resonneringsfeil**: jeg brukte et måletall som
sikkerhetsargument utenfor det det målte.


## Femte tørrkjøring: overføringene var HELE årsaken

| | Før rettelsen | Etter |
|---|---:|---:|
| Forbrukspar | 255 / 157 824 kr | **242 / 128 588 kr** |
| Inntektspar | 21 / 107 136 kr | **9 / 78 850 kr** |
| Ekskludert som overføring | — | **226 rader** |
| Ekskludert for ukjent status | — | **0 rader** |

### Rettelse: «feil 1» var ikke årsaken

`skippedUnknownStatus = 0`. Det fantes **ingen** rader med ukjent status i vinduet, så
rank-0-hypotesen forklarte ingenting av det vi så. Vernet er riktig å ha — `latest_booking_status`
er nullable, og en fremtidig rad uten status ville ellers blitt lest som reservasjon — men jeg
tilskrev symptomet to mekanismer, og bare **interne overføringer** var reell.

Det er samme feilform en gang til, i mildere utgave: jeg forklarte en observasjon med to årsaker
uten å måle hvilken av dem som bidro.

### `ut` ser troverdig ut, `inn` gjør det ikke

Etter ekskluderingen har forbrukssiden **ujevne beløp** — 7 654, 4 026, 3 937, 3 277, 2 476,
1 844, 1 801, 1 703, 1 690, 1 564, 1 463 — spredt over 0–3 dager, med både endret og uendret
beskrivelse. Det er signaturen på ekte reservasjon→bokføring.

Inntektssiden har fortsatt **runde beløp**: 23 000 ×2, 15 000, 12 500, 1 400. Ni par, 78 850 kr,
snitt 8 761 kr. De er ikke matchet som overføringer, altså mangler motparten på en konto vi
synker — men et innskudd på 23 000 kr som forekommer to ganger kan like godt være to
innbetalinger som én i to versjoner, og **ingen av oss kunne avgjøre hvilket**.

## To endringer som følger av det

1. **`direction` med `out` som standard.** Forbruk og inntekt har ulik troverdighet og skal
   ikke skrives i samme operasjon. Endepunktet tar `direction=out|in|all`, og UI-et har
   «Bare forbruk (anbefalt)». Rader utenfor valgt retning tones ned i tabellen framfor å
   skjules — de er fortsatt en del av funnet.
2. **Paret bærer navn og datoer.** `reservationMerchantKey`/`bookedMerchantKey` og
   `reservationDate`/`bookedDate` vises begge, side om side. **Et par man ikke kan sette navn
   på, kan man ikke godkjenne** — og da er tørrkjøringen bare et tall som ser presist ut. Dette
   er den samme lærdommen som resten av arbeidet: en flate som ikke sier hva den bygger på, kan
   ikke etterprøves.

`selectedPairs` skiller nå **funnet** fra **handlingen** i svaret, så «242 funnet, 242 valgt» og
«251 funnet, 242 valgt» ikke ser like ut.


## Brukeren forklarte restposten: overføringene er ETTBEINTE

> «Husk at vi overfører fra lønnskontoer til brukskontoer og av og til fra sparekonto til
> brukskonto eller omvendt. Runde summer innad forekommer.»

Det er en **strukturell blindsone i `findInternalTransfers`**, ikke en terskel som er feil satt:
funksjonen krever at BEGGE bein er i canonical. Kontolista har ingen lønnskonto — bare
Regningskonto, Felleskonto og to sparekontoer — så en overføring lønnskonto → brukskonto har
bare *innskuddet* hos oss. Den kan per konstruksjon ikke parvis-matches.

Det er nøyaktig de ni gjenstående `inn`-parene: 23 000 ×2, 15 000, 12 500, 1 400.

### Løsning: to uavhengige signaler, og det svakere er nødvendig

`looksLikeTransferText` leser radens **egen** tekst (`descriptionDisplay` + `typeText`) etter
overføringsord. Den er svakere enn den parvise matchingen — en observasjon at begge bein finnes
slår en lesning av ordbruk — men den er den eneste som kan se en ettbeint overføring.

De to telles **hver for seg** (`skippedInternalTransfers` mot `skippedTransferText`), så det er
synlig hvilken som gjorde jobben. Og `TRANSFER_TEXT_TERMS` er dokumentert som en **hypotese om
ordbruken**: står `skippedTransferText` på 0 mens runde beløp fortsatt er i tabellen, er ordene
feil og skal rettes framfor å stå der og se ut som et vern.

Retningen er konservativ. Dette **utelater** rader fra ryddingen, og å la en dublett stå er
trygt å rette senere; å deaktivere en ekte transaksjon er det ikke.

### Nok en stille no-op

Kolonnene `description` og `typeText` ble lagt til i SELECT-en med en `str.replace` **uten
assert**, den traff ikke, og typesjekken fanget det. Andre gang samme feil i dette arbeidet, og
begge ganger fordi jeg hoppet over å verifisere at mønsteret fantes. Lærdommen står nå to steder
i dette dokumentet fordi den åpenbart ikke satt første gang.

## Prefikset er ikke bare valuta

Brukeren sendte transaksjonslista 2026-08-16 med fire synlige par:

| Reservasjon | Bokført | Beløp | Dato |
|---|---|---:|---|
| `DKK OERESUNDSLINJEN HOER` | `OERESUNDSLINJEN HOER` | 729 kr | 2.8. |
| `USD OPENAI CHATGPT SUBSCR` | `OPENAI CHATGPT SUBSCR` | 244 kr | 2.8. |
| `SEK TYCHO BRAHE` | `TYCHO BRAHE` | 236 kr | 2.8. |
| `Lars Terje Husbyn FPL-fee Tollgaar…` | `FPL-fee Tollgaarden` | 250 kr | 13.8. |

De tre første er valutakoder. **Den fjerde er et personnavn.**

Det betyr at **beskrivelsesdriften ikke kan løses ved å vaske bort valutakoder** — en
`normalizeTxDescription` som strippet `DKK`/`USD`/`SEK` ville fortsatt latt
«Lars Terje Husbyn FPL-fee Tollgaarden» og «FPL-fee Tollgaarden» ligge i to bøtter. Ikke bygg
den; den ville sett ut som en løsning og dekket tre av fire tilfeller.

Det er også bekreftelsen på at matchingen skal ignorere beskrivelsen helt og hvile på
**eksakt beløp + konto + status**. Prefikset kan være hva som helst.

Jeg antok først at de fire lå blant de 242 parene og bare var for små til å nå
«Største par»-tabellen. **Det var galt** — se «Fjerde antagelse» nedenfor: brukeren kjørte
ryddingen, og de fire sto der etterpå.


## Fjerde antagelse: de fire var ikke blant de 242

Brukeren trykket «Deaktiver» — 242 forbrukspar — og sendte transaksjonslista etterpå. **De fire
parene sto der fortsatt.**

Det avviser antagelsen over. De ble ikke ryddet og bare skjult av en tabell som viser 25 rader;
de var aldri i settet. Og her er punktet: jeg kunne ha gjettet på årsaken — begge bokført, eller
beløp som driftet med valutakursen — og jeg hadde 50 % sjanse. Det er samme feilform som de seks
foregående, hvor hver forklaring var plausibel og feil.

### Så jeg leser årsaken av radene i stedet

`$lib/domain/economics/residual-duplicates.ts` finner par som **ser ut som** duplikater etter at
ryddingen har kjørt, og klassifiserer hvorfor de ikke ble fanget:

| Årsak | Betyr |
|---|---|
| `begge-bokfort` | Ingen PENDING-side. Matchingen kan per konstruksjon ikke danne par. |
| `ulikt-belop` | Beløpene spriker. Valutakurs mellom reservasjon og bokføring. |
| `ukjent-status` | Én side mangler status og deltar ikke. |
| `overforing` | Holdt utenfor med vilje. |
| `skulle-blitt-fanget` | Oppfyller kravene — ryddingen har ikke kjørt på det. |

**Toleransene er LØSERE enn ryddingens med vilje**: 3 % beløpsavvik mot fixens eksakte likhet. En
diagnose som bruker samme terskler som fixen kan per konstruksjon ikke finne noe fixen gikk glipp
av — og det var nøyaktig feilen i drift-målingen, som joinet på samme `merchant_key` og derfor
ikke kunne se valutatilfellene, altså nettopp dem der beløpet ville driftet. **Konklusjonen «bare
datoen flytter seg» var trukket fra en populasjon som utelukket motbeviset.**

### Kravet er suffiks-forhold, ikke en valutaliste

`hasPrefixDrift` spør om den ene beskrivelsen er den andre med noe foran. Det dekker både `DKK …`
og `Lars Terje Husbyn …` uten å vite hva prefikset er. En liste over valutakoder ville dekket tre
av fire og sett ut som en løsning — forrige avsnitt er skrevet for å hindre nettopp det.

Beskrivelseskravet finnes fordi det ellers ville rapportert to ekte Kiwi-kjøp på nesten samme
beløp som mistenkelige. Det er en diagnose, så en falsk positiv koster tillit til tallet.

### Restposten står på flaten, ikke i en logg

`residual: { pairs, byReason, samples }` på tørrkjøringssvaret, og kortet skriver årsaken i
klartekst med hva den betyr for hva som kan gjøres. `begge-bokfort` er en grense som må endres i
kode; `skulle-blitt-fanget` betyr bare at knappen ikke er trykket. En kode uten den forskjellen er
en beskjed uten innhold.

Restposten måles på det som står **igjen etter denne kjøringen** — de valgte parene trekkes fra
først. Ellers ville hvert par ryddingen fanget dukket opp som `skulle-blitt-fanget`, og tallet
hadde svart på et annet spørsmål enn brukerens.


## Diagnosen ble et endepunkt, ikke et håndarbeid

> «Det hadde vært sykt praktisk om du kunne bygget et åpent endepunkt du kunne teste mot i stedet
> for at jeg har drevet periodisk håndarbeid i et par døgn.»

Riktig, og det var den reelle kostnaden i dette arbeidet: sju målinger rettet sju feil, og hver
runde krevde at brukeren trykket en knapp i nettleseren, kopierte JSON og limte det inn. Hypotesen
kunne ikke testes uten et menneske i løkka.

### Tilgangen fantes allerede

`x-resonans-user-id` er nok i prod så lenge `RESONANS_HEADER_SECRET` ikke er satt — det er den
bevisste fail-open-en som er dokumentert i `$lib/server/user-header-auth.ts`. Den er altså ikke et
nytt endepunkt å bygge; den er en dør som står åpen. **Konsekvensen skal sies rett ut: den som
kjenner bruker-ID-en kan lese denne økonomien.** ID-en ligger i klartekst i `playwright.config.ts`,
altså i et offentlig repo. Skal det lukkes, er `RESONANS_HEADER_SECRET` bryteren.

Et *virkelig* åpent endepunkt ble ikke bygget, og det er ikke et hensyn til meg: dette er
banktransaksjoner, og en URL uten lås er en URL som blir indeksert.

### Det som manglet var en LESEvei

Eneste vei til restposten var `POST /api/admin/economics/deaktiver-reservasjoner?dryRun=true` —
altså en POST mot en SKRIVEjobb. Det er feil verktøy å polle. `GET
/api/admin/economics/duplikater` er ren lesing, og tar tersklene som parametere:

| Parameter | Standard | Hva den er til |
|---|---|---|
| `days` | 90 | vindu |
| `maxDeltaDays` | 3 | datodrift mellom to versjoner |
| `tolerancePct` | 3 | beløpsavvik som fortsatt er samme kjøp |
| `requireDescriptionMatch` | `true` | **måler hva beskrivelseskravet utelater** |
| `limit` | 100 | `truncated` sier om lista er kappet |

Det gjør hypotesetesting til **et kall framfor en deploy**. «Hvor mange par finner vi med 5 %
toleranse?» var før en kodeendring, en merge og en melding til brukeren.

`requireDescriptionMatch=false` gir falske positive **med vilje** — to ekte Kiwi-kjøp på nesten
samme beløp dukker opp. Poenget er å kunne se om kravet er en riktig grense eller en blindsone, og
det er nettopp en uutforsket grense av den typen som gjorde at drift-målingen ikke kunne se
valutatilfellene.

### Én laster, to konsumenter

`loadDuplicateCandidates` eier statusnormaliseringen, overføringsvakten og vindusberegningen; både
ryddingen og diagnosen leser gjennom den. Det er ikke plumbing — det er kalibrering, og to kopier
ville svart på litt ulike spørsmål uten at noe sa fra. Samme regel som `loadEnergyContext` i
ernæring og `readTransactions` i økonomi.

Ugyldige parameterverdier gir **400, ikke standardverdien**. En stille default her er verre enn et
avslag: svaret ville sett riktig ut mens parameteren man trodde man varierte ikke hadde virkning,
og da måler man det samme to ganger og tror det er et funn.

### `byStatusPair`: hva som STOPPER paret er ikke hva paret ER

`byReason` sier hvorfor ryddingen hoppet over; `byStatusPair` sier hvilken mekanisme det er.
`pending+booked` er livsløpet ryddingen er bygget for. `booked+booked` er noe annet — samme kjøp
bokført to ganger. Uten den andre inndelingen ser det ut som en terskel som er feil satt.


## Femte antagelse, og den første som ble MÅLT før den ble trodd

Med `GET /api/admin/economics/duplikater` på plass tok det ett kall å svare på spørsmålet som
hadde kostet et par døgn håndarbeid:

| Statuspar | Par | Kroner |
|---|---:|---:|
| `booked+booked` | 52 | 20 087 |
| `booked+pending` | 1 | 1 703 |
| `pending+pending` | 1 | 62 |

**Livsløpet hele ryddingen er bygget for sto for ETT av 54 par.** Restposten er en annen mekanisme:
SB1 bokfører samme kjøp to ganger, med ulik beskrivelse. Prefiksene, utrunkert:

```
11x dkk    4x eur             1x 02.07   1x håvard wormdal høiby
11x usd    4x 'betaling av'   1x 07.06   1x lars terje husbyn
 7x sek                                  1x per inge øye hansen
                                         1x marie helene nygaard
```

Merk at jeg **ikke** gjettet mellom de to hypotesene fra forrige runde. Svaret var «begge bokført»,
ikke «beløpet driftet» — og det var 46 av 54 par, ikke fire.

### Datoen er beviset

Abonnementene i vinduet ligger på elleve forskjellige datoer med nøyaktig to rader hver:

```
CLAUDE SUB      2026-06-28, 2026-07-27
OPENAI CHATGPT  2026-07-02, 2026-08-02
OPENAI          2026-07-02, 07-07, 07-16, 08-03
NEON.TECH       2026-07-01, 2026-08-02
```

Et månedsabonnement kan ikke belastes to ganger samme dag til samme øre. Det er den observasjonen
som gjør prefiksfamilien trygg å skrive på — ikke at prefikset ser ut som en valutakode.

### Hva som IKKE er et duplikat, og hvorfor grensa er der den er

De samme radene inneholder:

| Beskrivelse | Beløp | Dager mellom |
|---|---:|---:|
| `Ruter` ×2 | 41 kr | 2 og 3 |
| `KIWI BØLERL BØLERLIA OSLO` ×2 | 335 kr | 3 |
| `Småsparing stk avrunding` ×2 | 41 kr | 3 |
| `Påmelding for Kjetil Høiby` ×2 | 2 000 kr | 1 |

**Alle har identisk beskrivelse.** Et gjentatt kjøp produserer nøyaktig den signaturen, og
ingenting i radene skiller det fra et duplikat. To trikkebilletter er to trikkebilletter.

Derfor er `findBookedDuplicates` strengere enn reservasjonsryddingen på begge akser:
**samme dag** (ikke ±3) og **eksakt beløp**, og beskrivelsene må være ULIKE — én skal være den
andre med et prefiks foran. De to motorene kan ikke slås sammen: den løseste vakten ville gjeldt
for begge.

### Valutalista er riktig her, og var gal i matchingen

Changeloggen sier «ikke bygg en `normalizeTxDescription` som stripper valutakoder». **Det står
fortsatt, og det er et annet spørsmål.** Der handlet lista om å FINNE par — og da dekker den tre av
fire tilfeller og ser ut som en løsning. Her graderer den TILLIT: `extractPrefix` er blind for hva
prefikset er, og lista brukes bare til å avgjøre hva som skrives uten å spørre.

- **`currency` / `date`** → `high`, skrives. Mekaniske: banken formaterer samme hendelse på to måter.
- **personnavn** → `medium`, rapporteres. `Marie Helene Nygaard is` mot `is` *kan* være to
  betalinger for is, og 120 kr er ikke verdt å ta sjansen på.

`currencyConfirms` er en **uavhengig bekreftelse fra et annet felt**: canonical har en
`currency`-kolonne, så et valutaprefiks i beskrivelsen kan sjekkes mot valutaen på raden. Står
tallet på 0 mens valutaprefikser er funnet, er kolonnen ikke fylt, og graderingen hviler på
ordlista alene — det skal være synlig.

### Ordskillet i `extractPrefix`

Prefikset må slutte på mellomrom. Uten det ville `NORDEA` og `EA` gitt prefikset `NORD`, altså to
urelaterte betalinger paret på en tilfeldig delstreng. Det er en liten sjekk og den er testet, fordi
den er den eneste som hindrer at suffiks-forholdet blir en tilfeldighet.

### Hvilken rad som fjernes

**Den med prefikset.** Ikke arbitrært: `merchant_key` utledes av beskrivelsen, så `USD OPENAI`
kategoriserer dårligere enn `OPENAI` — koden er ikke en del av butikknavnet. Å beholde den rene
raden rydder i kategoriseringen som en bieffekt.

Sorteringen før matchingen er deterministisk (dato, så id). Uten det avhenger hvilken rad som
beholdes av radrekkefølgen fra basen, og to kjøringer kan gi ulikt resultat på samme data.

### `Oda.com - a6uafe` er det ene ekte reservasjonsparet

`pending → booked`, to dager, **1,85 % beløpsavvik** — og beskrivelsen bærer en unik ordre-id.
To rader med samme ordre-id kan ikke være to ordrer. Avviket er varesubstitusjon som endret
totalen, altså nøyaktig det tilfellet reservasjonsryddingens krav om eksakt beløp utelater. Det
står igjen som et kjent, navngitt tilfelle framfor å bli løst med en løsere terskel som ville
sluppet inn butikkturene.


## Tørrkjøringen, inspisert av meg selv

Første gang i dette arbeidet at en plan ble lest uten at brukeren måtte kopiere JSON.
`POST …/deaktiver-bokforte-duplikater?dryRun=true`, 90 dager:

| Prefikstype | Tillit | Par | Kroner |
|---|---|---:|---:|
| valutakode | `high` | 33 | 12 029 |
| kjøpsdato | `high` | 2 | 598 |
| personnavn | `medium` | 5 | 2 870 |

**`currencyConfirmed = 33 av 33` for valutaparene.** Canonical sin `currency`-kolonne bekrefter hver
enkelt, altså to felt som er enige — ikke en slutning fra en ordliste.

### Tillitsgraderingen fanget et tilfelle jeg ikke hadde forutsett

`Til: Påmelding for Kjetil Høiby` mot `Påmelding for Kjetil Høiby`, 2 000 kr, samme dag. Prefikset
`til:` er verken valuta eller dato, så det ble `medium` og skrives ikke. Det er riktig utfall av en
regel som ikke var skrevet med dette tilfellet i tankene — og det er argumentet for å gradere
framfor å liste opp unntak.

Merk at raden ligger blant tre: to identiske `Påmelding …` (24. og 25. juni) og én `Til: Påmelding …`
(25. juni). Restdiagnosen parer de to identiske (dagsavstand 1), denne motoren parer `Til:`-raden med
en av dem (samme dag). Én-til-én hindrer at samme rad brukes i begge.

## ~~Åpent spørsmål~~ AVKLART: 365 dager gir de SAMME 40 parene

Vinduet på ett år vurderer 2 117 rader mot 917, og finner **null nye par**. Alle 40 ligger mellom
3. juni og 13. august 2026.

To kandidater, og jeg har ikke målt hvilken:

1. **Dobbeltbokføringen er ny** — SB1 begynte å skrive valutaprefikset som en egen rad rundt juni.
2. **Utvalget er nytt** — utenlandskjøpene er sommerferie (Danmark, Sverige), og abonnementene
   (`OPENAI`, `CLAUDE SUB`, `NEON.TECH`) er ferske.

Nummer 2 forklarer ikke `Google Workspace_hoi.by` og `The New York Times`, som rimeligvis er eldre
enn juni — men «rimeligvis» er ikke en måling, og det er nettopp den typen slutning som har tatt
feil sju ganger her. **Testen er billig:** finn ut om det finnes `Google Workspace`- eller
`NYT`-rader i april/mai uten en duplikatpartner. Ikke gjort.

Konsekvensen hvis (1) er sann: dette vil fortsette å produsere duplikater, og ryddingen må kjøres
periodisk framfor én gang.


## Svaret: SB1 endret oppførsel rundt 23. juni 2026

Brukeren tippet at duplikatene bare finnes juni–august fordi det er da utenlandskjøpene skjedde.
Plausibelt, og **galt** — målt med `foreignByMonth` over 365 dager:

| Måned | Rader | Utenlandsk valuta | Valutakode-prefiks | …uparet |
|---|---:|---:|---:|---:|
| 2025-08 … 2025-12 | 284 | 0 | 0 | 0 |
| 2026-01 | 230 | 5 | **0** | 0 |
| 2026-02 | 218 | 5 | **0** | 0 |
| 2026-03 | 136 | 4 | **0** | 0 |
| 2026-04 | 202 | **17** | **0** | 0 |
| 2026-05 | 205 | 9 | **0** | 0 |
| 2026-06 | 290 | 5 | 3 | 1 |
| 2026-07 | 350 | 29 | 29 | 7 |
| 2026-08 | 208 | 13 | 13 | 3 |

**Utenlandskjøpene fantes hele tiden — 40 av dem før juni, 17 i april alene. Ingen av dem hadde
valutakode i beskrivelsen, og ingen av dem var dobbeltbokført.** Fra juni følger
`currencyPrefix` `foreignCurrency` nesten én-til-én.

Det første prefiksparet er `DKK DANSK CAMPING UNION` 23. juni. Bruddet er altså skarpt og
datert: SB1 begynte å skrive den valutaprefiksede varianten som en **egen rad**.

### Hva som gjorde testen mulig

`hasCurrencyCodePrefix` leser signalet av **én** rad. Paringen kan per konstruksjon bare se par,
så den kunne ikke svare på om det fantes *uparede* utenlandskjøp i april — og det var nettopp
fraværet av dem som var beviset. Nevneren (`rows`) måtte med av samme grunn: uten den kan «tom
måned» ikke skilles fra «måned uten utenlandskjøp».

Åttende gang i dette arbeidet at en plausibel forklaring var feil. Denne gangen kostet den
ingenting, fordi den ble målt før den ble trodd.

### To konsekvenser

**1. Ryddingen må kjøres periodisk.** Dette produserer nye duplikater ved hvert utenlandskjøp.
En engangsopprydding lar tallet drive fra seg selv igjen.

**2. Den varige fixen ligger i bøttenøkkelen, ikke i ryddingen.** Blir valutaprefikset strippet
når `merchant_key` beregnes, lander de to variantene i **samme** bøtte og upserten slår dem sammen
— da oppstår duplikatet aldri.

Det ser ut som en selvmotsigelse mot «ikke bygg en `normalizeTxDescription` som stripper
valutakoder», og det er det ikke. Den advarselen var mot å bruke stripping til å **matche**
duplikater, der den dekker tre av fire tilfeller og ser ut som en løsning. Her handler det om
**forebygging av den systematiske ene**: 33 par per 90 dager mot personnavnets 5, og fra juni
gjelder det praktisk talt hvert utenlandskjøp. Personnavn-tilfellene ville fortsatt trenge
ryddingen — men de er sjeldne og holdes alt tilbake som `medium`.

Ikke bygget. Krever en reprojeksjon av `canonical_bank_transactions` og bør veies mot at
ryddingen alt virker.

### Restpost: 11 uparede prefiksrader

Juni–august har 11 rader med valutakode-prefiks som **ikke** er i et par (1 + 7 + 3). Enten
mangler partneren (ulik dag eller ulikt beløp, altså utenfor den strenge vakten), eller banken
skrev bare den ene varianten for de kjøpene. Ikke målt.
