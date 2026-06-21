# Vedvarende samtaletråd for Ekko-coachen

Dato: 2026-06-21
Status: ferdig

## Kontekst

`POST /api/apps/coach` var statsløst: hvert kall sto alene, så coachen kunne ikke følge opp
en tidligere tur. Ekko-klienten er allerede bygd for en server-holdt samtaletråd og venter på
at serveren skal eie tilstanden. Serveren nøkler tråden på `(token-bruker, conversationId)`;
klienten sender bare ny ytring + en opak, server-generert `conversationId` (null første gang).

Server-kontrakten kom fra klient-teamet og er bakoverkompatibel: kall uten `conversationId`
skal oppføre seg nøyaktig som før (statsløst engangssvar — brukes av etter-økt-vurderingen).

## Faser

### Fase 1: Datamodell

- Nye tabeller i `src/lib/db/schema.ts`: `coach_conversations` (id, userId, title?, timestamps)
  og `coach_messages` (id, conversationId, role, text, createdAt). Egne tabeller (ikke den rike
  `conversations`/`messages`-paret for web-chatten) fordi dette er en talevennlig coach-tråd uten
  temaer/relasjoner/stjernemerking — vi vil ikke forurense web-chatten.
- SQL-migrasjon: `scripts/db-migrations/0022_coach_conversations.sql` (med `IF NOT EXISTS`,
  `ON DELETE CASCADE` fra melding → tråd → bruker).
- Drizzle-relasjoner lagt til for begge tabellene.

### Fase 2: Tråd-logikk

- `src/lib/server/programs/coach-conversation.ts`: repository-funksjoner (opprett, eierskaps-sjekk,
  last turer, append, slett) + ren `selectContextWindow()` som beholder de 20 nyeste turene ordrett
  og rapporterer hvor mange eldre som ble droppet. Enhetstestet (`coach-conversation.test.ts`).
- `runCoachConversationTurn()` i `coach.ts`: bygger LLM-kontekst av samtalepartner-system-prompt
  → valgfri program-kontekst → trunkerings-notis → trådhistorikk → efemær situasjonskontekst →
  ny ytring. Felles LLM-kall (`callCoach`) delt med den statsløse `runProgramCoach`.

### Fase 3: Endepunkter

- `POST /api/apps/coach`: aksepterer nå `conversationId?` og `context?`. Tråd-modus aktiveres når
  feltet `conversationId` er med (også `null`). `null` ⇒ ny tråd; kjent id ⇒ last historikk;
  ukjent/eid av annen bruker ⇒ `404`. Lagrer kun `user`/`assistant`-turene — aldri efemær `context`.
- `GET /api/apps/coach/conversations/[id]`: gjenoppretting for visning (turer + ISO-tidsstempler).
- `DELETE /api/apps/coach/conversations/[id]`: «glem samtalen» (cascade sletter turene).

## Beslutninger

- **Tråd-modus utløses av feltets tilstedeværelse, ikke av en sann verdi.** Kontrakten sier både
  «null/utelatt ⇒ ny tråd» og «kall uten conversationId = som før (statsløst)». For å unngå at
  etter-økt-vurderingen (som ikke sender feltet) plutselig begynner å persistere tråder, tolker vi
  *fravær av feltet* som statsløst og *tilstedeværelse (inkl. `null`)* som tråd-modus. Ekko sender
  `null` første gang, så den får alltid en tråd.
- **Egne tabeller** framfor gjenbruk av `conversations`/`messages` — isolerer coach-tråden og holder
  web-chattens skjema rent.
- **Efemær `context` lagres aldri** — injiseres som en system-melding kun for inneværende tur, så
  tråden ikke fylles av utdaterte tallremser.
- **Samtalepartner-system-prompt** i tråd-modus (åpnere enn trener-prompten), med guardrails:
  ingen markdown, ingen oppdiktede tall, og «unngå ordet ekko» (klientens barge-in-vekkeord).

## Verifisering

- `npm test` — 670 tester grønne (inkl. 6 nye for `selectContextWindow`).
- `npm run check` — 0 feil, 0 advarsler.
- Manuell kontrakt-gjennomgang mot Ekko-spec: bakoverkompatibilitet (kall uten `conversationId`),
  eierskaps-404, efemær context lagres ikke, `text` + `conversationId` i 200-svar.
