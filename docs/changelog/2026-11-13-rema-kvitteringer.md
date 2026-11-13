# Rema 1000-kvitteringer som sensor

Dato: 2026-11-13
Status: pågår (bygget, ikke prøvd mot en ekte konto)

## Kontekst

Dagligvarekjøp fantes bare som kronebeløp fra banken og, for Oda, som
ordrer parset fra e-post. Rema 1000 har varelinjene — navn, EAN, pris og
rabatt — i Æ-appen, men ingen eksport. Æ-appens API er dokumentert av
tredjepart (Helge Sverre, gist `80a7f34f874336324184a0c513c2e6a2`, lest ut av
Android-appen `no.rema.bella` 3.0.12). Det er uoffisielt, privat og kan endre
seg uten varsel; vi bruker det bare til brukerens egne kvitteringer.

## Faser

### Fase 1: Synk inn i de eksisterende dagligvaretabellene

- **Kvitteringene lander i `grocery_orders` / `grocery_order_lines`**, samme rader
  som Oda-ordrene, med `provider = 'rema1000'` og `order_ref` = Remas
  transaksjons-id. Kvitteringskortet på Mat, «Legg i lager» og plan-mot-kjøp
  virker da uten en tredje modell. Migrasjon `0081_grocery_orders_rema.sql`
  legger til det Oda aldri hadde: `store_name`, `purchased_at`, og på linjene
  `ean`, `discount` og `product_group`.
- Domenet rent i `$lib/domains/food/rema-receipts.ts` (med tester): tolking av
  adressen brukeren limer inn, validering av API-svar felt for felt, valg av
  hvilke kvitteringer som hentes, og mapping til varelinjer.
- HTTP i `$lib/server/integrations/rema.ts`, tokens i `rema-token.ts`, synken i
  `rema-sync.ts`, tilkoblingen i `rema-connect.ts`.
- Endepunkter under `/api/sensors/rema/` (`connect/start`, `connect`, `sync`,
  `status`, `disconnect`), cron `/api/cron/rema-sync` annenhver time 05–21 UTC,
  og `rema1000` i `FRESHNESS_THRESHOLDS` (12 t).
- Kortet `RemaSourceCard` i `/settings/sources`.

### Fase 2: Følgefeil i lesere som antok én ordre per uke

- `GET /api/food/grocery-orders` sorterte på `createdAt`. En førstegangssynk
  skriver ukas kvitteringer i én bolk, så «siste handel» ble tilfeldig. Nå på
  `coalesce(purchased_at, delivery_date, order_date, created_at)`.
- Plan-mot-kjøp (kortet og ukesnudgen) sammenlignet ukelista mot ÉN ordre. Med
  tre-fire butikkturer i uka ville resten av lista stått som «manglet». Begge
  slår nå sammen linjene fra alle ukas ordrer, og kortet sier det når de er flere.
- Kortet het «Siste Oda-handel»; nå «Siste handel · <butikk>».

### Fase 3: Første synk i prod, og en død diagnose

Første kjøring 13. november 2026: `listet=631 importert=40 linjer=398 igjen=591
feilet=0 avviste_linjer=10`. Innloggingen, kodebyttet og begge lese-endepunktene
virket som gisten beskrev.

Linja med feltnavnene kom aldri. Den logget bare når varelinje-svaret var en
ren liste, og Rema pakker lista inn i et objekt (`{ rows: [...] }`) — parseren
tålte innpakningen, loggingen gjorde det ikke. `describeRowsShape` ser nå
gjennom den og navngir innpakningens nøkler, og `parseTransactionRows` bærer
`rejectedFields`: feltnavnene på linjene som avvises (de ti hadde verken
`productDescription` eller `prodtxt1`), så de kan kjennes igjen uten å logge
innholdet.

## Beslutninger

- **Ingen callback — koden limes inn.** Vi bruker Æ-appens offentlige klient
  (`android-251010`), og redirecten (`ae-appen.appspot.com/redirect/redirect.html`)
  er Remas side som sender koden videre til `bella://authorize`. Vi kan ikke
  registrere en egen. Flyten er derfor to steg: `connect/start` lager PKCE og
  legger verifikator + state i en kryptert httpOnly-cookie (15 min, sti
  `/api/sensors/rema`); brukeren logger inn, kopierer adressen og limer den inn.
  Adressen (`https://…?code=`), deep-linken (`bella://…?code=`) og bare koden
  godtas.
- **State må være alfanumerisk.** Redirect-siden avviser alt annet med
  `error=WrongState` — en UUID med bindestreker ville aldri gitt en kode.
- **Æ-appen kan stjele koden.** Er appen installert der man logger inn, åpner
  `bella://` appen, som prøver å bytte koden med sin egen verifikator og bruker
  den opp. Kortet ber derfor om en nettleser på en maskin uten appen.
- **Abonnementsnøkkelen ligger i miljøet** (`REMA_APIM_SUBSCRIPTION_KEY`), ikke i
  koden: den er appens, ikke vår, og repoet er åpent. Uten den svarer
  `connect/start` 503 og kortet sier hva som mangler.
- **Tokenlaget er SB1-oppskriften**: lesing på sensor-id, advisory-lås per
  sensor, re-lesing inne i låsen, og `shouldRefresh`/`resolveExpiresAt` gjenbrukt.
  Vi vet ikke om Rema roterer refresh-tokenet; å anta det koster ingenting.
  Legitimasjonen er kryptert med `encryptSecret` (under `AUTH_SECRET`).
- **Ordre og linjer i én transaksjon**, og `onConflictDoNothing` på den unike
  (user, provider, order_ref). «Importert» leses av ordreraden, så en ordre
  uten linjer etter et avbrudd ville aldri blitt fylt.
- **Maks 40 nye kvitteringer per kjøring, nyeste først**, med 250 ms mellom
  varelinje-kallene. Flere års historikk blir en serie korte kjøringer.
- **`total_price` er linjebeløpet FØR rabatt**, som Rema oppgir det; rabatten
  står for seg. Vi regner ikke ut et «betalt»-beløp vi ikke har sett.
- **Antall regnes bare når det er aritmetikk**: oppgitt `quantity`, eller
  beløp / enhetspris når forholdet er et helt tall. En vektvare får tomt antall
  framfor «1,234 stk».
- **Kategori fra varegruppa først** (`productGroupDescription`, «Ost» → meieri),
  så fra navnet. Kvitteringsnavnet er forkortet.
- **Feltnavnene på varelinjene logges** (`[rema] varelinjefelt: …`), aldri
  verdiene. Kontrakten er lest ut av en app; det er navnene som endrer seg.
- **Frakobling sletter tokens, ikke kvitteringene.**
- Ingenting skrives til lageret automatisk — samme regel som for Oda.

## Kjent rest

- **Ikke prøvd mot en ekte konto.** Kodebyttet, refresh og om `x-mobile-nr` er
  påkrevd er antakelser fra gisten. Første tilkobling er testen; `[rema]`- og
  `[rema-token]`-linjene i `/api/admin/logs` sier hva som skjedde.
- Bankens dagligvarebeløp og kvitteringene er ikke koblet: samme kjøp finnes
  begge steder, og forbruk skal fortsatt telles fra banken.
- Ingen chat-verktøy over varelinjene ennå (`query_food` dekker dem ikke), og
  EAN brukes ikke til noe annet enn å lagres.
- `x-app-version` er låst til 3.0.12 (kan overstyres med `REMA_APP_VERSION`).
  Avviser Rema gamle appversjoner en dag, er det første sted å se.
