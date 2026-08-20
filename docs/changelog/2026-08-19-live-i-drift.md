# Live er i drift — felttest B avgjort, og den avgjorde noe annet enn den spurte om

Dato: 2026-08-19
Status: ferdig

## Kontekst

Felttest B var planlagt som en go/no-go-port for hele Gemini Live-tilnærmingen:
WebSocket-helse 45+ min under skjermlås, resumption over 30-minuttersgrensa med et nytt
token, batteri ≤ +5 %/t og data ≤ 15 MB/t. Porten skulle avgjøre om stemmen kunne bo i en
vedvarende WebSocket i det hele tatt, eller om fase 3 måtte bli en forgrunns- og
bilfunksjon.

Turen 19. august kl. 07:38–08:33 svarte på den — 52 minutter Live-coach med lydbok gjennom
hele turen, riktige tall hele veien, vekkeord av. Men den svarte også på at to av
spørsmålene var galt stilt.

## Målingene

`gemini-3.1-flash-live-preview`, hentet fra diagnoseloggen i Ekko:

- **15 reetableringer**, hver med `gjenbruker tokenet (ingen ny mint)`. Hele økta kostet
  **1 mint** pluss én planlagt rotasjon.
- Levetider: 236, 170, 185, 180, 177, 177, 181, 179, 169, 89 (planlagt rotasjon), 447,
  185, 292, 247, 179 s. **Alle** med `lukkekode 1008, årsak: The operation was aborted.`
- `forbindelsen har stått — nullstiller backoff` etter så godt som hver reetablering.
  **Ingen kaldstart.**
- Trafikk: opp 0,04 MB, ned 10,18 MB på 52 min = **11,8 MB/t** (kriteriet var ≤ 15).
- Forsinkelse `sender hendelse` → `lyd kom i hvilemodus`: 0,6–1,7 s gjennom hele turen.

## Beslutninger

**Porten er nedgradert til overvåking.** Live har kjørt en hel økt med riktige tall,
sameksisterende lydbok og selvhelende reconnect. Det som gjenstår av kriteriene
(skjermlås isolert, batteri mot en kontrolløkt) leses av loggen fortløpende i stedet for i
en egen tur. En port som skal godkjenne noe som alt er i drift, er seremoni.

**Toggelen blir stående, og «beta på som default» er strøket.** Planen hadde det som siste
punkt i fase 3b. Poenget med toggelen er ikke at Live er umodent — det er at det finnes en
vei tilbake til regelcoachen i felt, ved dårlig dekning, en modell som forsvinner fra
katalogen, eller en Google-feil vi ikke eier. Live er i drift bak toggelen, og det er
forskjellen fra beta.

**3.1 er default, og 2.5 er ikke et alternativ i dupleks.** Vi trodde valget sto mellom en
modell som dør på ~170 s og en som står. Rapporten fra 25. juni stemmer — 3.1 lukker
klokkerent i klyngen 170–185 s — men **1008 er ufarlig for oss**: resumption dekker det
usynlig, og kostnaden er null mint.

Motprøven gikk motsatt vei. Økta 17. august kl. 21:05 kjørte
`gemini-2.5-flash-native-audio-latest` med mikrofonen åpen og ble lukket tre ganger etter
57/15/48 s med `lukkekode 1007, årsak: The audio content type (CONTENT_TYPE_AUDIO) is not
supported for this model configuration`. 2.5 avviser altså **lydinngangen** vår, ikke
lydutgangen: den kan betjene coachen, som bare spiller av, men ikke assistentens
vekkeord-modus. Bytter man modell for å unngå 1008, bytter man til et problem som er verre
— 1007 gjentar seg, og resumption hjelper ikke når det er selve setupet som avvises.

Derfor: **1008 er rutine på 3.1 og skal ikke feilsøkes.** 1007 er en inkompatibel
modell/setup-kombinasjon. 1006 er transporten, 1011 er serveren. Den forskjellen er hele
grunnen til at `logCloseDetails()` skriver koden og årsaken ved hver lukking; uten den ville
disse to økta sett like ut i loggen.

**Resumption-spørsmålet var galt stilt.** Kontrakten sa «uverifisert: virker et
resumption-handle på tvers av et NYTT ephemeral token? Åpne-vinduet er ~2 min, så reconnect
etter socket-dropp KREVER re-mint.» Åpne-vinduet gjelder å ÅPNE en økt. En gjenopptakelse
åpner ingen, og virker fram til `expireTime` (30 min) — også med `uses: 1`. Femten
reetableringer på samme token er beviset. Handle-TTL ble aldri en grense: den planlagte
rotasjonen ved `expireTime − 60 s` kom først.

**Mint-vinduet er en time, ikke et døgn** (rettet 17. august, `MINT_RATE_LIMIT_PER_HOUR`).
Grensa skal stoppe en klient i loop, ikke budsjettere bruk: Google har ingen dagsgrense på
utstedte tokens, og kostnaden ligger i lydminutter. Et døgnvindu fanget loopen og straffet
deretter et helt døgn — kvota var tom kl. 20:46 på grunn av kveldens loop dagen før, altså
av en feil som alt var rettet. Etter token-gjenbruken koster en hel økt 1–2 mint, så 20 i
timen er usynlig i normal bruk.

## Verifisering

Diagnoseloggen fra økta 19. august (Innstillinger → Live-stemme → Kopier) er kilden til
alle tallene over. Ingen kodeendring i denne runden — dette er beslutningene som følger av
en måling, skrevet inn i `ekko/GEMINI_LIVE_VOICE_BRIEF.md` (felttest-checkpoints,
risikoliste, PR 11) og `ekko/GEMINI_LIVE_API.md` (modell-A/B, resumption, lukkekoder).

## Kjent rest

- **Bakke-slusen er ikke verifisert i felt.** Økta 19. august ligger FØR fiksen som ga
  hendelser eget gulv (8 s) i stedet for det delte på 30 s. Loggen fra den turen har derfor
  verken «bakke-vindu åpnet» eller «slusen holdt igjen»; det er de to linjene neste tur skal
  leses etter.
- **Personaen er knapp.** Ren prompt-iterasjon på serveren, ingen TestFlight-runde.
- **Ruteveiledning** (rutelista inn i assistentkonteksten + et additivt `route`-felt på
  `startWorkout`, med avslag framfor stille valg) er designet, ikke bygget.
