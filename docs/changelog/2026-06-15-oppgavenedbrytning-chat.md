# Oppgavenedbrytning: chat → forslag → velg

Dato: 2026-06-15
Status: ferdig

## Kontekst

`BreakdownModal` (long-press på en oppgave → «Bryt ned i deloppgaver») gikk rett
på AI-genererte forslag: modalen åpnet, hentet substeg umiddelbart, og du krysset
av. Brukeren ønsket heller å prate seg fram til hva oppgaven egentlig innebærer
før forslagene lages — altså **chat → forslag → velg** i stedet for å gå rett på
forslag.

## Faser

### Fase 1: Samtale-endepunkt
Nytt `POST /api/breakdown/chat` (`src/routes/api/breakdown/chat/+server.ts`):
kort, ikke-strømmende GPT-4o-mini-samtale om oppgaven. Systemprompten holder
svarene korte (1–3 setninger), stiller oppklarende spørsmål og lar være å liste
opp ferdige substeg — de kommer først når brukeren trykker «Lag forslag».
Meldingshistorikken sendes med (siste 12 meldinger).

### Fase 2: Nettverkslag + ren kontekst-bygger
`src/lib/components/ui/breakdown-api.ts`:
- `sendBreakdownChat` (kall mot `/api/breakdown/chat`).
- `buildBreakdownContextFromChat(messages)` — ren funksjon som bygger en lesbar
  transkripsjon («Bruker: …\nAssistent: …») som sendes som `context` til
  forslags-endepunktet. Enhetstestet i `breakdown-api.test.ts`.
- `loadBreakdownSuggestions` tar nå imot valgfri `context` (samtalen).

### Fase 3: To-fase-modal
`src/lib/components/ui/BreakdownModal.svelte` har nå to faser:
1. **chat** — åpner med en hilsen fra assistenten, fri tekstsamtale, «Send» +
   «Lag forslag». Enter sender, Shift+Enter gir linjeskift.
2. **suggestions** — eksisterende avkryssingsliste; «← Samtale» tar deg tilbake
   til chatten. Samtalen følger med som kontekst når forslagene genereres.

Modal-propsene er bakoverkompatible: tre kallsteder (ChecklistSheet, ukeplan,
ThemeTasksTab) er uendret fordi `sendChatFn`/`loadSuggestionsFn` defaulter til
ekte API.

### Fase 4: Designsystem
`/design`-demoen viser nå chat-fasen med deterministisk mock (`mockSendBreakdownChat`
i `mocks.ts`), injisert via `sendChatFn`.

## Beslutninger

- **Fri samtale, ikke ett fast spørsmål**: brukeren valgte åpen chat før
  forslagene, ikke en enkelt oppklaringsdialog.
- **Bygges inn i BreakdownModal**, ikke som egen flow i `src/lib/flows/` — minst
  forstyrrelse, behold long-press → modal-inngangen.
- **Samtalen som `context`-streng** gjenbruker den eksisterende `context`-parameteren
  i forslags-endepunktet i stedet for å endre prompt-strukturen der.

## Verifisering

- `npm run check`: 0 errors, 0 warnings.
- `npm test`: 570/570 (inkl. nye `buildBreakdownContextFromChat`-tester).
- Visuell regresjon (`/design` er én av sidene): pikselbaselinen for
  `design-modaler.png` må oppdateres med `npm run test:visual:update` i et miljø
  med `DATABASE_URL` — kunne ikke kjøres her (ingen DB; dev-serveren bootet ikke,
  og denne maskinens font-rendering avviker fra de committede baselinene).
