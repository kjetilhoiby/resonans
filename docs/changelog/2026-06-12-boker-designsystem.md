# Bøker inn i designsystemet og katalogen

Dato: 2026-06-12
Status: ferdig

## Kontekst

Dybderevisjon av temasidene viste at bok-flaten var appens dårligst dekkede: ~285 hardkodede hex-farger og nesten null token-bruk (en token-reskin ville truffet hele appen unntatt bøker), ingen visuell testdekning (verken suite eller katalog), og 24 fetch-kall spredt i 6 av 7 komponenter.

## Gjennomført (rekkefølgen var poenget: sikkerhetsnett først)

1. **Visuell dekning**: `tema/bøker` lagt i både pikselsuiten (`tema-boker.png`) og LLM-review-suiten — baselines generert FØR refaktoreringene, så alt etterpå kunne bevises mot dem.
2. **BookHeaderBar** (eneste fetch-frie bok-komponent): demo i ny «Bøker»-seksjon i katalogen — lukket + fremdriftseditor åpen (papir + lydbok). `Book`-typen eksportert.
3. **Token-migrering** (piksel-bevist): 223 av ~285 farger migrert — 62 til design-tokens (eksakte verdimatcher mot AppPage), 161 til ny **`--book-*`-palett** (30 variabler definert på `.bk-view`/`.bk-library` med originalverdi som fallback). 78 engangsfarger bevisst beholdt. Verifisert: tema-boker.png og design-boker.png passerte UTEN baseline-oppdatering. Bok-flaten kan nå re-skinnes ved å overstyre `--book-*` + tokens.
4. **API-injeksjon**: ny `domain/book-api.ts` med `BookTabsApi` (getProgressLog, updateBook — konsoliderte 4 identiske PATCH-kall, deleteBook, getClips, createClip, deleteClip). BookFaktaTab og BookClipsTab tar `api`-prop; Book/BookClip/ProgressLogEntry-typene deduplisert hit.
5. **Demoer**: BookFaktaTab (fremdriftsgraf med ETA, fakta-skjema med DateInput, lånefrist-nedtelling) og BookClipsTab (klipp med AudioKaraokePlayer — tom lyd-src er inert, karaoke-tekst rendres live). FaktaTab fikk `today`-prop for deterministisk lånefrist-nedtelling i demoen (samme grep som DaySections `todayIso`).

## Verifisering

- svelte-check 0 feil, 422 enhetstester grønne gjennom alle fasene.
- **tema-boker: 0,00 % diff i review etter token-migrering + api-refaktorering** — flytting av 223 farger og 9 fetch-kall beviselig piksel-nøytral.
- Pikselsuite grønn (nå 6 sider + 18 katalogseksjoner).

## Fase 2 (samme dag): kontekst- og chat-taben

- `BookTabsApi` utvidet med `refreshContext`, `uploadImage`, `transcribe` og `streamChatMessages` (Response-baserte så komponentene beholder sin egen feilhåndtering/stream-lesing).
- **BookContextTab** og **BookChatTab** tar `api`-prop; ChatTabs dupliserte Book/BookClip-typer erstattet med import fra book-api (`ChatMsg` eksportert).
- Demoer: BookContextTab med rik kontekstpakke-mock (metadata, forfatterkontekst, kritiker-sitat, samtalehint) og BookChatTab med boksamtale + klipp.
- Verifisert: tema-boker 0,00 % diff i review etter api-refaktoreringen; alle suiter grønne.

Hele bok-flaten (7 komponenter) er dermed på tokens, bak api-lag og demoet i katalogen.

## Gjenstår

- AudioKaraokePlayer er demoet indirekte via ClipsTab; egen demo med ekte lydfil hvis behov.
