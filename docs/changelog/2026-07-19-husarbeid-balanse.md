# Husarbeid-balanse: hvem gjør hva, mot 50/50

Dato: 2026-07-19
Status: ferdig (dev-verifisering gjenstår)

## Kontekst

Kartleggingen viste at chores lever 100 % under `home` i dag (apparat-sykluser,
chore-budsjett, `home_chores`-liste) — men den emosjonelt ladede delen, *hvem gjør
hva*, manglet helt: ingen person-attribusjon noe sted, og `home_overdue_shared_tasks_7d`
er «shared» kun i navnet. Den fysiske oppgaven er hjem, men fordelingen er en
relasjons-/familiesak.

Brukeravklaring: **ideell andel = 50 %.** Ingen forhandlede kvoter eller konfigurerbare
mål — ett fast referansepunkt.

## Faser

### Fase 1: Ren logikk (`observed-behavior.ts`)

- `computeChoreBalance(myCount, otherCount)` (testet): andel mot 50/50-idealet, signert
  avvik (+ = jeg bærer mer, − = partner bærer mer). Null under minimum (4 oppgaver).
- `classifyChoreBalance` (testet): **symmetrisk** severity på avstand fra 50 % — både å
  bære for mye og for lite er verdt å vite. ±10pp balansert (info), ±20pp low, ±30pp
  medium, over det high. (Gapet rundes for å tåle flyttallsstøy.)
- OBSERVERT ATFERD-linje: «Husarbeid siste to uker: du 65 %, partner 35 % (ideal 50/50)
  — du bærer mer enn halvparten.»

### Fase 2: Logging (`log_chore` + chore-service)

Attribusjonen skjer via chat — partneren bruker ikke nødvendigvis appen, så begge
parters bidrag logges der: «jeg tok oppvasken», «kona støvsuget stua». Verktøy `log_chore`
(task + doneBy: meg/partner + valgfrie minutter), registrert i både chat og assistent.
`logChore` skriver `chore_done`-event (sensor `chore_log`) — egen kilde, uavhengig av det
single-user chore-budsjettet (metadata.chore). `readChoreBalance` teller per part siste 14
dager.

### Fase 3: Signal + bro

- Nytt signal `chore_balance_14d` (ownerDomain home, consumers home+relationship —
  samme kryssdomene-mønster som routine_adherence).
- Balansen inn i `collectObservedBehaviorInputs` → OBSERVERT ATFERD-blokken (chat +
  egenfrekvens-refleksjonen). Coachen kan speile skjevhet varmt.

## Beslutninger

- **Fast 50/50-ideal** (brukervalg) — ingen kvote-konfigurering.
- **Chat-logget attribusjon, ikke home_chores-avhukinger** — én tydelig kilde som
  fanger begge parter uavhengig av om partneren logger selv. Automatisk telling fra
  home_chores-avkryssinger kan kobles på senere.
- **Symmetrisk severity** — «ikke satt pris på»-risikoen går begge veier; både over- og
  under-bidrag surfaces.
- **Signal eid av home, konsumert av relationship** — fysisk oppgave er hjem,
  fordelingen er relasjon (routine_adherence-presedens).

## Verifisering

- `npm test`: 1523 grønne (nye: computeChoreBalance, classifyChoreBalance,
  balanse-linjen). `npm run check`: 0 feil.
- Dev: «jeg tok oppvasken, kona støvsuget» i chat → to chore_done-events; etter cron
  `chore_balance_14d`-rad; OBSERVERT ATFERD-blokken viser fordelingen i neste chat.
