# Resonans — Design- og arkitekturkontekst

Denne filen er ment som kontekst til nye samtaler. Den oppsummerer designprinsipper, UX-beslutninger, datamodell og flyt-arkitektur som er besluttet eller under utvikling.

Relaterte dokumenter:
- `PWA_DATA_LOADING_PLAN.md` — plan for raskere navigasjon, dashboard-cache, bakgrunnsprefetch og PWA-retning

---

## Levende stilguide

`/design` er en levende stilguide med faktiske komponenter og mock-data — ikke statiske skjermbilder.

**Ønsket:** Siden skal alltid gjenspeile faktisk kodebase. Når en ny komponent lages, skal den inn i design-siden. Når en designbeslutning tas, skal den dokumenteres der.

Siden bruker alltid mørkt tema (CSS-variabler overstyres lokalt i `.page { }`) uavhengig av systeminnstilling.

**Seksjoner per 28. mars 2026:**
- Designprinsipper
- Knapper (globale `btn-*`-klasser fra `app.css`)
- Widgets
- Chat-bobler
- Input & skjema
- Navigasjon
- Hjemskjerm
- Interaksjonsflyter
- Ukeplan

---

## Designprinsipper

Fire kjerneprinsipper styrer all UX-beslutning. Åpne appen skal føles som å puste *ut*, ikke inn.

1. **Hva har du fått til?** — Hjemskjermen ser bakover. Sensordata feirer fremgang. Viser "7 av 12 fullført", ikke "5 ting uferdig".

2. **To sekunder å dumpe** — Innfanging har null friksjon. Ingen kategorisering påkrevd. Bot sorterer etterpå — eller aldri.

3. **KAN løses, ikke MÅ løses** — Av 200 ting i systemet vises bare de som er relevante *i dag*. Backlog er usynlig med mindre du leter.

4. **Samtale > skjema** — All registrering kan skje som naturlig tekst. Bot tolker, strukturerer og bekrefter.

---

## Hjemskjerm-layout

Fire soner, ingen tab-bar, ingen overlays. Høydefordeling: **10 / 35 / 20 / 35** (tittel / widgets / tema / input).

```
┌─────────────────────────┐  10 % — Tittel
│ Resonans         ◎  ⚙  │        app-navn + lenkeikonknapper til /goals og /settings
├─────────────────────────┤  35 % — Widget-samling
│  ○    ○    ○    ○       │        sensorringer / pinned user-widgets
├─────────────────────────┤  20 % — Tema-rail
│  Trening  Søvn  Økonomi │        aktive temaer, eller CTA om ingen finnes
├─────────────────────────┤  35 % — Input-samling
│  💬 Chat  📷  😊  ⚡     │        verktøyknapper; åpner sonen til fullskjerm ved tap
└─────────────────────────┘
```

**Tilstander i tema-sonen:**
- Ingen temaer og ingen ukeplan → CTA "Lag en ukeplan" (åpner chat med prefill)
- Ingen temaer men ukeplan aktiv → viser dagens dag + ring-progress
- Temaer finnes → ThemeRail
- Fredagskveld → CTA "Gjør ukens mini-gjennomgang"

**Animasjonsprinsipper:**
- Tap på sone → sonen ekspanderer til `100dvh`, de andre forsvinner ut
- `height` + `opacity` via inline `style:` i Svelte — `300ms cubic-bezier(0.22, 1, 0.36, 1)`
- Ingen tab-bar. Tilbake = ← knapp i utvidet sone.

---

## Flyt-arkitektur

### Modell
Alle flyter har samme form:
```
Trigger → Informasjonsinnsamling → Artefakt
```
Et artefakt er alltid én av: **mål, oppgave, tema, widget, påminnelse**.

### Kodestruktur (planlagt)
```
src/lib/flows/
  weekly-plan/
    flow.ts       ← steg-definisjon, trigger-betingelser
    prompt.ts     ← systempromt for denne flyten
  stress-dump/
  running-goal/
  identity-interview/
```
Prompten lever *ved siden av* flyten den tilhører. Tools-laget er allerede på plass; flytene er orkestreringslogikk over det.

### Nøkkelflyter
| Flyt | Trigger | Artefakt |
|---|---|---|
| Ny ukeplan | CTA / mandag morgen | week_plan + tasks |
| Daglig innsjekk | morgenvarsling | task completions |
| Stressdump | "Noe kverner?" CTA | inbox_items → tasks/themes |
| Ukerefleksjon | fredag kveld | notat + neste-uke-frø |
| Måneds/kvartalsreview | periodeavslutning | oppsummering + nye mål |
| Årsrunden (kavalkaden) | nyttår | narrativ rapport med stats |
| Identitetsintervju | onboarding / ny bruker | life/flerårs-mål |

### Flyt: "Spør om widget" (foreslå → konfigurer → opprett)

Mål: bruker skal slippe "blind opprettelse" og få en tydelig preview + bekreftelse i chat før widget lagres.

#### Nåværende opplevelse (problem)
- Bruker beskriver widget i chat
- Bot oppretter widget direkte
- Bot svarer "opprettet, se hjemskjerm"
- Bruker må navigere ut av chat for preview og evt. slette/restarte

#### Ønsket opplevelse
1. Bruker beskriver ønsket widget i chat
2. Bot svarer med et **widget-forslagskort** i chat:
  - navn, metrikk, aggregation, periode/range, enhet, ev. filterCategory
  - live preview av forventet verdi (samme datastrøm som ekte widget)
3. Bruker kan velge direkte i kortet:
  - `Opprett widget`
  - `Konfigurer`
  - `Forkast`
4. Bruker kan også justere via tekst ("gjør den ukentlig", "bare dagligvare")
5. Ved `Konfigurer` åpnes konfig-sheet med flere valg
6. Før opprettelse spør bot om mål hvis relevant:
  - fast mål: "400"
  - relativt mål: "mindre enn snittet av forrige periode"
7. Widget opprettes først ved eksplisitt bekreftelse (knapp eller tydelig "ja, opprett")

#### Beslutningsregel
- **Ingen persist** i `user_widgets` før steget `confirm_create` er fullført.
- Inntil da er widgeten et `widget_draft` knyttet til samtalen.

#### Tilstandsmaskin
`intent_detected` → `draft_created` → `preview_rendered` → (`refine_text` | `configure`) → `confirm_create` → (`created` | `discarded`)

#### Widget-draft (konsept)
```ts
type WidgetDraft = {
  id: string;
  conversationId: string;
  title: string;
  metricType: 'amount' | 'weight' | 'sleepDuration' | 'steps' | 'distance' | 'workoutCount' | 'heartrate' | 'mood' | 'screenTime';
  aggregation: 'avg' | 'sum' | 'count' | 'latest';
  period: 'day' | 'week' | 'month';
  range: 'last7' | 'last14' | 'last30' | 'current_week' | 'current_month' | 'current_year';
  filterCategory?: string | null;
  unit: string;
  color: string;
  target?:
   | { mode: 'absolute'; value: number }
   | { mode: 'relative_prev_period'; operator: 'lt' | 'lte' | 'gt' | 'gte'; marginPct?: number };
};
```

#### Konfigureringsvalg i sheet
- Tittel
- Metrikk
- Aggregation
- Periode og range
- Kategori-filter (for amount)
- Farge
- Mål:
  - absolutt tall
  - relativt mot forrige periode (f.eks. `< avg(prev_period)`)

#### Chat-eksempler for målsetting
- "Sett målet til 400" → `target.mode='absolute', value=400`
- "Mindre enn snittet av forrige periode" → `target.mode='relative_prev_period', operator='lt'`
- "5% lavere enn forrige periode" → `target.mode='relative_prev_period', operator='lt', marginPct=5`

#### UX-krav
- Forslagskort skal vises i samme chat-tråd, ikke kreve navigasjon
- Preview skal oppdateres etter hver justering
- Opprett-knapp skal være tilgjengelig helt fra første forslag
- Forkast skal være ett trykk

#### Backend-prinsipp
- Rebruk eksisterende beregningslogikk for widget-data til preview (ingen egen "nesten-lik" path)
- Før opprettelse brukes draft-parametre mot preview-endepunkt
- Ved opprettelse mappes draft 1:1 til `user_widgets`

---

## Datamodell

### Tre entiteter

**`inbox_item`** — rå tekst, null metadata, ingen kategorisering påkrevd
```typescript
{ id, user_id, raw_text, created_at, promoted_to_task_id? }
```

**`task`** — diskret handling. Alltid samme entitet, uansett opprinnelse.
```typescript
{
  id, user_id,
  title,
  goal_id?,        // kobling oppover i målhierarkiet
  theme_id?,
  week_id?,        // ISO-uke, f.eks. "2026-W14"
  due_date?,
  completed_at?,
  contexts[],      // ['morgen', 'barn'] | ['kropp', 'utendørs'] | ['lav-energi']
  created_at
}
```

**`goal`** — ønsket utfall med målestokk
```typescript
{
  id, user_id,
  title,
  parent_goal_id?,    // hierarki via selvref.
  metric_type,        // 'numeric' | 'count' | 'boolean' | 'qualitative'
  target_value?,      // 88 (kg), 50 (km), null
  current_value?,     // auto-oppdatert fra sensor eller oppgaver
  unit?,              // 'kg', 'km', 'ganger'
  horizon,            // 'week' | 'month' | 'quarter' | 'year' | '5year' | 'life'
  due_date?,
  theme_id?,
  status,             // 'active' | 'completed' | 'paused' | 'dropped'
  created_at
}
```

### Målhierarkiet
Samme entitet hele veien, koblet med `parent_goal_id`:

```
[Identitet/Liv]  "Bli en person som lever i kroppen sin"
    └── [5year]  "Gå ned 25 kg"
          └── [year]  "Løpe mer enn i fjor"
                └── [quarter]  "5km under 25 min"
                      └── [month]  "3 treninger/uke"
                            └── [week]  "Svøm + pilates"
                                  └── [task]  "Svømmehall tirsdag"
```

### Om `metric_type`
- `numeric` — sensor oppdaterer `current_value` automatisk (vekt, søvntimer)
- `count` — summeres fra aktivitetslogg (løpekm, treningsøkter)
- `boolean` — fullført når siste tilknyttede oppgave er avkrysset, eller brukeren sier det
- `qualitative` — progress er det brukeren *forteller* i chat. Boten gjenkjenner relevant aktivitet og spør: *"Teller dette?"*

### Kontekstuell relevans
`contexts[]` på task kombinert med aktive temaer og tidspunkt bestemmer hva som vises.
Backlog er ikke borte — bare usynlig. Ukesplanvisningen filtrerer `WHERE week_id = current_week` og viser maks 4–6 oppgaver som er gyldige akkurat nå.

### Datakorrelasjoner (planlagt)
For "bedre humør etter løpeturer" trengs:
```typescript
mood_entry:      { date, score: 1–10, energy?: 1–10 }
activity_log:    { date, type, duration_min, distance_km? }
task_completion: { task_id, completed_at, task_type }
```
Withings gir allerede aktivitetsdata. Sinnstemning er allerede en input. Dato er nøkkelen. Lag-effekter (effekt av løpetur vises +1/+2 dager) håndteres i query-laget.

---

## Input-typer

### Direkte input-handlinger (bruker gjør noe aktivt)
- **Chat** — fri tekst, primærkanal for alt
- **Inbox-dump** — rå tekst, null friksjon, ingen kategorisering
- **Todo-avkryssing** — enkelt huk, kan også skje via chat
- **Humør** — slider (1–10) eller emoji-valg
- **Energi** — numeriske knapper (1–5)
- **Bilde/foto** — for dokumentasjon, prosjekter, mat

### Strukturerte input-flyter (chat-drevne sesjoner)
- **Ukeplan-oppsett** — bot henter kontekst, du definerer uke
- **Stressdump** — ~15 min fri prat → bot kategoriserer
- **Identitetsintervju** — lengre samtale om hvem du vil være
- **Ukerefleksjon** — fredag / månedsslutt / kvartal
- **Mål-oppsett** — for et konkret mål med metrikk
- **Årsrunden/kavalkaden** — nyttår

### Passive inputs (sensor, ikke en aktiv handling)
- Withings: vekt, søvn, skritt, aktivitet
- Aktivitetslogg: løpeturer, treningsøkter (Withings eller via chat)

### Planlagte fremtidige inputs
- Kalenderimport (iCal) — for sinnstemning × møter-korrelasjoner
- Partnerinput — delt mål, synkroniserte sjekklister

---

## Funn fra design-exploration

`/design-exploration` er en levende prototypeside med 22 seksjoner. Utover grunnleggende stilguide-seksjoner (farger, typografi, knapper, animasjoner, chat, toast) inneholder den seks «modi» inspirert av eksisterende apper, pluss ti interaksjonsflyter og en hjemskjerm-variant.

### Bend — Modus: Fokus & Komposisjon
Mørkt, rolig, fokusert uttrykk. NL-input → predefinerte byggeklosser.

- **Dato + streak-header:** flamme-emoji pill + avatar-knapp i øvre rad
- **Boble-klynge (orbital widget):** animerte aktivitetsballer med ulik størrelse/farge — tap for å velge
- **Fokus-modus AI-entry:** animert «orb» av roterende prikker rundt NL-inputfeltet
- **NL → filtre + animert CTA:** bruker skriver mål → filter-chips (Varighet/Vanskelighetsgrad/Filtre) vises → CTA spinner med sekventielle statusmeldinger → resultatskjerm
- **Sirkel-grid:** velg aktiviteter fra et grid av fargesirkler med emoji; elastic-scale animasjon ved valg; sticky CTA viser antall valgte

### ChatGPT — Modus: Oversikt & Organisering
Minimalt, vedlikeholdsfritt — innholdet organiserer seg selv.

- **Hjemskjerm:** tittel + søk + avatar, 3 hurtighandlinger (ikon + etikett), mappeliste med "Vis mer/mindre", nylige samtaler
- **Prosjektvisning:** breadcrumb-header, prosjekttittel, tab-pill (Samtaler / Filer), samtaleliste med tittel + forhåndsvisning, sticky chat-input festet nederst
- **Lys modus:** kompakt liste med fargede prikk-indikatorer per samtale

### Tempo — Modus: Kontinuitet & Utvikling
Periode-grids, aktivitetskalender, kumulative grafer, YTD-sammenligninger.

- **6-celle statistikkgrid:** 365/30/7/år/mnd/uke alle synlig simultant
- **Aktivitetskalender:** månedsgrid med intensitetsprikker (høy/middels/lav) over dato-tallet
- **Kumulativ trappetrinn-graf:** SVG med gradient-fill + stiplet hvit målinje + mål-detaljer (Mål/Start/Slutt/Fullført/Foran med)
- **YTD-sammenligning:** to kolonner (i fjor vs. i år) med delta-farger per rad (distanse/hastighet/varighet/kalorier)
- **Mål-ringer:** SVG-sirkler side om side med prosent/stjerne og deadline (100%= fyllt ring + gyllen farge)

### Stoic — Modus: Refleksjon & Sinnstemning
Nesten ingen chrome, stort spørsmål, romslig pusterom.

- **Hjemskjerm:** morgen+kveld-kortpar, praksisliste (3 kort), streak-pill, "4 812 sjekket inn i dag"
- **Steg 1 — Sinnstemningsslider:** label viser dynamisk ord ("Dårlig" → "Strålende"), Forferdelig/Flott som ytterpunkter
- **Steg 2 — Emosjonsord-grid:** 12+ ord (Modig/Tilfreds/Stolt/Takknemlig...), multi-velg, "Vis flere/færre", "Tilpass"-knapp
- **Steg 3 — Kontekst-ikonvelger:** 9 fliser med ikon + etikett (Jobb/Familie/Partner/Trening/Venner...), multi-velg
- **Steg 4 — Journalprompt:** AI generert spørsmål + utdypingsblokksitatat, fri textarea, "Gå dypere"-knapp, AI-pill ("✦ Resonans")

### Withings Health Mate — Modus: Vitalitet & Helse
Helse-indekser, animated grafer, sparkline-kort.

- **Score-piller:** horisontal scrollbar rad (Søvn/Aktivitet/Form) med ikon-sirkel + poeng-tall + "pts"
- **Score-detalj-kort:** tre kolonner (Forrige/Nåværende/Prediksjon) + SVG solid-linje → prikk → stiplet kurve
- **Metrikk-kort med sparklines:** ikon + etikett + sist-dato, verdi + enhet + tag-merke med farge, mini SVG bar- eller linjegraf; stiplet målinje på skrit-kortet
- **Bar→Prikk animert overgang:** toggle-knapp bytter mellom rektangler og sirkler; beste dag markert med stjerne

### Ninthlife — Modus: Ninthlife
Smartklokke-data oppsummert på tvers av perioder.

- **Horisontal metrikk-velger:** Vekt/Søvn/Skritt/Løp... — bytter datasettet under
- **2×3 sirkel-grid:** seks sirkler per metrikk (2026, 365 dager, inneværende mnd, 30 dager, uke, 7 dager) med verdi + CSS `--nl-c`-accent-farge; tap → åpner kumulativ chart
- **Akkumulert sammenligningsgraf:** SVG med to linjer — Nå (oransje) vs Da (grå) over antall dager; Y-akse-etiketter
- **Nedbrytingstabell:** periode-tabs (Årlig/Månedlig/Ukentlig), kolonn-ikoner, rader med fargekodet sirkelcelle per uke/mnd/år

### Interaksjonsflyter (10 flyter)

**1 · Automatisk innsikt fra sensordata** — proaktive «Nytt siden sist»-kort med sensor-delta (ikon, etikett, endring), direkte CTA til chat.

**2 · System-1 lynregistrering** — kveld-sjekk-inn: emoji-stemningspiller + to sliders (Energi/Fokus) + "Logg inn ✓".

**3 · Rask skjema-registrering (styrkeøkt)** — forhåndsutfylt øvelse-tabell (navn/sett/reps/kg), "+ Øvelse"-knapp, "Lagre økt"-knapp + AI-sammenligningsknapp.

**4 · Bilde → automatisk registrering** — upload-sone → AI-caption → Lagre/Forkast.

**5 · Fri skriving + AI-analyse** — åpen journalprompt → "Analyser ✦"-knapp → analyse-kort med tema/tone/oppfølging + chat-CTA.

**6 · Prosjektmappe med kontekstfiler** — prosjekttittel + filer-liste + chat-input pinnet til bunn; AI har filkontekst.

**7 · Spontan chat → stille minne** — bruker klager på jobben → bot svarer empatisk → chat-boble får "✦ Husket stille"-pille under seg. Ingen avbrytelse, ingen spørsmål.

**8 · Engasjementsnivå — fra pust til pakke** *(nøkkel-UX-mønster)*
Bot oppdager mønster og tilbyr å skalere opp. Bruker velger eksplisitt nivå:

| Nivå | Etikett | Beskrivelse |
|------|---------|-------------|
| 0 | Glem | Ikke lagre noe |
| 1 | Husk | Stille minne, ingen struktur |
| 2 | Tema | Oppretter samtaleprosjekt |
| 3 | Spor | Kobler til mål med metrikk |
| 4 | Pakka | Full onboarding: Mål → Metrikker → Nudging (3-stegs flyt) |

**9 · Bot ber om input — variantgalleri** — tre varianter av proaktiv innhenting:
- A: Sinnstemningsslider (😔→🤩 med dynamisk label, "Lagre"-knapp)
- B: Emoji-velger (rad med 5 emojier, bot bekrefter)
- C: Energiskala 1–5 (fargekodet knapper: rød→blå)

**10 · Meldingstriage — én inntasting, fire utfall** — bot detekterer intensjon og foreslår container:
- **Emosjon** ("Jeg hater jobben") → Glem det / Lag prosjekt (Forbedre / Finn ny jobb)
- **Aktivitet** ("Jeg løp 8,2 km") → Garmin-kryssjekk → Husk / Knytt til mål / Start tema
- **Oppgave** → Oppgave-nedbrytning
- **Aspirasjon** → Engasjementsnivå-velger (se flyt 8)

### Hjemskjerm: Tre soner
Alternativ hjemskjerm-variant med CSS-klasser `hs2-*`.

- **Rippel-effekt:** pointer-event → SVG animert sirkel som briser ut fra touch-punkt
- **Boble-cluster for aktivitetsvalg:** fargekodet emoji-bobler før logg-handling
- **Langtrykksmeny på widget:** kontekstmeny via langt-trykk
- **Chat-bobler med gren-etikett:** "Loggfører under Trening & helse"

---

## Ikoninventar (egne + emoji)

Mål: samle dagens ikonbruk i én referanse før vi lager et tydelig, eget ikonsett.

### 1) Egne ikoner (tegn/symboler)

Brukes som et lettvekts «ikonalfabet» flere steder i appen:

- Primære handlinger: `◈` (Prat), `◉` (Kamera), `∿` (Lyd), `◐` (Sjekkin), `▣` (Fil)
- Navigasjon/lenker: `◎`, `⬡`, `⚙`, `←`, `→`, `✕`, `×`

Kilder i kode:
- `src/lib/components/domain/HomeScreen.svelte`
- `src/routes/samtaler/+page.svelte`
- `src/routes/maal/+page.svelte`
- `src/routes/goals/+page.svelte`

### 2) Egne ikoner (inline SVG)

Vi bruker per nå ikke ekstern ikonpakke; ikoner tegnes inline i komponentene.

- Tilbake-chevron (20x20 / 24x24)
- Søk (forstørrelsesglass)
- Oppdater/refresh (roterende pil)

Kilder i kode:
- `src/lib/components/ui/TransactionList.svelte`
- `src/routes/economics/[accountId]/[tab]/+page.svelte`
- `src/routes/settings/+page.svelte`
- `src/routes/notifications/+page.svelte`

### 3) Emoji i aktiv app (UI)

- Stemning og check-in: `😔 😐 🙂 😊 🤩`
- Påvirkningsfaktorer: `💤 🏃 🥗 💼 🧑‍👧 👥 ☀️ 💸 🩺 🎨 🧘 🌿`
- Mål/samtaler/generelt: `💬 ⚙️ 🎯 📌 🗓️`
- Innstillinger/notifikasjoner: `💍 📱 🏃‍♂️ 🏦 📂 📅 📤 🕐`

Kilder i kode:
- `src/lib/components/domain/HomeScreen.svelte`
- `src/routes/goals/+page.svelte`
- `src/routes/samtaler/+page.svelte`
- `src/routes/settings/+page.svelte`
- `src/routes/notifications/+page.svelte`

### 4) Emoji i data/API-lag

- Dashboard-forslag: `✅ 🎯 📊 💬`
- Standard checklist: `✅`
- Auto-opprettede tema ved integrasjoner: `💪` (Helse), `💰` (Økonomi)
- Økonomikategorier: `🛒 🍽️ 🏠 🏦 🚗 💊 📱 🎉 🛍️ 👶 🛡️ 💰 🔄 💵 📦`

Kilder i kode:
- `src/routes/api/dashboard/+server.ts`
- `src/routes/api/checklists/+server.ts`
- `src/routes/api/sensors/withings/callback/+server.ts`
- `src/routes/api/sensors/sparebank1/callback/+server.ts`
- `src/routes/api/economics/merchant-analysis/+server.ts`

### 5) Prototyping/design-sider

`/design` og `/design-exploration` inneholder mange ekstra emojier brukt til demo/flyt-gallerier. Disse er nyttige som inspirasjonsbank, men bør ikke tolkes som «godkjent» produksjonssett.

### 6) Resonans ikonbibliotek v1 (forslag)

Første mål er å standardisere handlinger og navigasjon med egne ikoner, og la emoji leve videre som domene-markorer (tema/kategori/stemning).

Kjerneregler:
- Egne ikoner brukes for handling, navigasjon og systemstatus.
- Emoji brukes for personlig kontekst: tema, humør, kategorier, feiring.
- Alle egne ikoner tegnes med samme stil: avrundede caps/joins, konsistent stroke og optisk sentrering.

Anbefalt baseline:
- Grid: 24 x 24
- Stroke: 1.75
- Radius: 2
- Variantstotte: outline (primar), filled (kun aktiv tilstand)

Foreslatte ikoner (token -> betydning):
- `ri-chat` -> prat/samtale
- `ri-camera` -> bilde/fangst
- `ri-wave` -> lyd/snakk
- `ri-checkin` -> stemning/sjekk inn
- `ri-file` -> dokument/vedlegg
- `ri-goals` -> mal
- `ri-settings` -> innstillinger
- `ri-back` -> tilbake
- `ri-forward` -> ga videre
- `ri-search` -> sok
- `ri-refresh` -> oppdater/sync
- `ri-close` -> lukk/fjern

### 7) Migreringskart v1 (dagens -> nye tokens)

Handlingssymboler i HomeScreen:
- `◈` -> `ri-chat`
- `◉` -> `ri-camera`
- `∿` -> `ri-wave`
- `◐` -> `ri-checkin`
- `▣` -> `ri-file`

Navigasjon og kontroll:
- `◎` -> `ri-goals` (eller `ri-theme` om vi innforer eget tema-token)
- `⬡` -> `ri-home` (nytt token dersom vi standardiserer bunnnav)
- `⚙` / `⚙️` -> `ri-settings`
- `←` -> `ri-back`
- `→` -> `ri-forward`
- `✕` / `×` -> `ri-close`

Inline SVG som allerede matcher v1-retning:
- Chevron tilbake -> `ri-back`
- Forstorrelsesglass -> `ri-search`
- Refresh-pil -> `ri-refresh`

### 8) Foreslatt innforingsrekkefolge

Fase 1 (lav risiko):
- Bytt kun handlingsikoner i hjemskjerm og samtaler til v1-tokens.
- Behold emoji i tema-rail, check-in faktorer og kategorier.

Fase 2 (navigasjon):
- Erstatt nav/shell-symboler (`◎`, `⬡`, `⚙`) med egne ikoner.

Fase 3 (opprydding):
- Fjern duplikate tegnvarianter (`✕` vs `×`, `⚙` vs `⚙️`).
- Dokumenter endelig ikonordbok i design-siden med preview-komponent.

### 9) Hue-strategi (forelopig)

Mål:
- Gjore appen mindre tung og ensformig
- Unnga at opplevelsen blir «regnbue» eller tilfeldig
- Beholde ett samlet visuelt system pa tvers av temaer

Prinsipp:
- Appen har én standard-hue som basis.
- Et lite antall kuraterte kjernetemaer kan fa egen hue.
- Brukeropprettede temaer faller tilbake til standard-hue inntil videre.

Forelopig retning:
- Standard: rolig base-hue for hele appen
- Parforhold / relasjoner: dempet, beroligende gronn hue
- Helse: enten standard-hue eller en kjoligere gronn/blagronn variant
- Okonomi: enten standard-hue eller en strammere amber-variant
- Andre temaer: default

Begrensning:
- Vi forhandsdefinerer ikke vilkarlige tema -> farge-kombinasjoner na.
- Vi apner ikke for fri fargevelger for brukerlagde tema enda.
- Dersom brukerfargevalg kommer senere, bor det skje via et lite kuratert preset-sett, ikke fri HSL/HSV-picker.

Startpalett (v1):

| Tema | Hue | Intensjon |
|---|---:|---|
| `default` | 228 | Noytral base for hele appen |
| `relasjoner` | 148 | Beroligende, dempet gronn for parforhold og nære relasjoner |
| `helse` | 172 | Kjolig gronn-blagronn for kropp, søvn og vitalitet |
| `okonomi` | 38 | Strammere amber for penger og struktur |

Regel:
- Bare disse fargene brukes som eksplisitte tema-unntak i første omgang.
- Nye eller ukjente tema bruker `default`.

### 10) Hue-rigg for darkmode og lightmode

Samme hue-system skal fungere i begge modi. Vi lager derfor ikke ett fargesystem for dark og et annet for light; vi gjenbruker samme hue, men med ulike lyshetsstiger.

Prinsipp:
- `hue` barer tematisk identitet
- `saturation` holdes innenfor et smalt, kontrollert spenn
- `lightness` byttes per modus og per token-niva

Eksempelmodell:

```css
/* dark */
--bg-0: hsl(var(--theme-hue) 100% 5%);
--bg-1: hsl(var(--theme-hue) 58% 8%);
--bg-2: hsl(var(--theme-hue) 44% 12%);
--border: hsl(var(--theme-hue) 26% 28%);
--fg: hsl(var(--theme-hue) 92% 78%);

/* light */
--bg-0: hsl(var(--theme-hue) 70% 98%);
--bg-1: hsl(var(--theme-hue) 46% 96%);
--bg-2: hsl(var(--theme-hue) 30% 92%);
--border: hsl(var(--theme-hue) 20% 78%);
--fg: hsl(var(--theme-hue) 36% 24%);
```

Konsekvens:
- Mork og lys modus foles som samme tema, ikke to forskjellige personligheter.
- Hue-fade mellom temaer fungerer i begge modi fordi bare hue endres kontinuerlig.
- Kontrast kan finjusteres per modus uten at temalogikken endres.

Anbefaling na:
- Bygg videre pa ett hue-token per tema: `--theme-hue`
- La resten av tokenene (`--bg-*`, `--border`, `--fg`, `--accent`) avledes av hue + modus
- Start med dark som primar modus i design-siden, men hold tokenstrukturen kompatibel med light fra starten

Foreslatt token-oppsett i appen:

```css
/* tema-identitet */
--theme-hue: 228;

/* modus-uavhengig struktur */
--bg-0: ...;
--bg-1: ...;
--bg-2: ...;
--border-subtle: ...;
--border-strong: ...;
--fg-primary: ...;
--fg-secondary: ...;
--accent: ...;

/* eksempel: temaspesifikk override */
[data-theme-key='relasjoner'] {
  --theme-hue: 148;
}

[data-theme-key='helse'] {
  --theme-hue: 172;
}

[data-theme-key='okonomi'] {
  --theme-hue: 38;
}
```

Implementasjonsretning:
- Tema setter bare `--theme-hue` eller `data-theme-key`
- Modus (`dark` / `light`) bestemmer hvilken lyshetsstige som brukes
- Komponentene leser kun avledede tokens, ikke harde hex-farger

---

## CSS-arkitektur

- Globale knapper: `btn-primary`, `btn-secondary`, `btn-ghost`, `btn-chip`, `btn-danger`, `btn-icon` — definert i `app.css` med CSS-variabler
- Mørk tema: CSS-variabler (`--bg-primary`, `--bg-card`, `--accent-primary` osv.) overstyres per-side i rot-klassens CSS-blokk
- Design-tokenene: `#0f0f0f` bg · `#1a1a1a` card · `#2a2a2a` border · `#4a5af0` accent · `#eee` text
- Videre retning: farge-tokenene bor gradvis flyttes til hue-drevet HSL, slik at samme temalogikk fungerer i darkmode og lightmode

---

## MD-filer i prosjektet — status

| Fil | Status |
|---|---|
| `DESIGN_CONTEXT.md` | ✅ Denne filen — aktiv kontekst |
| `README.md` | ⚠️ Grunnleggende men gammel — bør oppdateres |
| `DEPLOYMENT.md` | ✅ Trolig fortsatt relevant |
| `DATABASE_SETUP.md` | ✅ Trolig relevant |
| `QUICKSTART.md` | ⚠️ Kan være utdatert |
| `CRON_SETUP.md` | ✅ Trolig relevant for cron-ruter |
| `TESTING.md` | ⚠️ Kan være utdatert |
| `TESTING_CONVERSATION.md` | ❌ Utdatert testnotat — kan slettes |
| `TESTING_PROGRESS.md` | ❌ Utdatert testnotat — kan slettes |
