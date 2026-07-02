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

### Fase 1: Ren tekst-modul
- Ny `src/lib/server/plan-text.ts`:
  - `markdownToPlain()` — fjerner fet/kursiv, overskrifter, sitatblokk, inline-kode og
    lenker; gjør punktlister til «- »; beholder nummererte lister og rører ikke
    `snake_case`.
  - `cleanPlanField()` — kjører `markdownToPlain`, fjerner en innledende samtale-linje
    som avslutter med kolon («Her er et utkast:»), og et avsluttende meta-spørsmål rettet
    mot brukeren.
- Enhetstester i `src/lib/server/plan-text.test.ts` (11 tester, bygget på de faktiske
  lekkasje-strengene fra skjermbildene).

### Fase 2: Bruk i completion-endepunktene
- `src/routes/api/month-plan/complete/+server.ts` og
  `src/routes/api/week-plan/complete/+server.ts`: kjør notat og refleksjon gjennom
  `cleanPlanField` før lagring.

### Fase 3: Refleksjon til riktig periode
- Refleksjonen lagres nå på *forrige* måned/uke (den den faktisk handler om), ikke på den
  vi planlegger. Ikke-destruktivt: skriver bare hvis perioden ikke allerede har en
  refleksjon brukeren har ført.
- Inneværende periodes refleksjonsfelt fylles ikke lenger ved planlegging — det er ment å
  fylles når perioden er over.

## Beslutninger

- **Rensing på lagringstidspunkt, ikke rendering:** Feltene skal være ren tekst (redigerbar
  textarea), så vi normaliserer inn i feltet i stedet for å tolke markdown ved visning.
- **Heuristikk, ikke markører:** Vi valgte robust rensing framfor å tvinge modellen til å
  emittere markører, slik at det virker likt for både måned og uke uten prompt-kobling.
- **Ikke-destruktiv refleksjon:** En AI-oppsummering skal aldri overskrive noe brukeren
  selv har skrevet.

## Verifisering

- `npm test`: 932 tester grønne (inkl. 11 nye).
- `npm run check`: 0 feil, 0 advarsler.
