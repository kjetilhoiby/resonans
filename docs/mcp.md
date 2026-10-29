# MCP-serveren: Resonans i Claude og ChatGPT

Resonans er en MCP-server (Model Context Protocol) på **`<ORIGIN>/mcp`**. Den legges til
som en egendefinert connector i Claude eller ChatGPT, og brukeren logger inn med den
vanlige Google-innloggingen — ingen hemmelighet å lime inn.

## Legge den til

- **Claude** (claude.ai, Desktop, mobil): Innstillinger → Connectors → *Legg til
  egendefinert connector* → adressen over. Claude Code: `claude mcp add --transport http
  resonans <ORIGIN>/mcp`.
- **ChatGPT**: Innstillinger → Apps og connectors → *Opprett* (krever utviklermodus) →
  adressen over, autentisering OAuth.

Adressen og tilkoblede klienter står på `/settings/external-apps`, der hver tilkobling
kan kobles fra.

## Flyten

```
klient ──POST /mcp──────────────────────────────▶ 401 + WWW-Authenticate: resource_metadata=…
klient ──GET /.well-known/oauth-protected-resource/mcp ─▶ { authorization_servers: [ORIGIN] }
klient ──GET /.well-known/oauth-authorization-server ──▶ endepunktene
klient ──POST /oauth/register (RFC 7591) ──────────▶ client_id
nettleser ─▶ /oauth/authorize?…&code_challenge=… ─▶ /auth (Google) ─▶ samtykke ─▶ redirect med code
klient ──POST /oauth/token (code + code_verifier) ─▶ rsm_at_… (1 t) + rsm_rt_… (90 d, roteres)
klient ──POST /mcp, Authorization: Bearer rsm_at_… ─▶ verktøyene, som brukeren
```

| Fil | Eier |
|-----|------|
| `$lib/server/oauth/oauth-logic.ts` | ren logikk: PKCE, redirect-URI-er, registrering, metadata (testet) |
| `$lib/server/oauth/oauth-store.ts` | klienter, engangskoder, tilkoblinger (`oauth_*`-tabellene) |
| `routes/.well-known/*`, `routes/oauth/*` | oppdagelse, registrering, samtykke, token, revokering |
| `$lib/server/mcp/mcp-tools.ts` | hvilke verktøy, og hintene (read-only/destruktiv) |
| `$lib/server/mcp/mcp-server.ts` + `routes/mcp` | Streamable HTTP, tilstandsløs, JSON-svar |
| `$lib/server/csrf.ts` | CSRF-sjekken, med unntak for token/revoke |

## Regler

- **Verktøyene er assistentens** (`ASSISTANT_TOOLS`, samme sett som Ekko), minus quiz og
  forteller. Beskrivelser og skjemaer gjenbrukes fra verktøymodulene — skriv aldri et
  MCP-skjema ved siden av. Et nytt verktøy i `shared-tools.ts` dukker opp i MCP av seg selv.
- **`userId` kommer fra tokenet.** `adaptSharedTool` setter det ETTER modellens argumenter;
  fram til oktober 2026 sto det før, så et `userId`-argument ville vunnet.
- **Tokenene gjelder bare `/mcp`.** `rsm_`-prefikset skiller dem fra `rsn_`-hemmelighetene,
  som slipper inn i hele `/api`. `/mcp` godtar ikke `rsn_`, og `/api` godtar ikke `rsm_`.
- **Alt lagres som sha256-hash** med `EXTERNAL_API_SECRET_PEPPER`. Koder er engangs og
  slettes FØR de sjekkes, så en feilet verifier ikke kan prøves på nytt.
- **Bare autorisasjonskode + PKCE S256.** Redirect-URI-er: https, eller http mot loopback,
  eksakt match. Egendefinerte skjema avvises.
- **Registreringen er åpen; samtykket er grensa.** Klientnavnet er selvoppgitt, så
  samtykkesiden viser redirect-HOSTEN og ber brukeren avslå hvis den ikke er claude.ai,
  chatgpt.com eller noe de selv startet. Siden kan ikke rammes inn (`frame-ancestors 'none'`).
- **Samtykkesiden leser brukeren fra økta**, aldri via `resolveRequestUserId` — samme regel
  som `/api/apps/callback`. Den står i `public-paths.ts` fordi hooks sender uinnloggede til
  `/auth?next=<sti>` UTEN spørrestrengen, og hele forespørselen står der.
- **CSRF: token og revoke er unntatt, alt annet er som før.** SvelteKit avviser i drift
  enhver skjema-POST uten `Origin`, og OAuth-token-forespørselen er nettopp det (RFC 6749
  krever `x-www-form-urlencoded`, og den kommer fra Claude/ChatGPT sine servere). Sjekken
  kan ikke unntas per rute, så `csrf.checkOrigin` er av og sjekken gjenskapt i
  `csrfHandle`. **Feilen syntes ikke i dev** — SvelteKit sjekker bare utenfor dev — så
  testen må kjøres mot `npm run build`. (Ekko kom forbi ved å sette `Origin` selv.)
  Build-loggen sier at `checkOrigin` er deprecated; det finnes ingen erstatning som kan
  unnta forespørsler uten `Origin`.
- **Ingen «samme tur» på serveren.** Ekko nekter å slette en vektmåling funnet i samme tur
  (`AssistantTurnState`). Et MCP-kall er ett verktøykall, så `manage_*` merkes
  `destructiveHint` og klienten ber brukeren bekrefte.
- **Tilstandsløs**: én `Server` og transport per forespørsel, `enableJsonResponse`, ingen
  økt-id. GET og DELETE på `/mcp` gir 405. To containere kan svare annenhver gang.
- Logglinjer: `[oauth]` (registrering, ny tilkobling) og `[mcp] <verktøy> klient=… ok|feil
  <ms>` — lesbare over `GET /api/admin/logs?grep=[mcp]`.

## Planlegging

Seks verktøy i tillegg til assistentens sett, alle i `$lib/ai/tools/` og registrert i
`MCP_TOOLS` (`$lib/server/mcp/mcp-tools.ts`). Ingen nye tabeller. Se
`docs/changelog/2026-10-28-mcp-planlegging.md` for gap-analysen de kom fra.

| Verktøy | Leser/skriver | Bygger på |
|---|---|---|
| `query_plan` | dagslister og ukelister | `checklists` med `week:…:day:…` / `week:…` |
| `manage_plan_item` | create, update, move, complete, reopen, skip, delete | `plan-service.ts` → `checklist-item-mutations.ts` |
| `query_agenda` | oppgaver, Spond, billetthendelser, rutiner, trening | `agenda-service.ts` |
| `query_routines` | rutinepunktene og gjennomføring per punkt | `routine_definitions` + instansene, `routine-stats.ts` |
| `query_goals` | mål, måloppgaver, framdrift denne perioden | `goals`, `tasks`, `progress` |
| `manage_goal_task` | find_similar, update, pause, resume, complete, archive | `goal-tasks.ts` |

`manage_routine update` beholder nå feltene som ikke sendes, så en rutine kan endres
uten å gjenta tittel, slot og ukedager.

**Regler**

- **Et planpunkt er en `checklist_items`-rad på en dag- eller ukeliste**, ikke en ny
  modell. Oppretting går gjennom `buildChecklistItemFields` som i appen, så et punkt fra
  ChatGPT er ikke til å skille fra et punkt skrevet på hjemskjermen.
- **Avkryssing, redigering og sletting bor i `checklist-item-mutations.ts`**, delt med
  `PATCH/DELETE /api/checklists/[id]/items/[itemId]`. Logikken lå inline i endepunktet
  fram til oktober 2026; en MCP-kopi ville mangle framdrift på koblet måloppgave,
  streak-runden og speilingen til ukepunktet — ferdig i ChatGPT, halv i appen.
- **`move` flytter SAMME rad** (ny `checklistId`). Det er ikke appens «utsett», som
  kopierer og stryker originalen med vilje (sporet er poenget). En flytting er en
  rettelse.
- **Klokkeslett er lokal veggklokke** (`metadata.timeHour/timeMinute`), ikke et
  tidspunkt. `startsAt` med offset regnes ved utlesing (`osloLocalToIso`, to runder så
  timene rett etter et sommertidsskifte blir riktige). Klokkeslettet sendes som
  `startTime`, ikke i teksten; ny tekst beholder det.
- **To vern mot duplikater:** `idempotencyKey` (lagres i `metadata.idempotencyKey`), og
  et ÅPENT punkt med samme tekst i samme liste. Begge gir det eksisterende punktet med
  `alreadyExisted: true`. Et avkrysset punkt med samme tekst er ikke et duplikat.
- **Uten dato havner et punkt i denne ukas ukeliste**, aldri på en gjettet dag.
- **Bare dag- og ukelister kan endres herfra.** Et rutine- eller prosjektpunkt gir
  `not_a_plan_item`.
- **Feil har en `code`:** `not_found`, `invalid_argument`, `not_a_plan_item`.
  «Finnes ikke» og «ikke din» gir samme svar, så id-er ikke kan prøves ut.
- **Agendaen skriver ingenting.** Rutinene leses som definisjoner, ikke gjennom
  `materializeRoutinesForDates`, som lager instansene den finner mangler.
- **Spond-hendelser er referanser** (`source`, `externalId`, `personName`, `rsvp`),
  aldri kopier i planen. `rsvp` kommer fra `spondRsvp` (`$lib/domain/plan-items.ts`),
  som ukeplanen også bruker. `not_invited` er skillet mellom «barnet spiller» og «gruppa
  inviterer til å se en kamp». Datoen er Oslo-datoen; ukeplanen bruker fortsatt
  UTC-datoen, så en hendelse mellom midnatt og 02 havner der en dag for tidlig.
- **Rutinegjennomføring måles bare på dager rutinen ble ÅPNET** (instansen lages når
  hjemskjermen eller ukeplanen viser den). En umålt dag er ukjent, ikke «ikke gjort»;
  svaret skiller `scheduledDays` fra `daysOpened` og sier det i `note`.
- **`find_similar` gir alle oppgavene under målet**, rangert, med `likelyDuplicate`.
  Den delte `findSimilarTasks` regner Levenshtein på hele strengen, og «Løpe 3 ganger i
  uka» mot «Løpe» er der 21 % lik.
- **Måloppgaver eies via målet** (`tasks` har ingen `user_id`). Status er nå `active`,
  `paused`, `completed` eller `archived`; alle eksisterende lesere filtrerer på
  `active`, så de tre andre forsvinner fra ukeplanen uten at noe annet endres.

**Ikke på web-chatten eller Ekko ennå.** Verktøyene er delte moduler, men bare
registrert i MCP. Å legge dem i `shared-tools.ts` gir Ekko dem; web-chatten trenger
utførelse i `routes/api/chat/+server.ts` og en gruppe i `TOOL_GROUP_MAP`.

**Belastningsoversikt (P2) er ikke bygget.** Agendaen har alt et slikt oppslag ville
lest — Spond med start og slutt, punkter med varighet, rutiner med estimat, planlagte
økter — og ChatGPT kan summere den selv. Et eget `query_commitments` ville vært en
tynn sum over `loadAgenda` (bundne minutter per dag, antall punkter uten estimat, pluss
søvn fra `query_sleep`), et par timers arbeid. Det bør vente til agendaen er brukt og
det viser seg om summen må være på serveren. Kapasitet eller «ledig tid» skal den uansett
ikke oppgi: ingen av kildene vet når brukeren er opptatt utenom det som er ført opp.

## Retningssamtalen

Den kvartalsvise ærlighetssjekken (flyten `retning_kvartal` i appen, se
`docs/changelog/2026-07-12-retning-livsintervju.md`) kan føres i Claude eller ChatGPT og
lagres som om den var ført i appen. Se `docs/changelog/2026-10-28-mcp-retningssamtale.md`.

| Verktøy | Gjør |
|---|---|
| `query_direction` | Retningen per horisont (med `authored`), verdiene, forrige gap-notat, syntesene av siste måned og uke, tidligere samtaler, kvartalets status — og `guidance`, arbeidsmåten |
| `save_direction_conversation` | Gap-notat, transkript og eventuelt justert kvartalsvisjon |

Fulltekst av tidligere samtaler hentes med `query_reflections` (kind `retningssamtale`),
som MCP alt hadde.

- **Én lagring for begge flatene.** `saveDirectionConversation`
  (`$lib/server/direction/direction-conversation.ts`) brukes av `/api/retning/kvartal` og
  verktøyet. Gap-notatet (`retningsgap`) ERSTATTES per kvartal og er det coachen i appen
  viser som «KJENTE GAP»; transkriptet (`retningssamtale`) legges alltid til; en
  kvartalsvisjon superseder den forrige. Den lagrede samtalen fjerner også hurtighandlingen
  på hjemskjermen.
- **Arbeidsmåten er delt med flyten** (`DIRECTION_CONVERSATION_ROLE`, `_METHOD` og `_TONE`
  i `$lib/flows/retning-kvartal.ts`). Endres instruksen, endres den begge steder.
- **Transkriptet er påkrevd**, og et MCP-transkript merkes i toppen: replikkene er
  gjengitt av assistenten, ikke lagret fortløpende som i appen. Brukerens replikker skal
  stå ordrett. En senere leser (og `query_reflections`) skal kunne se forskjellen.
- **Godkjenningen skjer i klienten.** Beskrivelsen ber modellen vise gap-notatet og
  visjonsteksten og lagre først på et ja. Verktøyet er ikke merket destruktivt — det
  sletter ingenting — så klienten spør ikke av seg selv.
- **Et nytt kall med samme transkript gir ingen ny rad** (`transcriptAlreadySaved`), og
  samme visjonstekst ingen ny visjon (`visionUnchanged`). Append-only gjelder samtaler,
  ikke nettverksforsøk.
- **Kvartalet er Oslo-kvartalet.** `periodKey` kan settes til et tidligere kvartal, aldri
  et framtidig. Appens rute regnet fram til nå kvartalet av serverens UTC-klokke.
- **Uten egenformulert retning henviser verktøyet til livsintervjuet** i appen. Et
  AI-utkast skal ikke holdes opp mot hverdagen som om det var brukerens ord.

## Teste lokalt

Token-endepunktet må testes mot en PROD-build (CSRF-sjekken). Mot podman-basen:

```bash
npm run build
DATABASE_URL=postgres://resonans:$PW@127.0.0.1:55432/resonans ORIGIN=http://127.0.0.1:5175 \
  PORT=5175 CRON_SECRET=lokal ENABLE_CRON_DISPATCHER=false ENABLE_JOB_WORKER=false \
  node --env-file=.env build
```

`--env-file` overstyrer ikke variabler som alt er satt. Samtykket krever en økt; en
gyldig `authjs.session-token` kan lages med `encode` fra `@auth/core/jwt` og `AUTH_SECRET`
(`{ userId: 'local-test-user' }`). MCP Inspector (`npx @modelcontextprotocol/inspector`)
gjør hele flyten i nettleseren.

## Kjent rest

- Livsintervjuet (fem steg) og revisjon av ti-, fem- og ettårsvisjonen finnes bare i appen.
- Ingen scope-inndeling: en tilkobling får alle verktøyene, lesing og skriving.
- Client ID Metadata Documents (CIMD) støttes ikke; klientene faller tilbake på DCR.
- Ingen rydding av klienter som aldri fikk en tilkobling (én rad per forlatt registrering).
