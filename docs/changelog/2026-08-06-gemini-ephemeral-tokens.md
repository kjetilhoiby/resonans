# Kortlevde Gemini-tokens til Ekko

Dato: 2026-08-06
Status: ferdig

## Kontekst

Ekko skal snakke med Gemini realtime. En Live-økt går over WebSocket, og en
WebSocket kan ikke proxyes gjennom Resonans på noen fornuftig måte — lyd i sanntid
tåler ikke et ekstra ledd. Appen må derfor koble direkte til Google, og trenger en
credential.

Å shippe `GEMINI_API_KEY` i iOS-bundelen er ikke et alternativ: en app-binær er
offentlig, og nøkkelen kan ikke roteres uten en ny utgivelse gjennom App Store.
Google har en mekanisme for nøyaktig dette — `auth_tokens` — og Resonans er riktig
sted å minte dem, siden vi allerede autentiserer Ekko med `Bearer rsn_`. Samme
arbeidsdeling som `/api/apps/tesla/state`: credentials bor på serveren.

## Endepunktene

`POST /api/apps/gemini/ephemeral-token` minter et token. Kroppen er valgfri; `ttlSeconds`,
`newSessionSeconds` og `uses` kan justeres innenfor grensene, og verdier utenfor
klippes framfor å avvises — en app som ber om 45 minutter er bedre tjent med 30 enn
med en 400.

`GET /api/apps/gemini/models` lister Live-modellene Google tilbyr nå, og hvilken et
token får hvis ingenting velges.

POST og ikke GET på minting: kallet har en effekt hos Google (kvote), og et token
skal ikke kunne mintes av en prefetch.

## Beslutninger

**`bidiGenerateContentSetup` + `fieldMask` er sikkerhetsgrensa, ikke `expireTime`.**
Et token uten låst setup lar den som holder det bestemme alt ved økta — modell,
systeminstruksjon og `tools`. Det er da en generell Gemini-nøkkel på vår kvote, bare
med kortere levetid, og med `tools` åpent er angrepsflaten større enn kvotemisbruk.
Vi låser `model` og `tools: []`.

**Systeminstruksjonen låses ikke.** Ekko eier samtalen og skal kunne endre prompten
uten at Resonans deployer. Skal den låses senere, er `LOCKED_FIELDS` stedet.

**Levetidene er policy, ikke API-grenser.** Googles tak er 20 timer for begge; vi
gir 30 minutter (tak én time) for økta og to minutter for å åpne den. Et langt
token kjøper lite — Ekko har nettverk mot oss og kan minte et nytt når som helst —
og den eneste effekten av lang levetid er større konsekvens hvis tokenet lekker.
`newSessionExpireTime` er det egentlige forsvaret: `expireTime` hindrer ikke at noen
starter sin *egen* samtale, det korte åpningsvinduet gjør det.

**Modellnavn hardkodes ikke som en påstand.** De skifter fra uke til uke, så
`DEFAULT_LIVE_MODEL` er en fallback og ikke en anbefaling. `GEMINI_LIVE_MODEL`
overstyrer den uten kodeendring, og `GET /api/apps/gemini/models` gjør spørsmålet
«hva er nyeste live-modell» til noe API-et besvarer i øyeblikket det stilles.
Filtreringen går på `supportedGenerationMethods` — modellens egen erklæring om at
den kan brukes over WebSocket — og ikke på om navnet inneholder «live».

**Feilmeldinger fra Google videreformidles ordrett**, gjennom `redactApiKeys`. Den
vanligste feilen er et modellnavn som ikke finnes lenger, og «Gemini feilet» ville
gjort den uløselig uten tilgang til loggen. Men Googles 400-svar gjentar av og til
forespørselen, og en nøkkel skal ikke kunne havne i en Vercel-logg eller i et
JSON-svar.

**503 for manglende nøkkel, 502 for alt annet.** Uten `GEMINI_API_KEY` er det en
konfigurasjonsfeil hos oss som et menneske må rette, og appen skal ikke prøve igjen
i sløyfe. Googles 401/403 speiles også som 502: det er *vår* nøkkel som er avvist,
ikke Ekkos, og en 401 videre til appen ville sendt brukeren til innlogging for noe
hun ikke kan fikse.

## Funnet under bygging

**Dokumentasjonen stemmer ikke med API-et.** `ai.google.dev` beskriver feltet som
`liveConnectConstraints` med nøstet `model` og `config`. Første kall mot det ekte
endepunktet:

```
400 INVALID_ARGUMENT · Invalid JSON payload received.
Unknown name "liveConnectConstraints" at 'auth_token': Cannot find field.
```

`liveConnectConstraints` er **Python-SDK-ens** navn. Wire-formatet har
`bidiGenerateContentSetup` og `fieldMask`, med `model` og `tools` flatt inni
setupen. Verifisert mot
`https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta`, som er
den autoritative kilden — dokumentasjonssida er det ikke.

**`fieldMask`-semantikken er motsatt av det som er intuitivt**, og ville brutt appen
stille. Fra discovery-dokumentet: tom maske *med* en setup betyr at klientens
setup-melding ignoreres **i sin helhet**. Hadde vi utelatt masken, ville Ekkos
persona, stemmevalg og modaliteter blitt kastet — en feil som ser ut som «Gemini
svarer rart», ikke som en tilgangsfeil. Riktig form for «lås to felt, la resten stå»
er `fieldMask: "model,tools"`.

**`uses`-begrunnelsen min var feil.** Jeg satte 3 for å tåle nettverksglipp under en
løpetur. Discovery sier: «Resuming a Live API session does not count as a use» —
glipp underveis er gratis. Defaulten er nå 2, og dekker det ene som ikke er gratis:
en kald omstart der appen mistet resumption-handtaket.

**Modellnavnet var det svakeste leddet.** Første utgave hardkodet en default fra
Googles eksempelkode. Brukeren påpekte at utviklingen skjer fra uke til uke, og det
er riktig — et navn fra en modells treningsdata eller fra en docs-side er en påstand
med utløpsdato. Derav modellkatalog-endepunktet og `defaultIsStale`, som flagger
tilstanden der minting fortsetter å virke helt til noen prøver å koble til.

## Verifisering

- `npm run check`: 0 feil, 0 advarsler.
- `npm test`: 28 nye tester for kroppsbygging, svarparsing, modellfiltrering og
  redaksjon av nøkler.

**Mot Googles ekte endepunkt**, med en falsk nøkkel (payload valideres før nøkkelen,
så formen kan verifiseres uten en gyldig nøkkel):

```
liveConnectConstraints  → 400 Unknown name "liveConnectConstraints"
bidiGenerateContentSetup + fieldMask → 400 API key not valid   ← formen godtatt
```

**Lokalt mot endepunktene:**

```
POST /api/apps/gemini/ephemeral-token  → 502 {"error":"Google svarte 400: API key not valid…"}
GET  /api/apps/gemini/models → 502 samme
GET  /api/apps/gemini/ephemeral-token  → 405
```

**Ikke verifisert:** at et ekte token faktisk åpner en Live-økt. `GEMINI_API_KEY`
finnes ikke i agentmiljøet, bare i Vercel. Første kall etter deploy svarer på det —
og `GET /api/apps/gemini/models` er stedet å begynne, siden det både bekrefter at
nøkkelen virker og sier om standardmodellen fortsatt finnes.

**Ikke gjort:** ingen rate-limiting på minting. Tokenet er per bruker gjennom
`Bearer rsn_` og trekkes tilbake i `user_api_secrets`, og hver mint logges med
bruker-id, så misbruk er sporbart. En hard grense uten belegg for at den trengs
ville truffet legitime reconnects først.
