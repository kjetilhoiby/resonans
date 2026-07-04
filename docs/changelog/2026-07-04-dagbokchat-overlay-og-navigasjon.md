# Dagbokchat: overlay-header/-input med blur og navigasjon (søk/kalender/stjerner)

Dato: 2026-07-04
Status: ferdig

## Kontekst

Dagbok-chatten (kanonisk samtale på `/samtaler`) hadde statisk header og input som
flex-barn — bare meldingslisten scrollet, og eneste navigasjon i tråden var hopp fra
ukeplanen (`?date=`). Brukeren ønsket:

1. En handlingsknapp (•••) i tittellinja med tre valg: søk, kalender og stjernemerkede
   meldinger.
2. Kompakt input når inaktiv — én linje med backdrop-blur så meldinger skimtes gjennom.
3. Aktiveringsanimasjon: binders-knappen ligger på tekstlinja når inaktiv; ved fokus
   spretter en handlingsrad (vedlegg + send) opp nedenfra og binders-knappen glir ut.
4. Backdrop-blur på tittellinja med dynamisk undertittel som viser datoen for meldingene
   i view («I dag» / «I går» / «Onsdag 25. juni»).

## Faser

### Fase 1: Overlay-layout + blur + dynamisk dato-subtittel
`src/routes/samtaler/+page.svelte`: chat-grenen pakket i `.cp-shell` (relativ ramme);
`.cp-header` og `.cp-input` er absolutte overlays med gradient + `backdrop-filter: blur`.
Målte høyder (`bind:clientHeight`) publiseres som `--cp-header-h`/`--cp-input-h` og styrer
scroller-paddingen, så bunn-pinning og prepend-kompensasjon virker uendret.
`scroll-margin-top` på ankrene får `scrollIntoView` til å lande under headeren.
Ny ren modul `src/lib/client/chat-visible-day.ts` (`currentDayFromSpacers`) + `parseDayKey`
i `chat-day-sections.ts`; «dag i view» beregnes med rAF-throttlet scroll-lesing og vises
som undertittel i `PageHeader`.

### Fase 2: ChatInput expandOnFocus-modus
`src/lib/components/ui/ChatInput.svelte`: ny prop `expandOnFocus`. Markup delt i
`.ci-line` (display:contents i standardmodus — layouten der er uendret) og en
`.ci-actions-row` som alltid ligger i DOM og animeres med `max-height`/`translateY`.
Binders-knappen på tekstlinja animeres ut (`width: 0` + `translateX`). Raden holdes oppe
så lenge utkast/vedlegg/streaming finnes. `inert` gjør den utilgjengelig når kollapset.

### Fase 3: Kebabmeny + hopp-mekanikk
Nye ikoner `star`/`kebab` i `Icon.svelte`. Ny generisk `ui/KebabMenu.svelte` (datadrevet
«•••»-meny, mønster fra ConversationContextMenu). Chat-headeren får menyen med de tre
valgene. `ChatMessages.svelte` gir meldingsrader anker-id (`melding-<dbId>`), og
`jumpToDay(day, messageId?)` i `+page.svelte` scroller til lastet dag/melding med
flash-puls — ellers navigeres via eksisterende `?date=`-windowing (`jumpLatch` nullstilles
så samme dato kan hoppes til to ganger; `pendingJumpMessageId` etterscrolles).

### Fase 4: Søk
`api/conversations/[id]/messages` får `?q=` (ILIKE med escapede jokertegn via ny
`src/lib/utils/like-escape.ts`, nyeste først, maks 50). Ny ren modul
`src/lib/client/chat-search-snippet.ts` bygger utdrag med markert treff.
`domain/samtaler/ChatSearchSheet.svelte` (BottomSheet): debounce 300 ms, min 2 tegn,
dag-etikett + snippet, treff hopper til meldingen.

### Fase 5: Kalender
Nytt endepunkt `api/conversations/[id]/messages/days` grupperer meldinger per dag i
klientens tidssone (`?tz=`, IANA-validert, fallback Europe/Oslo) — `created_at` er
UTC-veggtid mens klientens dag-ankere er lokale. Ny ren modul
`src/lib/client/month-grid.ts` (mandagsbaserte uker, `addMonths`, `monthTitle`).
Ny gjenbrukbar `ui/MonthCalendar.svelte` med markørprikk; kun markerte, ikke-fremtidige
dager er valgbare. `domain/samtaler/ChatCalendarSheet.svelte` kobler dem sammen.

### Fase 6: Stjernemerkede
`?starred=1`-gren i meldings-endepunktet (kronologisk, maks 100).
`domain/samtaler/ChatStarredSheet.svelte` lister stjernene med dag-etikett og 3-linjers
utdrag; trykk hopper til meldingen. Read-only v1 — av-/påstjerning skjer i tråden.

### Fase 7: Katalog og tester
/design: KebabMenu-demo (modaler), de tre sheetene med mock-api (sheets), ny
Kalender-seksjon (MonthCalendar), ChatInput expandOnFocus-demo (chat). Deterministiske
fixtures i `design/mocks.ts`. Enhetstester for alle nye rene moduler.

## Beslutninger

- **Scroll-lesing (rAF) fremfor IntersectionObserver** for «dag i view»: når man scroller
  midt i en lang dag krysser ingen spacer viewporten — IO ville krevd retningsbokføring.
  En rect-sweep over dag-spacerne i scroll-handleren kan ikke desynke.
- **`expandOnFocus` som egen ChatInput-modus**: standard- og rig-modus (hjemskjerm,
  temasider) er uendret; `.ci-line` er display:contents utenfor expand-modus.
- **Absolute-posisjonering inne i 100dvh-containeren, ikke `position: fixed`** — oppfører
  seg bedre med iOS-tastaturet.
- **Tidssone som query-param på days-endepunktet**: serveren grupperer i klientens sone
  slik at kalender-markørene stemmer med dag-ankrene; `?date=`-loaderens én-dags
  bakoverbuffer absorberer restdrift.
- **Ingen nye DB-indekser/migrasjoner**: alle nye spørringer filtrerer først på indeksert
  `conversation_id`; per-samtale-volum er lite.

## Verifisering

- `npm test` (nye tester for chat-visible-day, month-grid, chat-search-snippet,
  like-escape, parseDayKey) og `npm run check` — grønt.
- Manuell sjekk i dev-server med Playwright (mobil viewport): blur-header med dato som
  oppdateres ved scroll, input-animasjonen (fokus → rad opp / binders ut, send → kollaps),
  kebabmeny → alle tre sheets, hopp med flash, infinite scroll og `?date=`-hopp.
- `npm run test:visual:review` for /design-endringene.
