# Bokcover fra skjermbilde

Dato: 2026-07-05
Status: ferdig

## Kontekst

Ved bokregistrering kan man laste opp et bilde (f.eks. skjermbilde fra Fabel-appen), og GPT-4o
autodetekterer tittel, forfatter, format og lengde. Coverbildet — som ofte er tydelig synlig i
samme skjermbilde — ble derimot ikke hentet ut. Boka endte uten omslag med mindre
OpenLibrary-oppslaget ved opprettelse tilfeldigvis traff (norske titler treffer sjelden).

## Faser

### Fase 1: Cover-ekstraksjon i analyze-image

`src/routes/api/books/analyze-image/+server.ts`:
- GPT-4o-prompten ber nå også om `coverBox` — en bounding-box rundt omslagskunsten i prosent
  av bildets bredde/høyde (`null` hvis ingen omslagskunst er synlig).
- `detail` ble hevet fra `low` til `high` slik at boks-koordinatene blir presise nok til beskjæring.
- Når en gyldig boks returneres, lastes originalbildet opp til Cloudinary
  (mappe `resonans/book-covers`, uten incoming-transformasjon slik at prosentboksen kan regnes
  om mot dimensjonene i upload-responsen), og en beskåret URL bygges med
  `c_crop` + `w_480/q_auto/f_auto`. Endepunktet returnerer denne som `coverUrl`.
- Cover-ekstraksjonen er best effort: manglende Cloudinary-konfig eller feil under opplasting
  gir `coverUrl: null` uten å velte selve bildeanalysen.

Ren logikk i `src/lib/server/book-cover-crop.ts`:
- `parsePctBox` validerer GPT-ens boks (tall, 0–100, innenfor bildet med avrundingsslingring).
- `pctBoxToPixelCrop` konverterer prosent → piksler med 2 % utvendig margin (GPT-bokser er
  upresise — heller litt bakgrunn enn avkuttet omslag), klemt til bildegrensene. Bokser under
  15 % bredde / 8 % høyde avvises som usannsynlige feildeteksjoner.

### Fase 2: Klient

`src/lib/components/domain/BookLibraryView.svelte`:
- `discoverBookFromImage` tar vare på `coverUrl` fra analysen i `manualCoverUrl`.
- Skjemaet for manuell registrering viser en forhåndsvisning av omslaget med en
  fjern-knapp (`aria-label="Fjern omslag"`, `data-track="bok-bibliotek:fjern-omslag"`).
- `addBook` sender `manualCoverUrl` i stedet for hardkodet `null`, så coveret lagres på boka.
- OpenLibrary-fallbacken i `POST /api/tema/[id]/books` gjelder fortsatt når coverUrl mangler.

## Beslutninger

- **Beskjæring via Cloudinary-transformasjon, ikke bildebibliotek**: Repoet har ingen
  server-side bildebehandling (sharp o.l.), men Cloudinary er allerede i bruk for filopplasting.
  Upload + `c_crop`-URL gir beskjæring uten nye avhengigheter.
- **Prosentboks fra GPT-4o**: Prosentkoordinater er oppløsningsuavhengige og kan regnes om mot
  de faktiske lagrede dimensjonene fra Cloudinary-responsen. Utvendig margin på 2 % kompenserer
  for at vision-bokser er omtrentlige.
- **Best effort**: Cover er nice-to-have. Alle feilveier (ugyldig boks, manglende konfig,
  opplastingsfeil) faller stille tilbake til `coverUrl: null`.

## Verifisering

- Nye enhetstester i `src/lib/server/book-cover-crop.test.ts` (parsing, margin, klemming,
  avvisning av små bokser og ugyldige dimensjoner). `npm test`: 1044 tester grønne.
- `npm run check`: 0 feil, 0 advarsler.
- Endringen i BookLibraryView vises kun i skjemaet for manuell registrering, som ikke inngår
  i de visuelle regresjonssidene.
