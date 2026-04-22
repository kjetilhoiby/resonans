# Design System Migration Plan

Denne planen beskriver full migrasjon fra dagens ad hoc-UI til et komponentbasert designsystem i Resonans.

Målet er ikke bare visuell konsistens, men å gjøre nye skjermer, refaktorering og agentisk utvikling mer styrt, raskere og mindre sårbar for lokal drift i route-filer.

Relaterte dokumenter:
- `DESIGN_CONTEXT.md` — overordnet design- og arkitekturkontekst
- `DESIGN_SYSTEM_STRATEGY.md` — strategiske tanker om designretning
- `/design` — levende stilguide og visualisering av eksisterende UI-mønstre

---

## Status

**Fase:** Fase 1 påbegynt  
**Eier:** Pågår som arkitektur- og UI-migrasjon  
**Sist oppdatert:** 2026-04-22

### Fremdrift

- [~] Fase 1 — Etablere primitives og page shell
- [ ] Fase 2 — Migrere side-layout og headers
- [ ] Fase 3 — Migrere controls, kort og lister
- [ ] Fase 4 — Migrere route-familier
- [ ] Fase 5 — Stramme inn regler, opprydding og verifisering

### Nåværende situasjon

- Det finnes allerede et gryende UI-lag i `src/lib/components/ui`
- Route-filer eier fortsatt mye av page shell, header-markup, spacing og standardkontroller
- Globale `btn-*`- og enkelte `ds-*`-klasser finnes i `src/app.css`, men brukes ikke som enerådende byggesteiner
- Flere sider introduserer egne containere med `max-width`, `margin: 0 auto`, lokal headerstruktur og lokal kort-/input-styling
- Dette gir høy risiko for visuell og strukturell drift, spesielt ved agentisk utvikling

### Ferdig definert når

- Alle nye standard-sider bygges med `AppPage`
- Standard toppseksjon bygges med `PageHeader`
- Standardknapper, inputs, chips, seksjonskort og vanlige lister går gjennom delte primitives
- Route-filer eier domene og dataflyt, ikke basis-UI
- Designendringer i primitives slår ut bredt uten at route-filer må oppdateres manuelt

---

## Referanseflater

Følgende flater vurderes per nå som de strammeste og skal brukes som referanse når primitives, spacing og page shell utformes:

1. `src/routes/+page.svelte` + `src/lib/components/domain/HomeScreen.svelte`
2. `src/routes/ukeplan/+page.svelte`
3. `src/routes/tema/[id]/+page.svelte` + `src/lib/components/domain/ThemePage.svelte`

### Hvordan disse skal brukes i migrasjonen

- `HomeScreen` er referanse for overordnet produktidentitet, rytme, mørk flate, komposisjon og interaksjonsnivå
- `Ukeplan` er referanse for tett, funksjonell arbeidsflate med relativt moden struktur
- `ThemePage`, spesielt økonomi-varianten, er referanse for temasider og domenedashboards

Disse skal ikke nødvendigvis være de første sidene som gjennomgår stor strukturell migrasjon. De skal først brukes til å definere hva primitives og layoutsystemet må støtte.

### Prinsipp

Migrasjonen skal løfte resten av appen opp mot disse referanseflatene, ikke vanne ut referanseflatene for å passe svakere sider.

---

## Problemforståelse

### Dagens hovedproblemer

1. **Page shell er ikke sentralisert**
   Nye sider velger ofte egne containere, `max-width`, padding og toppspacing.

2. **Header-struktur er fragmentert**
   Ulike sider bruker ulike varianter av `page-header`, `header-top`, `back-link`, `btn-nav` og rene `h1`-blokker.

3. **Standardkontroller er delvis standardisert, men ikke tvunget**
   CSS-klasser eksisterer, men route-filer kan fortsatt enkelt lage egne knapper og input-felter.

4. **Kort og lister er ofte løst lokalt**
   Mange sider gjentar samme mønstre med lokale `<section>`, `<div>` og `<ul>`-oppsett med nesten-identisk styling.

5. **Agentisk utvikling forsterker lokal drift**
   Når route-filer allerede inneholder inline UI-mønstre, vil nye endringer ofte kopiere disse i stedet for å bruke delte primitives.

### Arkitekturproblem bak UI-problemet

Det egentlige problemet er at appen mangler et tydelig, obligatorisk toppnivå for skjermbygging.

Det finnes komponenter, men de er ikke sterke nok som standardbane for nye sider.

Migrasjonen må derfor etablere et faktisk UI-system med:

- ett tydelig page shell
- ett tydelig header-mønster
- et lite sett opinionated UI-primitives
- klare regler for hva routes ikke skal definere selv

---

## Målbilde

### Prinsipp

Alle standard UI-mønstre skal som default gå gjennom delte primitives.

Det gjelder spesielt:

1. Page shell
2. Page header
3. Knapper
4. Input-felter og textarea
5. Chips og filter pills
6. Seksjonskort og surfaces
7. Standardlister og liste-rader
8. Empty states
9. Chat-bobler og chat-composer

### Arkitekturlag

#### 1. UI primitives

Plassering: `src/lib/components/ui`

Ansvar:
- visuell grammatikk
- spacing og layout-defaults
- states og tilgjengelighet
- semantisk standardmarkering

#### 2. Composed components

Plassering: `src/lib/components/composed`

Ansvar:
- gjenbrukbare blokker som kombinerer primitives
- eksempel: `GoalCard`, `TaskList`, `ChecklistWidget`

#### 3. Domain components og routes

Plassering: `src/lib/components/domain` og `src/routes`

Ansvar:
- dataflyt
- domeneoppførsel
- sammensetning av primitives og composed components

Routes skal som hovedregel ikke eie rå page shell, standard header, standardknapper, standardkort eller standard inputs.

---

## Målstruktur for UI-laget

Følgende offentlige primitives skal være målbilde for første migrasjon:

### Layout og navigasjon

- `AppPage`
- `PageHeader`
- `SectionCard`
- `Surface`
- `EmptyState`

### Actions og input

- `Button`
- `IconButton`
- `Input`
- `Textarea`
- `FormField`
- `Chip`

### Lister og presentasjon

- `List`
- `ListItem` eller `RecordRow`

### Chat og samtale

- `ChatBubble`
- `ChatComposer`

### Eksisterende komponenter som bør beholdes eller videreutvikles

- `Section.svelte` kan migreres til eller erstattes av `SectionCard`
- `ScreenTitle.svelte` kan beholdes som enklere tittelprimitive, men page-level header bør flyttes til `PageHeader`
- `ChatInput.svelte` bør utvikles videre til `ChatComposer`
- `ChatBubble.svelte` bør beholdes som chat-primitive
- `CompactRecordList.svelte` og `TransactionList.svelte` må vurderes mot nytt liste-lag

---

## Kjernebeslutninger

### 1. `AppPage` blir obligatorisk standard for route-sider

Alle standard pages skal bruke `AppPage` som toppnivå-wrapper.

`AppPage` skal eie:

- horisontal layout
- sidepadding
- min-height
- safe-area spacing
- full-bleed versus constrained variants
- vertikal rytme mellom hovedseksjoner
- header-slot og standard alignment mellom header og body

Eksempler på ansvar som flyttes ut av routes:

- `max-width`
- `margin: 0 auto`
- default `padding`
- hovedcontainer for siden
- primær top spacing

`AppPage` må utformes slik at den kan støtte både:

- klassiske innholdssider med behov for styrt bredde
- tette, immersive flater som `HomeScreen`, `Ukeplan` og `ThemePage`

Det betyr at page shell ikke bare skal støtte en sentrert dokumentside, men også fullskjerms, kant-til-kant arbeidsflater.

### 2. `PageHeader` blir standard toppseksjon

`PageHeader` skal erstatte lokal page-header markup på standard-sider.

Den skal kunne håndtere:

- tittel
- undertittel
- tilbakeknapp via `backHref` eller callback
- optional actions slot
- optional sticky behavior
- korrekt spacing og alignment mot `AppPage`

### 3. Standardkontroller skal være komponenter, ikke bare klasser

Globale tokens og CSS-klasser beholdes, men nye standard controls skal bygges som primitives.

Det gjør det lettere å:

- styre semantikk
- sikre fokusstates og disabled states
- redusere lokale one-off-varianter
- gi agentene én åpenbar implementasjonsbane

### 4. Ikke bygg ett hypergenerisk system

Primitives skal være små og opinionated.

Det er bedre å ha:

- én tydelig `SectionCard`
- én tydelig `ListItem`
- én tydelig `Button`

enn ett system med svært mange props og lokale overstyringer.

---

## Faseplan

## Fase 1 — Etablere primitives og page shell

**Mål:** Definere det minimale primitive-laget som kan brukes på tvers av appen.

### Leveranser

- Opprette `AppPage`
- Opprette `PageHeader`
- Opprette `Button`
- Opprette `IconButton`
- Opprette `Input`
- Opprette `Textarea`
- Opprette `Chip`
- Opprette `SectionCard`
- Opprette eller tilpasse `EmptyState`
- Oppdatere `src/lib/components/ui/index.ts`

### Designkrav

- Alle komponenter bruker eksisterende design tokens eller nyoppryddede tokens i `src/app.css`
- API-ene holdes små og opinionated
- Komponentene må fungere både på mobil og desktop
- Fokusstates og disabled states må være konsekvente
- Primitive-laget må verifiseres mot referanseflatene `HomeScreen`, `Ukeplan` og `ThemePage`, slik at det ikke bare optimaliseres for enklere admin-sider

### Avklaringer som skal tas i denne fasen

- Om `ScreenTitle` beholdes som separat primitive eller foldes inn i `PageHeader`
- Om `Section.svelte` omdøpes eller beholdes og brukes som base for `SectionCard`
- Om `ChatInput` skal omdøpes til `ChatComposer` eller bare få nytt offentlig navn i `index.ts`
- Hvilke `AppPage`-varianter som trengs for å dekke både `HomeScreen`, `Ukeplan`, `ThemePage` og mer klassiske innholdssider

### Exit-kriterier

- Primitive-laget kan brukes til å bygge en standard side uten lokal basis-CSS
- `/design` kan vise de nye primitives side om side
- Primitive-laget er validert mot minst én referanseflate og én svakere ad hoc-side

---

## Fase 2 — Migrere side-layout og headers

**Mål:** Fjerne drift i page shell og toppseksjoner.

### Arbeid

- Migrere representative sider til `AppPage`
- Erstatte lokale page headers med `PageHeader`
- Fjerne lokale containere som primært eksisterer for bredde, padding og toppspacing

### Strategi for rekkefølge

Fase 2 skal ikke starte med de mest vellykkede flatene. Den skal starte med sider som i dag har størst drift i page shell og header, og som derfor gir størst gevinst av standardisering.

### Anbefalt rekkefølge

1. `src/routes/settings/external-apps/+page.svelte`
2. `src/routes/settings/+page.svelte`
3. `src/routes/notifications/+page.svelte`
4. `src/routes/goals/+page.svelte`
5. `src/routes/economics/+page.svelte`

### Referansebruk i denne fasen

- `HomeScreen` brukes som referanse for spacing, ikonbruk, tone og helhetlig opplevelse
- `Ukeplan` brukes som referanse for tett, funksjonell toppseksjon og informasjonsrytme
- `ThemePage` brukes som referanse for fullskjerms temaflater og overgang mellom header, subnav og innhold

### Sider som bør skjermes tidlig

Disse bør i første omgang brukes som standardgivere og kun få begrensede, målrettede endringer:

1. `src/lib/components/domain/HomeScreen.svelte`
2. `src/routes/ukeplan/+page.svelte`
3. `src/lib/components/domain/ThemePage.svelte`

For disse sidene bør første pass primært handle om:

- å hente ut primitives som allerede fungerer
- å redusere one-off controls der det er lav risiko
- å unngå strukturell redesign før primitives er modne

### Hva som skal bort fra route-filene

- lokale `.container`, `.page`, `.screen`, `.external-page`-wrappere som kun styrer standard layout
- lokale `.page-header`-blokker som gjentar samme mønster
- lokale `.back-link`- og header-top-løsninger for standardsider

### Exit-kriterier

- Minst 3–5 sentrale sider er på nytt page shell
- Headermønsteret er visuelt og strukturelt konsistent på tvers

---

## Fase 3 — Migrere controls, kort og lister

**Mål:** Gjøre standard interaksjonselementer og standardflater delte og tvungne.

### Arbeid

- Erstatte rå standardknapper med `Button` eller `IconButton`
- Erstatte rå standard inputs og textarea med `Input`, `Textarea`, `FormField`
- Erstatte standard seksjonsblokker med `SectionCard` eller `Surface`
- Definere `List` og `ListItem` eller `RecordRow` for vanlige listeoppsett

### Fokusområder

- settings-sider med skjema og admin-lister
- sider med mange standardkort
- steder som i dag har lokale `.card`, `.input`, `.btn-*`-varianter utenfor primitive-laget

### Exit-kriterier

- Standard controls implementeres normalt ikke lenger som rå HTML + lokal CSS i routes
- En ny side kan bygges med nesten ingen presentasjons-CSS i route-filen

---

## Fase 4 — Migrere route-familier

**Mål:** Rulle migrasjonen bredt ut i appen.

### Prioritert rekkefølge

#### 1. Settings-familien

Grunn:
- mange administrative sider
- mye skjema, lister, standardkort og headers
- høy risiko for variasjon

Aktuelle ruter:
- `src/routes/settings/+page.svelte`
- `src/routes/settings/external-apps/+page.svelte`
- `src/routes/settings/classification/+page.svelte`
- `src/routes/settings/classification/rules/+page.svelte`
- `src/routes/settings/classification/merchants/+page.svelte`
- `src/routes/settings/classification/transaction-rules/+page.svelte`

#### 2. Economics-familien

Grunn:
- mange containere med `max-width`
- blanding av dashboard-oppsett, lister og tab-lignende controls

Aktuelle ruter:
- `src/routes/economics/+page.svelte`
- `src/routes/economics/[accountId]/[tab]/+page.svelte`
- `src/routes/economics/[accountId]/salary-month/+page.svelte`
- `src/routes/tema/[id]/+page.svelte` som integrasjonspunkt for økonomi-temaopplevelsen

#### 3. Goals og notifications

Grunn:
- tydelige page headers
- standardkort og actions
- høy synlighet i produktet

Aktuelle ruter:
- `src/routes/goals/+page.svelte`
- `src/routes/notifications/+page.svelte`

#### 4. Chat- og samtaleflater

Grunn:
- bør bruke samme primitives for bubble, composer og actions
- viktig for samlet produktidentitet

Aktuelle områder:
- `ChatBubble.svelte`
- `ChatInput.svelte`
- relevante route-flater som bruker egen chat-markup

#### 5. Referanseflater

Disse migreres sist eller i svært kontrollerte steg, etter at primitives er bevist i resten av appen:

- `src/lib/components/domain/HomeScreen.svelte`
- `src/routes/ukeplan/+page.svelte`
- `src/lib/components/domain/ThemePage.svelte`

Målet her er ikke å forenkle dem ned til generiske admin-mønstre, men å konsolidere det som allerede er bra inn i delte primitives der det er trygt.

### Exit-kriterier

- De viktigste route-familiene følger samme primitive-lag
- Antallet lokale designmønstre i route-filer er betydelig redusert

---

## Fase 5 — Regler, opprydding og verifisering

**Mål:** Gjøre designsystemet til normalbanen for videre utvikling.

### Arbeid

- Fjerne eller redusere gamle lokale helper-klasser som overlapper primitives
- Oppdatere dokumentasjon og eventuelle repo-instrukser
- Sørge for at `/design` viser nye primitives og anbefalte kombinasjoner
- Dokumentere hvilke gamle patterns som er deprekerte
- Gjennomføre opprydding i route-filer som fortsatt bærer gammel basis-CSS

### Regler som bør formaliseres

1. Alle nye standardsider bruker `AppPage`
2. Standard toppseksjon bruker `PageHeader`
3. Standard actions bruker `Button` eller `IconButton`
4. Standardfelt bruker `Input`, `Textarea` og eventuelt `FormField`
5. Standardkort bruker `SectionCard` eller `Surface`
6. Lokal CSS for basis-UI er unntak og må være begrunnet i konkret sidebehov

### Exit-kriterier

- Teamet og agentene har én tydelig standardmåte å bygge nye skjermer på
- Nye sider introduserer ikke nye ad hoc containere og standardkontroller uten grunn

---

## Komponentkontrakter

Dette er anbefalt første API-nivå. Målet er tydelige defaults, ikke maksimal fleksibilitet.

### `AppPage`

Anbefalte props:

- `width`: `full | content | narrow`
- `padding`: `none | default | comfortable`
- `surface`: `default | subtle | transparent`
- `gap`: kontrollert vertikal spacing

Anbefalte slots:

- `header`
- default slot
- eventuelt `footer`

### `PageHeader`

Anbefalte props:

- `title`
- `subtitle?`
- `backHref?`
- `backLabel?`
- `sticky?`

Anbefalte slots:

- `actions`
- eventuelt `leading`

### `Button`

Anbefalte props:

- `variant`: `primary | secondary | ghost | danger`
- `size`: `sm | md | lg`
- `disabled?`
- `href?`
- `type?`

Mulig utvidelse senere:

- `leadingIcon`
- `trailingIcon`

### `IconButton`

Anbefalte props:

- `variant`: `default | danger | nav`
- `ariaLabel`
- `href?`
- `disabled?`

### `Input` og `Textarea`

Anbefalte props:

- standard native props via passthrough
- `invalid?`
- `quiet?` bare hvis det faktisk trengs

### `FormField`

Anbefalte props:

- `label`
- `hint?`
- `error?`
- `for?`

### `SectionCard`

Anbefalte props:

- `title?`
- `meta?`
- `tone?`

### `Chip`

Anbefalte props:

- `active?`
- `variant?`
- `disabled?`

### `ListItem` eller `RecordRow`

Anbefalte props:

- `title`
- `subtitle?`
- `meta?`
- `trailing?`

---

## Migreringsregler per side

Når en route migreres, brukes følgende sjekkliste:

1. Pakk siden inn i `AppPage`
2. Erstatt lokal toppseksjon med `PageHeader`
3. Migrer standard actions til `Button` og `IconButton`
4. Migrer standardfelt til `Input`, `Textarea` og `FormField`
5. Migrer standard seksjonsblokker til `SectionCard` eller `Surface`
6. Migrer standardliste-struktur til `List` og `ListItem` der det passer
7. Fjern lokal CSS som kun eksisterte for standardmønstre
8. Behold lokal CSS kun for domeneunik layout eller interaksjon

---

## Hva som ikke skal standardiseres for hardt

For å unngå overabstraksjon skal følgende ikke tvinges inn i hypergeneriske primitives uten dokumentert behov:

1. Hele dashboards med unik komposisjon
2. Domene-spesifikke visualiseringer og charts
3. Komplekse interaksjonsflyter med spesiallayout
4. Alle listevarianter inn i én universell listekomponent
5. Alle kortflater inn i én altomfattende `Card`

Standarden skal være sterk for primitives, men romslig for domeneunik komposisjon.

---

## Risikoer og mottiltak

### Risiko 1 — For fleksible primitives

Hvis primitives får for mange props, vil de bli vanskelige å forstå og routes vil gå tilbake til rå markup.

**Mottiltak:** Hold første versjon opinionated og smal.

### Risiko 2 — Halv migrasjon

Hvis `AppPage` og `PageHeader` finnes, men routes fortsatt eier sine egne containere og page headers, uteblir effekten.

**Mottiltak:** Migrer ansvar, ikke bare markup.

### Risiko 3 — Lokale overstyringer spiser gevinsten

Hvis primitives restyles lokalt i mange ruter, får dere bare et skinn av standardisering.

**Mottiltak:** Tillat lokal styling kun for faktisk domenebehov.

### Risiko 4 — Ingen eksplisitt agentregel

Selv gode primitives hjelper mindre hvis agentene ikke vet at de skal brukes som default.

**Mottiltak:** Oppdater repo-instrukser når primitive-laget er klart.

---

## Første anbefalte leveranser

### Leveranse 1

- Etablere `AppPage`
- Etablere `PageHeader`
- Etablere `Button`, `IconButton`, `Input`, `SectionCard`
- Migrere 2–3 representative ad hoc-sider
- Validere primitives mot `HomeScreen`, `Ukeplan` og `ThemePage` uten å tvinge gjennom bred refaktor der

### Leveranse 2

- Etablere `Textarea`, `Chip`, `FormField`, `EmptyState`
- Migrere settings-familien bredt

### Leveranse 3

- Etablere `List`, `ListItem` eller `RecordRow`
- Migrere economics, goals og notifications

### Leveranse 4

- Migrere chat primitives og relevante samtaleflater
- Rydde ut gamle patterns
- Oppdatere `/design` og dokumentasjon

---

## Fremdriftslogg

Bruk denne seksjonen til å oppdatere faktisk progresjon under arbeidet.

### 2026-04-22

- Opprettet migrasjonsplan
- Dokumentert målbilde, faser, komponentliste og prioriterte route-familier
- Definert `HomeScreen`, `Ukeplan` og `ThemePage` som referanseflater for videre migrasjon
- Flyttet varslinger fra `/notifications` til `/settings/notifications` med redirect fra gammel URL
- Startet leveranse 1 med første primitives: `AppPage`, `PageHeader`, `Button`, `IconButton`, `Input`, `SectionCard`
- Migrert `src/routes/settings/external-apps/+page.svelte` til nytt primitive-lag
- Migrert page shell og header på `src/routes/settings/notifications/+page.svelte` til `AppPage` og `PageHeader`
- Migrert page shell og header på `src/routes/settings/+page.svelte` til `AppPage` og `PageHeader`
- Migrert page shell og header på `src/routes/settings/sources/+page.svelte` til `AppPage` og `PageHeader`
- Migrert page shell og header på `src/routes/settings/tracking/+page.svelte` til `AppPage` og `PageHeader`
- Migrert page shell og header på `src/routes/settings/jobs/+page.svelte` til `AppPage` og `PageHeader`
- Migrert page shell og header på klassifiseringssider: `settings/classification`, `settings/classification/rules`, `settings/classification/transaction-rules`, `settings/classification/merchants`
- Migrert page shell og header på `src/routes/goals/+page.svelte` til `AppPage` og `PageHeader`

### Neste oppdatering

- Validere første primitive-sett mot flere settings-sider
- Migrere neste representative route-side med høy drift og lav risiko
- Stramme inn `AppPage` og `PageHeader` etter erfaring fra første migrering
