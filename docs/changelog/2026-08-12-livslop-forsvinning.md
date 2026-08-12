# Livsløp: måle at forrige status forsvinner

Dato: 2026-08-12
Status: pågår — måling bygget, fix ikke bygget

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

## Porten: kan forsvinning måles i det hele tatt?

Dette avgjør om modellen er anvendelig på data vi alt har, og det kan **ikke** leses av
koden.

`raw_fingerprint` er en hash over
`sensorId|accountId|txDate|amount|descriptionNorm|descriptionRaw|externalId|booking`, og
`ON CONFLICT (raw_fingerprint) DO UPDATE SET last_seen_at = NOW(), seen_count = seen_count + 1`.

- Er `externalTransactionId` **stabil innenfor en status**, treffer en uendret rad samme
  fingerprint ved neste synk, `last_seen_at` flytter seg, og forsvinning er observerbar.
- Minter SB1 en **ny id ved hver henting**, får hver synk en ny rad, `seen_count` er alltid
  1, og «forsvunnet» kan ikke skilles fra «fikk ny ID». Da må rå-strømmen nøkles på
  attributter uten ID-en før modellen kan brukes.

Indisiet peker mot det første: `sensor_events` er 3,96× canonical over et år, og med synk
hvert 5. minutt og sju dagers overlapp ville en ny id per henting gitt et forholdstall
mange størrelsesordener høyere. Men et indisium er ikke en måling.

**`seen_count`-histogrammet er hele svaret**, og det er derfor målingen kom før fixen.

## Hva som er bygget

Fire nye seksjoner i `GET /api/admin/debug-sparebank1/dedup`, alle **kun lesing**:

| Felt | Spørsmål |
|------|----------|
| `lifecycle.seenCountHistogram` + `fingerprintStableAcrossFetches` | **Porten.** Blir en rad sett mer enn én gang? |
| `lifecycle.disappeared` | Rader som sluttet å bli sett, per status, med kroner |
| `lifecycle.superseded` | Forsvunne rader med en beløpslik etterfølger — fordelt på `deltaDays` og `merchantKeyChanged` |
| `lifecycle.disappearedWithoutMatch` | Restposten: forsvunne rader UTEN beløpsmatch |

Og i `EconomyDiagnosticsCard`, med porten først: er `fingerprintStableAcrossFetches` falsk,
sier kortet at tallene under **ikke betyr noe** og hva veien videre er. Uten det skillet
ville et svar på «0 forsvunne» blitt lest som «hypotesen er feil», når det i virkeligheten
ville betydd «vi kan ikke se det».

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

## Neste steg

Kjør bankdiagnosen i prod og les i denne rekkefølgen:

1. **`fingerprintStableAcrossFetches`.** Falsk → stopp. Da er neste oppgave å nøkle
   rå-strømmen på attributter uten `externalId`, og forsvinning kan først måles etterpå.
2. **`disappeared`.** Null → banken erstatter ikke, og dobbelttellingen har en annen årsak.
3. **`superseded`.** Antall par og kroner er størrelsen på feilen. `merchantKeyChanged`
   sier hvor mye av den drift-målingen aldri kunne se.
4. **`disappearedWithoutMatch`.** Stor → beløpsmatching er ikke nok alene.

Fixen bygges ikke før punkt 1 er bekreftet. Formen den vil ta: en forsvunnet canonical-rad
med en beløpslik etterfølger settes `is_active = false` — **aldri slettet**, av samme grunn
som ellers i dette domenet.

## Verifisering

`npm run check` (0 feil) og `npm test` (3 345 tester — ingen nye, endringen er ren SQL og
visning uten domenelogikk å teste).

**Ingen måling gjort ennå.** Dokumentet beskriver instrumentet, ikke funnet.
