# Retningssamtalen i Claude og ChatGPT

Dato: 2026-10-28
Status: ferdig (testet lokalt mot prod-build og podman-basen; ikke prøvd fra en ekte klient)

## Kontekst

Retningssamtalen — den kvartalsvise ærlighetssjekken der brukerens egen retning holdes opp
mot hvordan livet faktisk har sett ut — fantes bare som flyt i appen. Over MCP kunne
Claude og ChatGPT lese refleksjoner (`query_reflections`), men ikke se retningen samlet
eller lagre en samtale. En retningssamtale ført der ble altså borte.

## Endringer

- **`query_direction`**: visjonene per horisont (med `authored`, så et AI-utkast ikke
  forveksles med brukerens ord), verdiene, forrige gap-notat, syntesene av siste måned og
  uke, tidligere samtaler (id og periode; fulltekst via `query_reflections`), kvartalets
  status og `guidance` — arbeidsmåten og hvordan samtalen lagres.
- **`save_direction_conversation`**: gap-notat (påkrevd), transkript (påkrevd) og en
  valgfri justert kvartalsvisjon, med `periodKey` som default er inneværende kvartal.
- **Lagringen er flyttet ut av `/api/retning/kvartal`** til `saveDirectionConversation`
  (`$lib/server/direction/direction-conversation.ts`); ruta er nå en tynn innpakning.
- **Instruksen er delt.** Rolle, arbeidsmåte og tone er konstanter i
  `$lib/flows/retning-kvartal.ts`, brukt av flyten og av `query_direction`. Flytens prompt
  er uendret.

## Beslutninger

- **Transkriptet er påkrevd og merkes.** «Samtalen er data»
  (`2026-07-13-samtalen-er-data.md`): gap-notatet er en indeks. I appen lagres hver
  replikk fortløpende; over MCP gjengir assistenten dem i ettertid, og det står i toppen av
  transkriptet.
- **Godkjenning i klienten, ikke på serveren.** Notatet og visjonen lagres først når
  brukeren har sagt ja til ordlyden — det står i beskrivelsen og i `guidance`. Verktøyet
  er ikke merket destruktivt, siden det ikke sletter noe; gap-notatet erstattes, men
  transkriptet bak det står.
- **Idempotent ved nytt forsøk.** Samme transkript i samme kvartal gir ingen ny rad, og
  samme visjonstekst ingen ny visjon. Append-only er for samtaler, ikke for et kall
  klienten prøver to ganger.
- **Oslo-kvartal.** Ruta regnet før kvartalet av serverens UTC-klokke, så en samtale levert
  natt til 1. januar havnet i forrige kvartal. Nå regnes begge veier av Oslo-datoen.
- **Bare i MCP.** Web-chatten har flyten; den trenger ikke to veier til samme samtale.
- **Livsintervjuet er ikke med.** Det er fem steg med egne destillater per horisont og
  hører i appen. Uten egenformulert retning sier `query_direction` det, framfor å la
  modellen gjette en retning.

## Verifisering

- `npm test` og `npm run check` grønne; nye tester for kvartalsnøklene, duplikatsjekken av
  transkripter, at flyten bruker den delte arbeidsmåten, og verktøyene i MCP-lista.
- Ende-til-ende mot prod-build og podman-basen, med ekte OAuth (26 sjekker): uten retning
  → henvisning til livsintervjuet; ettårsvisjon skrevet i appen leses som `authored`;
  lagring av gap, transkript og visjon; nytt forsøk gir samme rader; lest tilbake med
  `query_direction` og `query_reflections`; framtidig og ugyldig kvartal avvises; forrige
  kvartal godtas; appens rute lagrer fortsatt, uten MCP-merket, og gir 400 på tom samtale.
