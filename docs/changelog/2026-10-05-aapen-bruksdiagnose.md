# Åpen bruksdiagnose — `/api/diagnostikk/bruk`

Dato: 2026-10-05
Status: ferdig

## Kontekst

En UX-redesign skal bygges på hva som faktisk brukes: hvilke flater, når på
døgnet, hvor lenge, hva det trykkes på, og hvor mye chatten brukes sammenlignet
med ChatGPT. Dataene har ligget i `usage_events` siden juni
(`docs/changelog/2026-06-09-brukslogging.md`), men `/api/usage/summary` krever
innlogging og er per bruker. En Claude-økt som skal analysere mønsteret har
ingen legitimasjon — samme situasjon som `/api/diagnostikk` ble laget for.

Prisen er den samme som der: alt som slipper ut er offentlig for alltid. Derfor
er utvelgelsen et eget, testet domenelag, og hvert felt er hvitelistet.

## Faser

### Fase 1: hvitelista (`$lib/domain/usage-public.ts`)

Ren logikk med tester i `usage-public.test.ts`. Tar imot grupperte SQL-rader og
bygger svaret felt for felt — ingen spread, ingen `delete`.

- **Stier → rutemønstre.** `toPublicPathPattern` matcher stien mot
  `PAGE_ROUTE_PATTERNS` (alle `+page.svelte` i `src/routes`) med SvelteKits
  rangering (statisk > matcher > fri parameter), og gir mønsteret med matcheren
  fjernet (`/helse/sykdom/[id]`). Treffer stien ingen side, beholdes bare
  segmenter som finnes som statiske rutesegmenter; resten blir `[param]`, og
  dybden kappes på 8. Spørrestreng og hash kastes alltid.
- **Temaer → dashboardtype.** `/tema/<uuid>` og `/tema/helse` blir begge
  `/tema/[id]` i `byPath`, og brytes i tillegg ned på `themeKinds`
  (`training`, `sleep`, `economics`, …, `none` for et tema uten type, `ukjent`
  for et som ikke ble funnet). Typen valideres mot en `Record<DashboardKind, true>`,
  så TypeScript feiler når en ny type legges til framfor at den stille blir
  `ukjent`.
- **Klikk-etiketter.** Bare `data-track`-formen (`^[a-z0-9æøå-]+:[a-z0-9æøå-]+$`)
  og en fast liste med ~30 generiske knappeord («Lagre», «Avbryt», «Legg til» …)
  går ut. Alt annet telles i `interactions.anonymous`, brutt ned på tagg
  (`button`/`a`/`input`/`label`/`summary`/`annet`).
- **Chat.** Bare tellinger: brukermeldinger per dag, distinkte tråder per dag,
  og fordeling på kilde (`web`/`ekko`/`annet`), trådtype (`dagbok`/`tema`/`annen`)
  og tematype.

### Fase 2: spørringene (`$lib/server/usage-diagnostics.ts`)

Aggregert i SQL: (Oslo-dag, Oslo-time), økter med `lag()` per bruker, (sti, dag)
og (sti, etikett, tagg). Hver gruppert spørring har et radtak (20 000 / 5 000 /
20 000); treffes taket, sier `truncated` det. `messages.content` er ikke i noen
spørring. Temanavn leses bare for å utlede typen, og forlater aldri funksjonen.

### Fase 3: endepunktet

`src/routes/api/diagnostikk/bruk/+server.ts`, lagt i `PUBLIC_API_EXACT` for seg
selv. `/api/diagnostikk` er eksakt match, så underruta er ikke åpen fordi
forelderen er det — den ber om tilgang selv, som planlagt da den regelen ble
skrevet. `?days=` (default 30, tak 180, `window.clamped` sier fra).

## Beslutninger

- **På tvers av ALLE brukere, uten brukervalg.** Uten auth finnes ingen trygg
  måte å si «denne brukeren» på. `userCount` står i svaret så et aggregat over én
  person ikke leses som et over mange — og omvendt: med to brukere er partnerens
  bruk med i tallene.
- **Tidsmønsteret er med, og det er et valg.** Fordeling per dag, time og ukedag
  er formålet med endepunktet, men sier også når husholdningen er våken. Eieren
  har bedt om det. `note` i svaret sier det, så ingen leser det som et uhell.
- **Knappetekst er brukerinnhold.** `usage-logger.ts` faller tilbake på
  `textContent` og `aria-label`, og en oppgavetittel på en knapp er nettopp det.
  En etikett må derfor BEVISE at den er et utviklernavn; at den ser harmløs ut
  holder ikke. Restrisiko: en knappetekst som tilfeldigvis har formen
  `ord:ord` i små bokstaver uten mellomrom slipper gjennom.
- **Temanavn i adressen er også innhold.** `/tema/helse` er en gyldig adresse
  (sideruta slår opp på navn), så navnesegmentet kollapses som en uuid.
- **Rutelista er sjekket inn, ikke globbet.** En `import.meta.glob` over
  `+page.svelte` ville dratt alle sidene inn i endepunktets modulgraf. En test
  går filsystemet og feiler når lista og rutene spriker. Mangler en rute, er
  feilen TRYGG: besøkene kollapses til `[param]`.
- **Tråd-dager, ikke tråder, i fordelingene.** `conversationDays` i
  `chat.bySource`/`byConversationKind`/`byThemeKind` er distinkte tråder per dag
  summert over vinduet. Distinkte tråder over hele vinduet ville krevd egne
  spørringer per fordeling, og spørsmålet en redesign stiller er «hvor ofte».
- **Ingen cache.** Spørringene skanner `usage_events` og `messages` på
  `created_at` uten egnet indeks (indeksene er på `user_id`/`conversation_id`).
  Det er akseptabelt ved dagens volum og samme eksponering som `/api/diagnostikk`.

## Verifisering

- `usage-public.test.ts`: sti-mønstre (uuid, navn, spørrestreng, matcher,
  statisk-foran-parameter, tokens, ukjente stier, dybdetak), drift-vakt mot
  `src/routes`, etikett-hvitelista, tematype-hvitelista, og en test som
  serialiserer hele svaret og krever at ingen rå sti, etikett, temanavn, tema-id
  eller spørrestreng finnes i det.
- `public-paths.test.ts`: `/api/diagnostikk/bruk` er åpen, `/bruk/detaljer` og
  `/brukere` er det ikke.
- Spørringene kjørt mot ekte Postgres-SQL (pglite, gjennom drizzles
  `pg-proxy`) med seedede rader: Oslo-time, økter per bruker, ugyldig
  `durationMs` ignorert, navnetema slått opp med stor forbokstav, rader utenfor
  vinduet ute.

## Kjent rest

- Ingen indeks på `usage_events.created_at` / `messages.created_at` alene.
- Historiske stier til sider som er slettet kollapses til `[param]`.
- Oppmerksomhet stemples når siden forlates, så time-fordelingen av den er
  omtrentlig (sies i `note`).
