# Planlegging gjennom MCP: dagsplan, agenda, rutiner og måloppgaver

Dato: 2026-10-28
Status: ferdig i kode, testet gjennom MCP mot prod-build og lokal base; ikke prøvd fra ChatGPT

## Kontekst

ChatGPT kunne registrere mye gjennom MCP, men ikke organisere det som skal skje. Bedt om
å legge inn «Juba torsdag, møte med Magnus fredag kl. 11, Halloween lørdag, Nils' kamp
søndag», brukte den `add_to_week_plan`, og alle fire havnet i ukelista uten dag. ChatGPT
skrev selv en oppgave med fire prioriteringer (P0 plan, P1 agenda, rutiner, måloppgaver,
P2 belastning).

## Gap-analysen

**Fantes, men var ikke i MCP:** dagslistene (`manage_day_tasks` lå bare i web-chatten),
rutinepunktene (`manage_routine list` kastet dem), mål og måloppgaver (ingen lesing; og
`create_task` viser til `check_similar_tasks`, som ikke finnes i MCP), Spond med person og
svarstatus (tolkningen lå inline i ukeplan-sida).

**Krevde backend:**
- Avkryssing med bivirkninger lå inline i `PATCH /api/checklists/[id]/items/[itemId]` —
  trukket ut til `$lib/server/checklist-item-mutations.ts`, som endepunktet nå kaller.
- Ekte flytting fantes ikke; appens «utsett» kopierer med vilje. `moveChecklistItem` er ny.
- Måloppgaver kunne bare få ny tittel.

## Hva som ble gjort

Seks nye MCP-verktøy (`query_plan`, `manage_plan_item`, `query_agenda`, `query_routines`,
`query_goals`, `manage_goal_task`), delvis oppdatering i `manage_routine`, og `spondRsvp`
delt mellom agendaen og ukeplanen. Ingen migrering. Reglene står i `docs/mcp.md`,
«Planlegging».

## Testet

- Enhetstester: datoer, klokkeslett over sommertidsskiftene, serialisering, Spond-svar
  (`plan-items.test.ts`), rutinegjennomføring (`routine-stats.test.ts`), MCP-lista.
- 49 sjekker gjennom `/mcp` med ekte OAuth mot `npm run build`: ChatGPTs tre scenarier
  ordrett, idempotens, flytting uten kopi, at punktene står i `/ukeplan?week=2026-W44`,
  feilkoder, sommertid, at agendaen ikke skriver noe. Appens eget endepunkt etter
  uttrekket: avkryssing, tekst med «kl 18», 404, sletting.

## Funn underveis

- **Rutinegjennomføring kan bare måles på åpnede dager.** Instansene lages når
  hjemskjermen eller ukeplanen viser rutinen. Testen viste det selv: ett besøk på
  ukeplanen for uke 44 ga tre målte dager der det var seedet to.
- **`findSimilarTasks` bommer på det den finnes for.** Levenshtein på hele strengen gir
  «Løpe 3 ganger i uka» mot «Løpe» 21 % likhet. `find_similar` gir derfor alle oppgavene,
  rangert, og lar modellen dømme.
- **Ukeplanen dater Spond på UTC.** En hendelse mellom midnatt og 02 norsk tid står en dag
  for tidlig der. Agendaen bruker Oslo-datoen; ukeplanen er ikke rettet.

## Kjent rest

- Verktøyene er ikke på web-chatten eller Ekko.
- P2 (belastningsoversikt) er vurdert og ikke bygget — se `docs/mcp.md`.
- Spond-svarfrist lagres ikke i synken, og kan derfor ikke vises.
