# Apparat-navigasjon og fjerning av /hjem

Dato: 2026-06-09
Status: ferdig

## Kontekst

Apparat-kortene (oppvask/vask/tørk fra "ping") rendres av `HomeDashboard.svelte`, men kortene var ikke klikkbare — eneste vei til apparat-detalj/labeling var via push-notifikasjonens lenke. Brukeren ville kunne åpne apparat-sidene direkte fra kortene.

Underveis kom det fram at `/hjem`-ruten var foreldet: den ble opprettet 9. mai (`ec83bca`) som standalone hus-og-hjem-dashboard, før "Hjem" ble lagt til som tema i det generiske tema-systemet 18. mai (`90514ad`). Tema-systemet (`/tema/[id]` → `ThemeDataTab` → `HomeDashboard`) overtok jobben. Ingenting i UI-et lenket til `/hjem`-siden; brukere når hjem-innholdet via tema-sonen på forsiden. Kun `/hjem/apparat`-underrutene var i aktiv bruk (notifikasjoner + kort-lenker).

## Faser

### Fase 1: Klikkbare apparat-kort
- `HomeDashboard.svelte`: apparat-kortene gjort om fra `<div>` til `<button>`, ny `onOpenAppliance`-prop og `applianceHref(a)`-logikk: kjørende syklus → detaljsiden (`/apparat?cycle=…&appliance=…`, henter `cycle_id` fra `recentEvents`), ellers → label-siden (`/apparat/label`). La til hover/focus-styling.
- `/apparat/+page.svelte`: lenke "Merk tidligere sykluser →" til label-siden.

### Fase 2: Wiring i begge monteringspunkter
`HomeDashboard` monteres to steder. Begge sender nå `onOpenAppliance`:
- `src/routes/hjem/+page.svelte` (senere slettet, se fase 3)
- `src/lib/components/domain/theme/ThemeDataTab.svelte:546` — dette var det reelle bruksstedet (brukeren var på Hjem-temaets Data-fane). Manglende wiring her gjorde at klikk var no-op.

### Fase 3: Fjernet /hjem, flyttet apparat-ruter
- Slettet `src/routes/hjem/+page.svelte` + `+page.server.ts` (foreldet dashboard).
- Flyttet med `git mv`:
  - `hjem/apparat/` → `apparat/`
  - `hjem/apparat/label/` → `apparat/label/`
- Oppdaterte alle lenker fra `/hjem/apparat*` → `/apparat*`:
  - `HomeDashboard.svelte` (`applianceHref`)
  - `ping-notifications.ts` (push-lenker, 2 steder)
  - apparat-sidens `titleHref` → `/`, label-sidens `titleHref` → `/apparat`
  - 4 `redirect(302, '/hjem')` i `apparat/+page.server.ts` → `redirect(302, '/')`

### Fase 4: Restyling av apparat-widgetene
Kortene var "veldig hvite" på tema-siden. Årsak: hele `HomeDashboard.svelte` brukte ikke-eksisterende CSS-variabler (`--surface`, `--border`, `--accent`, `--muted`, `--success`) med *lyse* fallbacks — disse finnes ikke i `AppPage`, så de falt tilbake til hvitt/lyst. Til og med `.badge` hadde hardkodet `#f0f0f0`.
- Byttet alle til de faktiske mørke variablene fra `AppPage`: `--bg-card`, `--border-color`, `--accent-primary`, `--text-secondary`/`--text-tertiary`, `--success-text`/`--success-border`, `--bg-hover`.
- Byttet visuell modell for kjørende sykluser: `ApplianceCycleChart` (spiket watt-kurve) → `AnimatedProgressBar` (progresjon-mot-mål, `pct = elapsedMinutes/totalMinutes`, accent-tone) — mer i tråd med resten av appen. Chart-komponenten beholdes i `visualizations/` men brukes ikke lenger.

## Beslutninger

- **Topp-nivå `/apparat` framfor `/tema/[id]/apparat`:** Apparat-sidene er en frittstående utility nådd fra både notifikasjoner og tema-fanen. De trenger ikke tema-kontekst, så de ligger på topp-nivå uten kobling til en tema-id.
- **Ingen redirect fra `/hjem`:** Siden var ulenket og ikke bokmerkbar i praksis; `/hjem` gir nå 404. Underrutene lever videre under `/apparat`.

## Verifisering

- `npm run check`: 0 feil
- `npm test`: 334/334 passerer
- Playwright (auth-bypass mot dev-server):
  - Tema-Data-fane → klikk oppvaskmaskin → navigerer til `/apparat?cycle=…&appliance=Oppvaskmaskin`
  - `/apparat/label` laster (tittel "Label apparater"), ingen redirect
  - `GET /hjem` → 404
