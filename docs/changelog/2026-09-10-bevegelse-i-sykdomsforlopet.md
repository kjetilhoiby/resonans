# Bevegelse i sykdomsforløpet

Dato: 2026-09-10
Status: ferdig

## Kontekst

Da forløpsflaten ble bestilt, var «jeg har fått lite bevegelse disse dagene» en
av de tre tingene brukeren selv nevnte — ved siden av vekta og symptomene. De to
andre kom med; bevegelse sto igjen som kjent rest.

Det var den svakeste utelatelsen av dem, fordi bevegelse er halve svaret på «hva
har skjedd med kroppen siden det begynte». Vekta og sovepulsen sier hva som
skjedde MED deg; skrittene sier hva du klarte.

## Faser

### Fase 1: én leser for døgnraden

`daily-heart-rate.ts` → `daily-activity.ts`. Withings' `activity`-hendelse er
ETT sammendrag per døgn, og alle tre feltene bor i den samme raden — så én
spørring og tre kart, ikke tre lesere som henter de samme radene etter hverandre.

`readDailyActivity` returnerer `{ hrMin, steps, activeMinutes }`. Sammenslåing
per dag følger feltets egen regel: puls er et MINIMUM (ta det minste), skritt og
minutter er SUMMER (legg sammen). Pulsdelen er uendret, forbeholdene i filhodet
likeså.

### Fase 2: to rader

**Skritt** og **Aktive minutter**, plassert rett etter Søvn: begge er ATFERD,
ikke fysiologi, og hører sammen med søvnen framfor mellom HRV og temperaturen.

Begge markeres på `down`. Et fall er det brukeren la merke til, og markeringen
er den samme dempede gule som ellers — ingen dom, ingen varselfarge.

## Beslutninger

**Aktive minutter er `moderate + intense`, aldri `soft`.** Withings teller
`soft` som «lett aktivitet», og en vanlig kontordag gir timevis av den bare av å
gå rundt. Tas den med, måler raden omtrent hvor mange timer klokka satt på
håndleddet — altså flatt gjennom et forløp der nettopp intensiteten forsvant.
Navnet står i kilden, fordi «aktive minutter» betyr ulike ting i ulike apper.

**To rader, ikke én.** Skritt og intensitet er ikke to visninger av det samme:
en dag i senga med en tur på butikken gir skritt uten intensitet, en spinningtime
gir intensitet uten mange skritt. I et forløp er begge svar man vil ha — «kom jeg
meg ut av senga» og «orket jeg noe». Samme begrunnelse som at
`weekly-intensity.ts` holder rolig og kvalitet som to uavhengige spørsmål framfor
ett forholdstall.

**Tusenskille under `decimals === 0`** (`formatEpisodeValue`, delt med
komponenten). Skritt er den eneste raden som når fire sifre, og «8240» leses ikke
som et antall i en kolonne der naboene er «49» og «6,8». Regelen henger på
desimaltallet framfor på rad-id-en fordi ingen annen heltallsrad kan komme i
nærheten: puls topper på ~200, nivået går til 5. Hardt mellomrom, så tallet ikke
brekker midt i to.

Formattereren er **eksportert og brukt av `SickEpisodeTrack.svelte`**, som skrev
sin egen `toFixed` fram til nå. To formatterere ville gitt «8 240 skritt» over en
setning som sa «8240».

**Romslig aksegulv.** `steps: 3000` — skritt spriker tusenvis mellom to helt like
dager, og uten gulvet tegnes normal variasjon som et stup. `activeMinutes: 20` —
her er null en vanlig verdi, og gulvet er det som holder en rolig uke flat framfor
å blåse opp ett enkelt drag.

**Ingen «du beveget deg for lite».** Forløpet beskriver. At bevegelsen falt under
en infeksjon er en observasjon, ikke en anklage, og at den kommer tilbake er
gjenopprettingen man ser etter.

## Verifisering

- `npm run check` — 0 feil
- `npx vitest run` — grønt
- Fire nye tester på `formatEpisodeValue` (tusenskille, tresifret urørt,
  desimaltall urørt, minustegn)
- Mocken i `/design/flater` har begge radene, med et fall gjennom forløpet

Kjent rest: bevegelse er ikke i `describeEpisode`-overskriften, og
`canonical_workouts` (altså faktiske økter) er fortsatt ikke en rad — skrittene
sier at man var oppe, ikke at man trente.
