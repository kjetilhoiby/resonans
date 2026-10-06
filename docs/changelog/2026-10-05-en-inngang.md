# Én inngang

Dato: 2026-10-05
Status: pågår (til utprøving)

## Kontekst

Spor 2 i `2026-10-05-redesign-fremdriftsplan.md`. Brukeren limer skjermbilder
fra Resonans, Ekko og Strava inn i ChatGPT. Et typisk eksempel er «Sprang meg en
tur» med tre bilder. Brukeren savnet også «en enkel vei inn for bilder».

Hjemskjermen hadde allerede kamera, lyd og fil i chatfeltet, men to ting
manglet:

- **Typen kommer først.** Man velger kamera, lyd eller fil før man har sagt hva
  man vil.
- **Ett vedlegg per melding.** Hele kjeden bar ett vedlegg: `ChatState.send`,
  proxyen, `/api/chat` og visningen. Tre skjermbilder av samme tur ble derfor
  tre meldinger og tre svar.

Brukeren ba om at inngangen skulle **legges til, ikke erstatte** det som finnes.

## Faser

### Fase 1: arket, knappene og flere vedlegg

- **`CaptureSheet`** (`components/composed/`) er ett ark med tekst og én
  «Legg ved»-knapp.
  - Velgeren har ikke `capture`, så iOS viser selv menyen «Fotobibliotek / Ta
    bilde / Velg fil», og den tar flere filer. Første utgave hadde i tillegg en
    egen «Kamera»-knapp. Brukeren påpekte at kameraet alt sto i menyen, så
    knappen var dobbelt opp og er fjernet. Ernæringsflatens to knapper er en
    annen sak: der finnes knappen for å tvinge kameraet raskest mulig.
  - Et skjermbilde som limes inn blir et vedlegg (`onpaste`).
  - Opplastingen går gjennom den eksisterende `requestAttachmentUpload`.
  - Svaret vises i arket gjennom `ChatState` og `ChatThread`, altså ikke et
    femte chat-lag. Et svarfelt under svaret lar brukeren svare på coachens ene
    spørsmål.
- **To innganger** (den første er fjernet i fase 2):
  - en «+»-knapp først i hjemskjermens topprad (`HomeTitleZone`),
  - en flytende knapp (`CaptureButton`) fra rot-layouten på sider uten eget
    chatfelt (`showFloatingCapture`).
- **Kjeden bærer flere vedlegg**, og det er en utvidelse, ikke et bytte:
  - `SendOptions.attachments` og `capture`, videre gjennom `streamProxyChat` og
    `/api/chat-stream-messages` til `/api/chat`.
  - `/api/chat` slår sammen `attachment` og `attachments`
    (`pickCaptureAttachments`). Hvert bilde blir et eget `image_url`-element, og
    hvert vedlegg sin egen VEDLEGG-blokk.
  - Med ett vedlegg er teksten byte-lik det den var. De eksisterende flytene
    merker ingenting.
- **Lagring:**
  - `metadata.attachments` bærer lista når det er flere vedlegg.
  - `metadata.capture` merker fangsten.
  - Historikken bygger modellmeldingen av hele lista (`attachmentsFromMetadata`).
  - Trådendepunktet sender `images` når en melding har flere bilder, og
    `ChatMessages` tegner dem som miniatyrer under det første.
- **`CAPTURE_INSTRUCTION`** (`$lib/domain/capture.ts`) følger fangsten til
  modellen. Den ber coachen:
  - finne ut hva det er og lagre det med riktig verktøy,
  - registrere flere bilder av samme ting én gang,
  - ikke registrere en økt på nytt som alt finnes i dataene,
  - stille ETT spørsmål framfor å gjette.
- **Verktøyutvalget sender alle verktøyene for en fangst** (`capture` i
  `selectToolGroups`). Brukeren har ikke sagt hva det er, så ingen signal kan
  avgjøre gruppa.

### Fase 2: hjemskjermen har ÉN inngang, chatfeltet

Brukeren påpekte at hjemskjermen da hadde to innganger: chatfeltet («Hva tenker
du på?») med kamera, lyd og fil, og den nye «+». Valget ble å slå dem sammen i
chatfeltet:

- **«+» er fjernet fra toppraden.** Den flytende knappen står fortsatt på sidene
  uten eget chatfelt.
- **Chatfeltet tar flere vedlegg i én melding.** `pendingAttachments` (en liste)
  er tilstanden i `HomeScreen`, og `pendingAttachment`/`pendingImageUrl` er
  utledet av den. Alt som leste ett vedlegg, leser derfor det samme som før.
  Kamera, lyd og fil LEGGER TIL i lista i stedet for å erstatte det forrige
  vedlegget, og hvert vedlegg kan fjernes for seg.
- **Innliming:** `ChatInput` fikk propen `onPasteFiles`. Uten propen oppfører
  feltet seg som før. På hjemskjermen lastes et innlimt skjermbilde opp og festes
  som vedlegg. Mens opplastingen pågår, venter sendingen og sier fra.
- **Sendingen:** med ett vedlegg er den byte-lik den gamle. Med flere går lista
  som `attachments`, og boblen sier «📷 3 bilder» når teksten mangler.
- **Ikke merket som fangst** (`capture`). I chatfeltet snakker brukeren med
  coachen, og vedlegget får den vanlige vedleggsinstruksen. Fangst-instruksen
  hører til arket, der brukeren ikke sier hva det er.

## Beslutninger

- **I tillegg, ikke i stedet.** Kamera, lyd og fil i chatfeltet står urørt, det
  samme gjør attachment-triagen. Først når bruken viser hvilken vei som vinner,
  kan noe fjernes.
- **Ingen samtale-id ved sending.** Serverens tema-ruting avgjør hvor fangsten
  havner, som for hjemskjermens første melding. Et måltid kan da lande på
  Ernæring. «Åpne samtalen» lenker dit etterpå.
- **Instruksen følger meldingen, ikke systemprompten.** Den gjelder bare denne
  fangsten, og samme tråd kan blande fangster og vanlig prat.
- **Taket er seks vedlegg** (`MAX_CAPTURE_ITEMS`). Det som ikke får plass,
  avvises med en setning. Et bilde som forsvinner stille ser ut som et bilde
  coachen har sett.
- **Arket er mørkt uansett systeminnstilling**, som de andre arkene. Det
  portaleres til `<body>` og arver ikke `AppPage`-variablene. Fargene står som
  lokale variabler øverst i stilen, så spor 4 kan endre dem ett sted.
- **Den flytende knappen står ikke der et chatfelt alt ligger nederst**
  (`/samtaler`, `/tema/…`, `/aktivitet/…`, lønnsmåned, `/skriv`). Der ville den
  ligget oppå det.

## Verifisering

- `capture.test.ts` dekker:
  - typer,
  - tak,
  - boble-tekst,
  - instruksen,
  - hvilke ruter som får knappen,
  - sammenslåingen av vedlegg (duplikater, ugyldige rader, ikke-http-adresser),
  - bildelista.
- `tool-selection.test.ts` sjekker at en fangst gir alle gruppene.
- `npm test` ga 5 207 grønne tester, og `svelte-check` ga 0 feil.
- Arket er skjermdumpet i 390 px bredde med tre vedlegg (to bilder og en PDF).
  Første utgave arvet lyse standardvariabler, slik at tittelen var usynlig og
  feltene hvite. Det ble rettet med de lokale variablene.
- **Ikke verifisert herfra:** selve modellsvaret på en fangst. Det krever prod.

## Kjent rest

- **Tale** har ingen egen knapp i arket. Tastaturets diktering dekker det på
  iOS, og lydflyten på hjemskjermen står.
- **Delingsarket i iOS** (`share_target`) støttes ikke for PWA-er på iOS.
  Skjermbilder må derfor limes inn eller velges fra biblioteket.
- **Temasidene får ikke den flytende knappen.** Chatfanen ligger nederst, og
  ruta sier ikke hvilken fane som er åpen.
- **Ekko** kjenner ikke `attachments`.

## Etterarbeid: «Last opp og triager» sa noe som ikke skjer

Kamera-, lyd- og filpanelene på hjemskjermen hadde knappen «Last opp og
triager →» og ventetilstanden «Triagerer…». Brukeren spurte om vi faktisk
triagerer. Det gjør vi ikke: alle tre går gjennom `requestAttachmentUpload`
(`/api/attachment-extract`), som laster opp og trekker ut tekst eller et
transkript. Vedlegget festes så i chatfeltet, og coachen tolker det i samtalen.
`requestAttachmentTriage` (`/api/attachment-triage`) har ingen kallere lenger,
og «langpress på bildet» som kommentaren lovte finnes ikke.

- Knappene heter nå «Legg ved →». Ventetilstandene sier hva som faktisk skjer:
  «Leser bildet…», «Leser filen…» og «Transkriberer…».
- Regnearkknappen heter «Hent regnearket →».
- Den kalde triagen (endepunktet og hjelperne rundt `AttachmentTriageResponse`)
  står urørt. Regnearkflyten bruker fortsatt formen til å vise forslagene sine.
  Endepunktet kan slettes når det er bekreftet ubrukt, fordi det ligger utenfor
  `/api/apps/*`.
