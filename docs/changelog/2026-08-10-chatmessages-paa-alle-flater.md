# Alle chat-flater rendres med ChatMessages

Dato: 2026-08-10
Status: ferdig

## Kontekst

`ChatMessages` heter «delt meldingsliste for alle chat-kontekster» i sitt eget filhode.
Den var det ikke. Ved kartlegging brukte bare **to** av sju flater den — hjem og
`/samtaler`. De fem andre hadde hver sin `{#each}`-løkke med `TriageCard`, sin egen
brukerboble og sin egen feilvisning.

Kartleggingen bommet først på bok og film: et søk etter `ChatMessages` traff
**`chatMessages`-propen** deres, ikke komponenten. Søk etter `import ChatMessages`
når du skal vite hvem som faktisk bruker den.

Konsekvensen var ikke bare kosmetisk. Hver duplikat manglet noe ulikt:

| Flate | Manglet |
|---|---|
| Tema | stjerne, retry, rediger stoppet svar, dag-skiller, stopp-knapp |
| Aktivitet | **all feilvisning** — `chat.error` ble aldri rendret |
| Flyt | rike kort, retry-plassering |
| Bok, film | retry, rediger stoppet svar |
| Lønnsmåned | feilvisning (feil ble dyttet inn som en botmelding) |

## Faser

### Fase 1: De to rene byttene

`ThemeChatTab` og `/aktivitet/[id]` holder tråden i en `ChatState` og kunne sende
`chat.messages` rett inn. Begge fikk samtidig `streaming`/`onStop` på `ChatInput` og
`editStoppedMessage`, som legger brukerens tekst tilbake i feltet.

`{#key chatInputKey}` rundt `ChatInput` er nødvendig, ikke pynt: `initialValue`-effekten
ser ikke en *uendret* tekst, så uten remount kunne man ikke redigere det samme stoppede
svaret to ganger.

### Fase 2: Flatene uten ChatState

Flyt (`FlowChatStep`), bok, film-per-film, film-på-tema og lønnsmåned holder tråden som
`{ role, text }` uten id. Alle fikk en liten oversetter til `ChatMessage` med
**indeksbasert id** — samme nøkkel `{#each}` brukte før, og stabil så lenge en tråd bare
vokser bakerst, som den gjør på alle fem.

`confirmAction` i flyten ble en `actions`-oppføring på meldingen, fortsatt bare på siste
melding og bare når svaret er ferdig: en bekreftelsesknapp midt i tråden ville sendt et
steg brukeren alt har passert.

### Fase 3: Døde stiler

Fem brukerboble-klasser og tre feilklasser fjernet.

## Beslutninger

- **Fargene på brukerboblene forsvinner, og det er hele poenget.** Tema-boblene fulgte
  temaets hue, bok var blå, film vinrød, flyt og lønnsmåned hver sin blå. Alle er nå
  `#1a1a1a` fra `ChatMessages`. Det er den synligste endringen.
- **`TriageCard status`-propen var død** — den er deklarert, men aldri lest i malen. Bok,
  film og lønnsmåned sendte en statustekst dit. Ingenting gikk tapt ved å slutte.
- **Flytens retry-knapp mistet `data-track="selvangivelse-chat:prov-igjen"`.** Den delte
  knappen heter «↺ Prøv på nytt», og teksten blir labelen. Bruksstatistikk fra før og etter
  er derfor ikke sammenlignbar for den ene knappen — til gjengjeld har alle flatene nå
  samme label for samme handling.
- **`/design/sections/chat.svelte` rendrer fortsatt `TriageCard` direkte.** Det er
  galleriet som viser kortets tilstander hver for seg, ikke en chat-flate.
- **Stjernemerking ble ikke skrudd på utenfor `/samtaler`.** `onStarMessage` krever et
  endepunkt som lagrer merket per melding, og de øvrige flatene har ikke en meldings-id i
  basen å merke. Knappen vises bare der callbacken finnes, så flatene er like i alt annet.

## Kjent gjenstående

**Bok-chatten sender bilder som ikke vises i tråden.** `pendingImageUrl` følger med i
API-kallet, men meldingen som legges i tråden er `{ role, text }` — samme feil tema-chatten
hadde til 10. august. Å rette den krever et felt i `ChatMsg`, som eies og lagres av
`BookDashboard`; det er en egen endring.

## Verifisering

- `npm run check` — 0 feil, 0 advarsler (fanget også de døde CSS-klassene).
- `npm test` — 3029 tester i 228 filer, alle grønne.
- Visuelle tester ikke kjørt: krever database og `OPENAI_API_KEY`, som ikke finnes i dette
  miljøet. Boblefargene endres på alle flater, så baselines må oppdateres ved neste
  kjøring med `VISUAL_REVIEW_CONTEXT` satt til denne endringen.
