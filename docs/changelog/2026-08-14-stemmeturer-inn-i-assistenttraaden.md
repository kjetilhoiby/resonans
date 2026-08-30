# Stemmeturer inn i assistent-tråden (fase 2, tråd-forening)

Dato: 2026-08-14
Status: ferdig

## Kontekst

Ekkos Gemini Live-stemmesamtale (fase 1, `resonans-lab/ekko/GEMINI_LIVE_VOICE_BRIEF.md`)
skjer app↔Google direkte — serveren ser aldri lyden eller turene. Uten tråd-forening
husker SSE-assistenten ingenting av det som ble sagt med stemmen: to hjerner, én samtale.
Dette er §6-kontrakten fra briefen.

## Faser

### Fase 1: Endepunkt

`POST /api/apps/assistant/conversations/{id}/turns` — `{id}` er en eksisterende
assistent-tråd eller literalen `new` (create-if-nil; id-en returneres og adopteres av
appen). Kropp: batch av `{ role: "user"|"assistant", text, at, source: "voice" }`.
Turene skrives via `appendAssistantTurns` (samme vei som tekstturene, med tittel-bump og
person-indeksering) og lastes inn i neste SSE-kall som all annen historikk — de
re-spilles aldri.

Validering rent og testet i `$lib/domain/ai/assistant-voice-turns.ts`:
- Bare `user`/`assistant` — `system` avvises (klientens notiser skal ikke inn i
  modellens hukommelse).
- Tak: 50 turer per batch, 8000 tegn per tur; over taket avvises hele batchen framfor
  stille trunkering.
- `at`/`source` aksepteres men brukes ikke ennå: lagringsrekkefølgen er
  batch-rekkefølgen. Ukjente felter er ikke feil — kontrakten kan vokse.

## Beslutninger

- **`new` som literal i stien** framfor et eget endepunkt: klienten har alltid ett kall
  å gjøre, og 404-semantikken for ukjent/fremmed/feil-source id er identisk med resten
  av conversations-flaten (klienten svarer med å poste på nytt mot `new`).
- **Ingen generering ved innsending.** Ren bokføring; SSE-hjernen møter turene først
  neste gang brukeren faktisk spør om noe.

## Verifisering

`npm test` (7 nye tester på valideringen) og `npm run check` grønne. Konsumeres av
Ekko fase 2 (mic-knappen i arket → Live + tråd-forening).
