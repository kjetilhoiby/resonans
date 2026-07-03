# Plan-felt: rens AI-tekst og riktig plassering av refleksjon

Dato: 2026-07-02
Status: ferdig

## Kontekst

Måneds- og ukeplanlegging bruker chat-steg der det siste AI-svaret lagres direkte i
felt som alltid vises som rene textarea-er (månedsnotat, ukesnotat, refleksjon). To
problemer:

1. **Markdown og samtale-innpakning lekket inn.** Feltene viste råtekst som
   «Her er et utkast:», «Supert. Her er et stramt forslag til **5 konkrete juli-mål**:»,
   `**fet**`, punktlister og avsluttende spørsmål «Vil du at jeg også skal koke dette
   ned …?». Fordi feltene ikke rendrer markdown, ble alt dette synlig.

2. **Refleksjonen ble lagret på feil måned.** Månedsplan-flyten starter med en refleksjon
   over *forrige* måned, men svaret ble lagret som *inneværende* måneds refleksjon («Hva
   lærte jeg denne måneden?»). Dermed forurenset den inneværende måned og forrige måned
   fikk ingenting. Samme feil i ukeplan.

## Faser

### Fase 1: Oppsummering → renskriving (dedikert modellkall)
- Ny `src/lib/server/plan-field-writer.ts` med `finalizePlanField(kind, thread, opts)`:
  leser hele samtaletråden, vekter **brukerens** egne meldinger/valg som substans (assistenten
  er kontekst), og returnerer ren feltverdi via `response_format: { type: 'json_object' }`
  (samme mønster som `goals.ts`/`dream-service.ts`). Faller tilbake til markdown-renset siste
  assistent-melding hvis kallet feiler; tom tråd → tom streng (ingen kall).
- Vi bruker altså ikke lenger siste melding rått — den er ofte et spørsmål eller mellomsteg.

### Fase 2: `markdownToPlain` som tynt sikkerhetsnett
- `src/lib/server/plan-text.ts` beholder kun `markdownToPlain()` — fjerner inline-støy
  (**fet**, #overskrift, lenker) men **beholder listestruktur** (punktlister → «- »,
  nummererte lister intakt), siden punktlister er ekte, ønsket innhold i en ren textarea.
  De skjøre preamble/spørsmål-heuristikkene er fjernet — modellen produserer nå ren tekst.

### Fase 3: Bruk i completion-endepunktene
- `month-plan/complete` og `week-plan/complete`: kjør notat- og refleksjons-tråden gjennom
  `finalizePlanField` (i parallell) før lagring. Flyten sender nå hele `{stepId}_thread`
  i stedet for `{stepId}_lastMessage`.

### Fase 4: Refleksjon til riktig periode
- Refleksjonen lagres på *forrige* måned/uke (den den faktisk handler om), ikke på den vi
  planlegger. Ikke-destruktivt: skriver bare hvis perioden ikke allerede har en refleksjon.
- Inneværende periodes refleksjonsfelt fylles ikke lenger ved planlegging — det er ment å
  fylles når perioden er over.

### Fase 5: Oppgrader tynne modeller som forvalter brukerens egen prosa
- Audit av alle `gpt-4o-mini`-kall avdekket samme feilkategori flere steder: en tynn modell
  satt til å foredle/syntetisere brukerens egne, nyanserte tekster. Oppgradert til `gpt-4o`:
  - `api/egenfrekvens/synthesize-reflection` — syntetiserer check-in + refleksjonschat.
  - `services/dream-service.ts` (`envisionSynth`) — 5-års/år/kvartal-visjon i førsteperson
    (persistert `model`-label følger nå med).
  - `programs/coach.ts` (`DEFAULT_MODEL`) — varm løpe-coach-narrativ (fortsatt overstyrbar
    via `EKKO_COACH_MODEL`).
  - `api/chat-stream-messages` — direkte coaching-svar (ikke-proxy-grenen).
- Rent mekaniske kall (klassifisering, ruting, uttrekk, parsing, transkribering) ble beholdt
  på `gpt-4o-mini`. Hovedchattens modellvalg (`chooseChatModel`) ble bevisst *ikke* endret —
  det er en fart/kostnad-avveining som eier separat.

## Beslutninger

- **Oppsummering, ikke siste melding:** Substansen ligger i det brukeren landet på gjennom
  samtalen, ikke i den siste (ofte spørrende) assistent-meldingen. Derfor et dedikert
  renskrivings-kall framfor regex-skrubbing.
- **Full gpt-4o, ikke mini:** Kallet forvalter brukerens egne, nyanserte refleksjoner. En
  tynn mini-modell flater ut stemme og mister dybde, og jobben kjører bare én gang ved
  fullføring — så vi bruker full gpt-4o (som resten av innholds-jobbene) med lav temperatur.
- **Behold punktlister:** Å strippe all markdown ville fjerne ekte struktur. Vi beholder
  lister og fjerner bare inline-utheving.
- **Ikke-destruktiv refleksjon:** En AI-oppsummering skal aldri overskrive noe brukeren
  selv har skrevet.

## Verifisering

- `npm test`: 931 tester grønne (inkl. nye for `plan-text` og `plan-field-writer`).
- `npm run check`: 0 feil, 0 advarsler.
- Merk: selve modell-renskrivingen krever en live kjøring for å verifiseres ende-til-ende
  (testene dekker prompt-bygging, tom-tråd og markdown-sikkerhetsnettet).
