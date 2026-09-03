# «Tilkoblingen har utløpt» var normaltilstanden

Dato: 2026-09-03
Status: ferdig

## Kontekst

Rett etter at token-arbeidet i
`2026-09-03-sb1-token-en-vei-inn.md` var deployet, viste kortet i
`/settings/sources` dette kl. 12:52:

> **SpareBank 1** · Tilkoblingen har utløpt
> Sist synket: 3.9.2026, 11:14:57
> [Re-autentiser SpareBank 1]

Brukeren logget inn. **Ingenting var galt.** Synken kl. 11:14:57 hadde gått bra
— `lastSync` skrives bare på suksess-stien, sammen med `lastError: null` — og
refresh-tokenet lå friskt i raden.

Regelen var:

```ts
const isExpired = !hasRefreshToken || (expiresAtMs !== null && expiresAtMs < Date.now());
```

`config.expiresAt` er **ACCESS-tokenets** utløp. Det skrives av innloggingen og
av hver refresh med tokenets egen levetid — rundt en time, eller vårt korte
fallback-vindu når `expires_in` mangler. SpareBank1 synker hver 6. time. Access-
tokenet er altså utløpt **det meste av døgnet**, og det er nettopp det
refresh-tokenet finnes for.

Kortet ba derfor om innlogging i fem av seks timer. Verre: den grenen
**erstattet hele kortet** — «Synk nå», importvalgene og `lastError` lå bak
beskjeden, så den ene tilstanden som faktisk betyr noe var usynlig i akkurat
den situasjonen den skulle vises.

**Dette er sannsynligvis en stor del av «jeg må alltid logge inn på nytt mot
sb1».** Flaten sa det. De fire token-feilene i forrige changelog var ekte og er
rettet, men hvor mye av symptomet de sto for er nå usikkert — en innlogging
brukeren blir bedt om, ser ut som en innlogging brukeren trengte.

## Faser

### Fase 1: Regelen skilles ut og får tester

`$lib/domain/sensor-connection.ts`: `needsReauthentication` (bare
«refresh-tokenet mangler») og `hasConnectionWarning` (det, eller en `lastError`).
Access-tokenets utløp er **med vilje ikke et argument** — det er ikke et
spørsmål brukeren kan svare på.

### Fase 2: Endepunktet slutter å kalle det «utløpt»

`isExpired` er borte fra `/api/sensors/sparebank1/status`. I stedet
`needsReauth` (handlingen) og `accessTokenExpired` (diagnose, ikke et varsel).
Feltet er fjernet framfor omdøpt: begge leserne er oppdatert, og en leser som
fortsatt spurte etter `isExpired` skal feile synlig, ikke stille bli `undefined`.

### Fase 3: Flaten viser feilen der den skjer

Re-autentiseringsgrenen fyrer nå bare på `needsReauth`. Feiler en synk mens
refresh-tokenet finnes, står feilteksten på det ellers normale kortet — med
knappen ved siden av, ikke i stedet for. Vi kan ikke se om SB1 har avvist et
lagret token uten å prøve, så begge veier ut må være åpne.

Varselmerket på `/settings` teller nå `needsReauth` eller `lastError` for SB1.

## Beslutninger

**«Utløpt» skal bety «bare en innlogging hjelper».** Et statusord som er sant
det meste av tida er ikke et varsel, det er bakgrunnsstøy — og bakgrunnsstøy
brukeren *handler* på er verre enn den man ignorerer: hver unødvendige
innlogging roterer token-familien.

**Et avvist refresh-token ser identisk ut med et friskt.** Det ligger i raden
uansett. `lastError` er eneste signal, og derfor står den nå ved siden av
knappen framfor bak den.

**Withings og Google Sheets er IKKE konvertert.** De svarer fortsatt med
`isExpired` i den gamle betydningen, og `/settings`-merket leser dem som før —
kommentert på stedet. De har ikke vist symptomet (Withings synker hvert 5.
minutt, så access-tokenet er sjelden utløpt når man ser på kortet), men regelen
er den samme og de bør følge etter.

## Verifisering

- `npm run check` — 0 errors, 0 warnings.
- `npm test` — 4271 tester i 299 filer, alle grønne (7 nye).
- `npm run build` — grønt.
- Målingen som utløste dette: vellykket synk 11:14:57, kortet ba om
  re-autentisering 12:52, `lastError` var null hele tiden.

## Kjent rest

**Hvor stor del av de fire innloggingene som var denne feilen, vet vi ikke.**
Den forklarer hvorfor brukeren ble BEDT om å logge inn; token-kjeden kunne vært
brutt uansett. `[sb1-token]`-loggen svarer på den delen — om refresh faktisk
fyrer, og om SB1 roterer.
