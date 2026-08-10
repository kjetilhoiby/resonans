# Tema-chatten åpner ved siste melding

Dato: 2026-08-10
Status: ferdig

## Kontekst

«Alltid når jeg åpner en chat kommer jeg til eldste melding og må scrolle.»

Tema-chatten hadde to feil som forsterket hverandre, og den ene var verre enn den så ut:

**1. Loaderen hentet de 50 ELDSTE meldingene.**

```ts
.orderBy(asc(messagesTable.createdAt))
.limit(50)
```

`asc` + `limit` gir *begynnelsen* av tråden. På en samtale med 300 meldinger så man
melding 1–50 og de ferske var ikke lastet i det hele tatt — de fantes ikke i payloaden å
scrolle til. Det ser ut som en scroll-feil, men er en spørringsfeil.

**2. Ingen scroll-logikk overhodet.** `ThemeChatTab` hadde verken elementbinding,
`scrollTop` eller paginering. Man landet på toppen av det som tilfeldigvis var lastet.

I tillegg lastet `openConversation` **hele** tråden (`/messages` uten `limit`), altså en
ubegrenset payload som også åpnet på sin egen begynnelse.

`/samtaler` gjorde alt dette riktig allerede. Reglene lå bare i den ene filen.

## Faser

### Fase 1: Reglene ut av `/samtaler`

`$lib/client/chat-scroll.ts` — tre rene funksjoner med tester:

- `isNearTop` — terskelen for å hente mer (120 px), ett sted.
- `scrollTopAfterPrepend` — posisjonen som holder utsnittet i ro når historikk legges
  til på toppen. Uten den kastes brukeren bakover nøyaktig idet historikken ankommer.
- `bottomAnchorKey` — nøkkelen som utløser «hold ved bunnen». Poenget er hva den
  **ikke** inneholder: antall meldinger. En effekt som ser på lengden fyrer også ved
  prepend og river deg ned til bunnen i samme øyeblikk som du ba om det motsatte.

`/samtaler` ble koblet på alle tre. Den hadde reglene riktig fra før; nå kan de to
flatene ikke drive fra hverandre.

### Fase 2: Serveren gir siste side

`/tema/[id]/+page.server.ts` bruker `getConversationMessagesPage(conversationId,
{ limit: 20 })` — samme helper `/samtaler` bruker. Den henter `limit + 1` i synkende
rekkefølge, snur til kronologisk og rapporterer `hasMore`. Payloaden faller fra opptil
50 meldinger til 20.

### Fase 3: Fanen

`ThemeChatTab` fikk elementbinding, bunnforankring, `onscroll` → hent eldre, og
«Henter eldre meldinger…» mens det pågår. `openConversation` bruker nå paginert modus.

Pagineringen holdes **per tråd**, ikke som én delt markør: fanen har to `ChatState`-er
(temaets egen samtale og «den andre»), og hopper man fram og tilbake ville én markør latt
den ene tråden arve den andres posisjon.

`toMsg` beholder DB-id-en som `id` i stedet for en fersk uuid — dedupliseringen ved
prepend krever at samme melding får samme id uansett hvor mange ganger den hentes. Den
bærer nå også `createdAt`, som slår på dag-skillene i `ChatMessages`.

### Fase 4: Dødt endepunkt fjernet

`/api/messages/load-more` hadde null konsumenter og duplikerte
`getConversationMessagesPage` med en annen sidestørrelse (30 mot 12/20) og uten
`limit + 1`-trikset. Slettet.

## Beslutninger

- **Markøren er den eldste RÅ raden, ikke den eldste viste.** System-meldinger filtreres
  bort i visningen, men teller i pagineringen — ellers hentes de om igjen i hver runde.
  Samme valg som `/samtaler` tok.
- **20 meldinger per side**, mot `/samtaler` sine 12 i etterlastingen. Tema-chatten har
  ingen dag-navigasjon å hoppe med, så første skjerm bør være litt dypere.
- **Ingen «last mer»-knapp.** Terskelen på 120 px henter før man treffer toppen, så
  knappen ville vært synlig sjelden og aldri nødvendig.

## Kjent gjenstående

Bok-, film- og film-tema-chattene laster fortsatt **hele** tråden i ett kall. De scroller
til bunnen ved åpning, så symptomet brukeren meldte gjelder dem ikke — men payloaden
vokser uten tak. De holder tråden som `{ role, text }` uten tidsstempel, så paginering
der krever at trådene bærer markøren først.

## Verifisering

- `npm run check` — 0 feil, 0 advarsler.
- `npm test` — 3040 tester i 229 filer, alle grønne (11 nye for `chat-scroll`).
- Testene dekker det som faktisk var galt: at `bottomAnchorKey` er **uendret** ved
  prepend, og at `scrollTopAfterPrepend` holder utsnittet i ro.
- Ikke verifisert mot prod-data: krever database, som ikke finnes i dette miljøet.
  Den nye spørringen bør sjekkes på en tema-samtale med mer enn 20 meldinger.
