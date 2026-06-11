# /design som levende dokumentasjon

Dato: 2026-06-10
Status: ferdig

## Kontekst

`/design` hadde vokst til 3900 linjer med en blanding av ekte komponent-demoer og håndbygde mockups (hjemskjerm-soner, interaksjonsflyter, ukeplan-ukeskort, sjekkliste-SVG-er, kavalkade, widget-konfigurator). Mye var «gode intensjoner» som aldri ble implementert, mens komponentene som faktisk bærer appen (TriageCard, ChecklistWidget, dashboard-kortene) ikke var dokumentert der i det hele tatt. Siden var også brukket: 8 typefeil pga. manglende imports og feil StatusBadge-toner.

Nytt prinsipp (fra bruker): `/design` skal fungere som Storybook — **live komponenter med mock-data**, slik at man kan se states og funksjoner, utvikle komponenter der før de tas inn i appen, og på sikt re-skinne hele appen via tokens (f.eks. light mode).

## Faser

### Fase 1: Kartlegging
Grep-basert audit av faktisk komponentbruk utenfor `/design`:
- **Kun på /design / døde**: ChatBubble, StreakBadge, RelationSparkline, DomainWheelChart, StatusBadge, MorphTitle + composed WorkoutStreakCard, TaskList, GoalCard, EgenfrekvensQuickCard.
  *(Korrigert 2026-06-11: auditen stemplet også MentionText, LocationPickerModal og ChecklistSheetHeader/Footer/Payoff som døde — det var feil; de brukes via relative imports i TaskTitle og ChecklistSheet.)*
- **I appen men udokumentert**: TriageCard, ChecklistWidget, ProjectCard, ScreenTimeCard, BalanceCard, FormCard, WeeklyEffortCard, Skeleton, IconButton, WeekGoals.
- Tokens: fargetokens godt dekket (–text-secondary 239 treff), typografi-/spacing-tokens knapt brukt ennå.

### Fase 2: Ombygging av /design (3921 → ~1560 linjer)
- **Nye live-seksjoner**: Ringer & widgets (GoalRing + ChecklistWidget i 4 tilstander + DayWheelChart), Dashboard-kort (WeeklyEffortCard, BalanceCard + FormCard på delt TrainingLoadPoint-serie, ScreenTimeCard full variant, ProjectCard active/done), Chat (TriageCard i alle 4 tilstander: loading m/steg, streaming, ferdig m/actions, avbrutt + ChatInput), Skjema (Input/Textarea/Select/Checkbox/StatusBadge med korrekte toner ok/warn/error/off), Layout (+ Skeleton-varianter), Ukeplan (WeekGoals live med sensor-fremdrift).
- **Knapper**: byttet fra rå `.btn-*`-klasser til live `<Button>`/`<IconButton>`.
- **Fjernet** (gjenskapt markup / uimplementerte konsepter): Hjemskjerm-layoutalternativer + v2/v3-prototyper, Interaksjonsflyter (3 soneflyter, widget-opprettelsesflyt, fullskjerm-konfigurator, animasjonsnotater), ukeplan-mockups (periodestige, ukeskort, todo-widget, planleggingsflyter, kavalkade, CTA-varianter), sjekkliste-flytens håndbygde SVG-er. Alt ligger i git-historikken (commit d765ab4 og tidligere) om konseptene trengs igjen.
- **Ny «Lab»-seksjon** nederst: komponenter som ikke er i appen ennå (StreakBadge, RelationSparkline, ChatBubble, DomainWheelChart) tydelig merket, + liste over ui-eksporter som mangler demo.
- Beholdt: Designprinsipper, Typografi, Blokktyper, Ikoner & tema-hue (hue-laben er reskin-forløperen).
- Mock-data er deterministisk (faste datoer, beregnede serier) så piksel-diff er stabil.

### Fase 3: Dokumentasjon
- `docs/DESIGN.md`: ny seksjon «/design — levende dokumentasjon» med reglene (live komponenter, deterministisk mock-data, Lab-kontrakten, demo i samme PR som ny komponent). Komponentlag-eksempler oppdatert til reelle komponenter.
- Stale notat om ScreenTitle i refaktorerings-changeloggen lukket.

## Beslutninger

- **Live komponenter > gjenskapt markup**: en demo som ikke importerer den ekte komponenten er verdiløs som dokumentasjon og råtner stille.
- **Lab-seksjon i stedet for sletting**: design-only-komponentene (StreakBadge m.fl.) beholdes som inkubasjon, men tydelig merket «ikke i appen ennå» — siden skal aldri lyve om hva som er i produksjon.
- **Store/DB-koblede komponenter demonstreres ikke**: DaySection, WeekTasks, WeekNote og DynamicWidget henvises til siden de brukes på i stedet for å mockes tungt.
- **Reskin-retning**: FeatureCard-/token-override-mønsteret + hue-laben er mekanismen for fremtidig light mode; `/design`-demoene leser tokens fra AppPage (lokale token-overrides på `.page` fjernet).

## Verifisering

- `svelte-check`: 0 feil (var 8 på design-siden før ombyggingen).
- 397 enhetstester grønne.
- `npm run test:visual:review`: alle 13 sider godkjent — design-endringen (56,7 % diff) vurdert i tråd med intensjonen, øvrige sider uendret/kun dynamiske data.
- Piksel-baselines oppdatert, `npm run test:visual` grønn (5/5).
