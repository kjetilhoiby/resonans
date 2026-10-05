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

- **`CaptureSheet`** (`components/composed/`) er ett ark med tekst, «Bilder og
  filer» og «Kamera».
  - Biblioteket står først og tar flere filer. Kameraet er et eget felt, fordi
    `capture` tvinger kameraet.
  - Et skjermbilde som limes inn blir et vedlegg (`onpaste`).
  - Opplastingen går gjennom den eksisterende `requestAttachmentUpload`.
  - Svaret vises i arket gjennom `ChatState` og `ChatThread`, altså ikke et
    femte chat-lag. Et svarfelt under svaret lar brukeren svare på coachens ene
    spørsmål.
- **To innganger:**
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
