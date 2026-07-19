# Kategori-tak i økonomi: forbruksmål per kategori + budsjettpress-signal

Dato: 2026-07-19
Status: ferdig (dev-verifisering gjenstår)

## Kontekst

Fra signal-idémyldringen: økonomi hadde bare `grocery_spend` og `monthly_savings`
som målbare metrikker, mens taksonomien har 18 kategorier. Nå kan man sette
forbrukstak på hvilken som helst kategori (kafé, medier, barn, reise, klær…) —
og få et signal når man ligger an til å sprenge taket.

## Faser

### Fase 1: `category_spend`-metrikk

Én metrikk som dekker alle kategorier — kategorien bæres i
`goals.metadata.spendCategory` (ikke én MetricId per kategori). `lower_is_better`,
forbrukstak-semantikk (at_most). Oppføringer i alle tre viz-Records
(metric-catalog, metric-visualizations, visualization-spec).

### Fase 2: Leser + visning

- `readCategorySpend(userId, category)` i goal-progress.ts: forbruk hittil i
  inneværende kalendermåned + snitt over de tre foregående hele månedene som
  kontekst. Returnerer null uten transaksjoner.
- Mal-loaderen: category_spend faller inn i den generiske `metricEval`-stien fra
  trening&kropp-arbeidet — hver distinkt kategori leses maks én gang, sone-bar via
  `buildMetricGoalEval` (at_most). Kontekstlinje «3-mnd snitt: 1 850 kr/mnd».
- `formatLongTermValue` formaterer category_spend (og alt med unit=kr) som kroner
  med tusenskille.

### Fase 3: Skapeflate (chat)

Kategori-tak er månedlige forbruksmål, ikke årsbundne visjoner — de går via
`create_goal`-verktøyet (chat + assistent), ikke Retning-fanens preset-form.
Verktøyet fikk `spendCategory`-parameter + kategoriliste i beskrivelsen;
`createGoal` lagrer den i metadata kun når metricId=category_spend.
«Sett et tak på 2000 kr/mnd på kafé» → mål med sone-bar på Mål-fanen.

### Fase 4: Signal `category_budget_pressure_<kategori>`

For hvert aktivt category_spend-mål framskrives månedsforbruket lineært etter
dag-i-måneden (`projectBudget`, testet): «800 av 2000 på kafé, men bare 10 dager
inn → ligger an til 2400». Over taket = high, på vei over = medium, nær grensen
(≥85 %) = low. Dynamisk signalType per kategori (kontrakt registreres per type,
som `tracking_series_activity_pr_week`). Confidence 0.5 før dag 7 (for tidlig å
framskrive), 0.85 etter.

## Beslutninger

- **Én metrikk med kategori i metadata**, ikke 18 MetricIds — holder katalogen
  ren og gjør leseren generisk.
- **Inneværende måned-til-dato, ikke rullerende 30 dager** — matcher hvordan folk
  tenker på budsjett («denne måneden»), og pace-projeksjonen blir meningsfull.
- **Chat-only opprettelse** — kategori-tak er ikke femårsvisjoner; å presse dem inn
  i Retning-formen ville vært feil modell.
- **Signal per kategori** — lar tema-dashboards abonnere på akkurat de kategoriene
  brukeren har tak på, uten å drukne i resten.

## Verifisering

- `npm test`: 1515 grønne (nye: projectBudget + classifyBudgetPressure). `npm run
  check`: 0 feil.
- Dev: «tak på 1500 kr/mnd på kafé og restaurant» i chat → category_spend-mål med
  at_most-sone på Mål-fanen (nåverdi = forbruk hittil, kontekst = 3-mnd snitt);
  etter cron: `category_budget_pressure_kafe_og_restaurant`-rad med framskrivning.
