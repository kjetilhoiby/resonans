# Push-varsler krasjet PWA-en etter deploy

Dato: 2026-08-11
Status: ferdig (ikke reprodusert)

## Kontekst

Første øktvarsel etter at push ble slått på for Ekko-opplastingen: brukeren
trykket på varselet, og PWA-en krasjet. Hypotesen var «gammel PWA-kode med ny
URL», og den holder.

Appen har allerede en versjonsvakt i `+layout.svelte`:

```js
beforeNavigate(({ willUnload, to }) => {
  if (updated.current && !willUnload && to?.url) location.href = to.url.href;
});
```

Den er skrevet for nettopp denne feilen — «så vi aldri prøver å laste chunks som
ikke finnes lenger». Men service workerens `notificationclick` gjorde:

```js
await windowClient.focus();
windowClient.navigate(targetUrl);
```

`WindowClient.navigate()` er en navigasjon initiert **utenfra appen**, og passerer
derfor aldri `beforeNavigate`. Vakten var med andre ord blind for den ene
inngangen som oftest treffer en app som har ligget lenge i bakgrunnen.

Og så kappløpet: når varselet trykkes, fyrer `visibilitychange` samtidig, som
vurderer `location.reload()` ved lang bakgrunnstid. To navigasjoner i samme
øyeblikk i en iOS-PWA gir blank skjerm — og «lenge skjult» er alltid oppfylt når
man åpner appen fra et varsel.

## Endring

- **Service workeren ber klienten rute selv**: `postMessage` med en
  `MessageChannel` for bekreftelse. Klienten kaller `goto()`, som går gjennom
  `beforeNavigate` og dermed gjennom versjonsvakten.
- **Fallback beholdt**: svarer ingen innen 400 ms — gammel klient uten lytteren,
  eller en opptatt klient — gjøres `navigate()` som før. Et dødt varsel er verre
  enn en full sidelast.
- **`routingFromNotification`** gater `visibilitychange`-reloaden mens et varsel
  ruter, så de to ikke kan fyre samtidig.
- **`skipWaiting()` flyttet inn i `waitUntil`.** Utenfor kunne den nye workeren
  aktivere før `cache.addAll` var ferdig, og `activate` sletter da alle gamle
  cacher mens en side fortsatt kjører gammel kode.

## Beslutninger

**Klienten bekrefter FØR den navigerer.** Bekreftet den etterpå, ville
`goto()`-tida spist opp ack-vinduet, SW-en gjort fallback, og vi hadde fått
nøyaktig de to samtidige navigasjonene fiksen skal fjerne.

**400 ms ack-vindu.** Kort med vilje: svarer klienten ikke innen da, er den enten
gammel eller opptatt, og en full navigasjon er riktigere enn å vente.

**Fallbacken beholdes selv om den er den skjøre stien.** En klient som kjører
forrige versjon har ikke lytteren, og for den er `navigate()` det eneste som
finnes. Den er ikke verre enn før — den er bare ikke bedre.

## Verifisering

- `npm test`: 3210 tester passerer. `npm run check`: 0 feil. `npm run build`
  går gjennom.

**Ikke reprodusert.** Krasjet skjedde på en iOS-PWA i prod og lot seg ikke
gjenskape her. Diagnosen er utledet av koden, ikke observert: at
`WindowClient.navigate()` går utenom `beforeNavigate` er sikkert, at det var
nettopp kappløpet med reloaden som ga blank skjerm er den mest sannsynlige av to
mekanismer. Den andre — en lat `_app/immutable`-chunk fra forrige deploy som
404-er — dekkes av den samme fiksen, siden versjonsvakten nå gjelder.

**Merk at fiksen først virker fra den deployen ETTER at den er ute:** klienten
som skal ta imot meldingen må selv ha lytteren. Trykker du et varsel på en app
som fortsatt kjører dagens kode, går det via fallbacken.
