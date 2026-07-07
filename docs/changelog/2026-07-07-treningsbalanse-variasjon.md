# Treningsbalanse og variasjon: det tredje hodet

Dato: 2026-07-07
Status: planlagt

## Kontekst

Treningsløp-refaktoreringen (`2026-07-05-treningslop.md`) etablerte
registrering-først med to uavhengige progresjonsløp (styrke + utholdenhet) og
et effort-budsjett forankret i forrige ukes faktiske innsats.
Effort/vekt-modellen (`2026-07-05-effort-vektterskel.md`) koblet samlet effort
til vektutvikling. Til sammen svarer de allerede på det meste av en fler-hodet,
målbasert treningsstrategi: *forslag som oppdateres kontinuerlig fra faktiske
registreringer, ikke en fast plan.*

Brukerinnsikt (7. juli) legger til en tredje dimensjon systemet i dag ikke har:
**balanse og variasjon som noe eget som måles og belønnes.** Ønsket er å

- utnytte kjente ruter for variert trening (pendlerunde rolig/tempo/intervall,
  vannrunden, bakkeintervaller, sti, flat bane for tester),
- progressiv styrke (armhevinger, pull-up, planke) med enkel registrering,
- stimulere til *variert* innsats på tvers av disipliner (styrke, løp, sykkel,
  el-sykkel, fotball, svømming) og **belønne det som faktisk blir gjort**,
- bygge bærekraftige vaner, forebygge skader og bevare nivå gjennom
  sesongskifter og ferier.

### Hva som allerede finnes (ikke bygg på nytt)

- **Styrkeprogresjon + registrering**: `strength-engine.ts` beregner neste
  target fra faktiske økter (`min(mål, max(kurve, beste-av-siste-2 + delta))`),
  stall-rebase, fasebasert pull-up. Ekko skriver `sensor_events`
  (`dataType:'strength_workout'`, `exercises[].sets[].reps`); motoren leser rå
  events. Målene ligger som stående targets på dager uten løp (adapteren).
- **Motbakkeintervaller**: `routes.ts` `kind:'hill'`, `reps × repDistanceMeters`,
  intensitetsjustert effort, seedet 6×/10×200 m.
- **Effort på tvers → vekt**: OLS + kvantil-bins + vindu-skanning + effort↔kcal
  (effort-vektterskel-prosjektet).
- **Skadeforebygging (grunnmur)**: akutt/kronisk-ratio (>1.5 → hviledag) i
  `effort-budget.ts`.
- **Belønning (grunnmur)**: auto-kobling viser registrerte økter som
  gjennomført, stablet budsjettgraf, ukesprognose.

### Hva som mangler (denne planen)

1. **Variasjon/balanse er ikke et signal.** Effort-budsjettet belønner *total*
   effort — blindt for om det er fem like tredemølleturer eller en balansert
   miks styrke/løp/sykkel og ulike ruter.
2. **Sti coaches som vei.** `variantEffort` skårer distansebaserte løp på pace;
   på teknisk sti er lav fart ikke lav innsats, og høydemeter (`elevationMeters`,
   allerede en kolonne) ignoreres. Trenger tid+høydemeter-drevet effort og
   «kjør på følelse»-språk.
3. **Ikke-GPS-disipliner har ingen rask logge-vei** i Ekko, og **fotball**
   mangler egen effort-family (havner i `other` = 0.5 MET og underskåres).

## Faser

### Fase 1: Balanse-signalet (størst gevinst, rent Resonans-server)

Mål: gjør balanse/variasjon til noe som måles, vises og *belønnes* — ikke bare
total effort.

- Ny ren modul `src/lib/server/tracks/balance.ts` (mønster som
  `effort-budget.ts`: injiserte data, ingen DB): tar siste ~4 ukers
  `EnduranceWorkout[]` + styrkeøkter og beregner en **balanse-tilstand**:
  - disiplin-miks (andel effort per family: løp / sykkel / el-sykkel / styrke /
    annet),
  - styrke-vs-utholdenhet-dekning denne uka (antall styrkeøkter mot et enkelt
    ukemål, f.eks. 2),
  - rute-rotasjon (siste N økter fordelt på ruter fra biblioteket — flagg når
    samme rute dominerer),
  - intensitetsfordeling (andel rolig/moderat/hard fra pace-band —
    polarisering, ikke alt i grå sone).
- **Én balanse-nudge om gangen**, valgt etter største avvik:
  «3 løp, 0 styrke denne uka — ta en kort styrkeøkt», «Samme rute 5×, prøv
  vannrunden», «Alt i moderat sone — legg inn en rolig eller en hard».
- **Belønning av variasjon**: mindre variasjons-tillegg til øktforslaget når en
  underbrukt disiplin/rute velges (påvirker *forslaget*, ikke effort-skåringen —
  den holdes ærlig/fysiologisk). Konkret: `pickBoostSuggestion`/`composeWeekRecipe`
  vekter mot det underbrukte hodet ved likt effort-bidrag.
- Signal `training_balance` via eksisterende domain-signals-cron (samme mønster
  som `health_effort_vs_threshold`): valueNumber = enkel balanse-score,
  detaljer i context jsonb — ingen schema-endring.
- UI: `BalanceCard` på /trening (miks-donut + nudge) og evt. hjem-widget
  (`trainingBalance`, generisk DynamicWidget-path som effortBalance).

### Fase 2: Sti- og høydemeter-bevisst effort + coaching

Mål: sti får sin egen modell og stemme, ikke pace-logikken fra vei.

- `routes.ts`: la `elevationMeters` bidra til effort for `kind:'trail'` og
  distansebaserte løp med høyde (vertikal-tillegg, ikke pace-intensitet).
  Trail-variant skåres på tid + høydemeter + terreng, med lavere pace-vekt.
- `effort-service.ts` / `met_pace`: for trail-family, demp pace-intensiteten
  (sakte ≠ lett) og bruk varighet/HR som primær driver når puls finnes.
- Coaching-språk i øktforslag for sti: «kjør på følelse, hold jevn innsats i
  motbakke, ikke jag klokka». Testruter (flat bane) beholder pace/tempo-stilen.

### Fase 3: Per-disiplin-logging + fotball-family

Mål: alle disiplinene brukeren lister blir enkle å registrere og skårer riktig.

- **Resonans-server**: legg `football` (og evt. `ballsport`) i
  `MET_FACTOR_BY_FAMILY` med en kalibrert vekt; utvid `normalizeSportType` og
  taxonomy. Additiv — ingen re-projeksjon nødvendig med mindre miksen domineres
  av den nye familien (jf. effort-vektterskel-beslutningen om MET-endringer).
- **Ekko (resonans-lab)**: rask tell-og-tapp-logging for ikke-GPS-økter
  (armhevinger/planke/fotball/basseng) som skriver `sensor_events` via
  `/api/apps/upload` eller et lettvekts strength-endepunkt — server-kontrakten
  finnes allerede (`dataType:'strength_workout'`, `exercises[]`). Egen økt,
  koordineres når begge repo er åpne.

### Fase 4 (grunnmur, mindre): ferie/gjenopptrapping

- **Vedlikeholdsmodus** i effort-budsjettet ved aktivt `trip`-signal: senk
  gulvet, ikke straff en lett uke.
- **Gjenopptrapping** etter opphold: styrke-/utholdenhetskurven ramper opp fra
  faktisk nivå etter en pause i stedet for å marsjere videre.

## Beslutninger

- **Balanse påvirker forslag, ikke skåring.** Effort_score forblir ærlig og
  fysiologisk (MET/TRIMP). Variasjon belønnes ved å *vri forslaget* mot
  underbrukte hoder, aldri ved å blåse opp poeng — samme prinsipp som
  «ærlig statistikk, ikke presisjonsteater» i effort/vekt-modellen.
- **Én nudge om gangen.** Balanse-kortet sier én ting (største avvik), ikke en
  sjekkliste — konsistent med readiness/effort-budsjett-tonen.
- **Sti er en egen modell, ikke en pace-variant.** Høydemeter og tid driver
  effort; pace nedvektes. Testruter beholder pace-stilen.
- **Additive familier, ingen MET-omkalibrering av eksisterende.** Fotball legges
  til; eksisterende vekter røres ikke (unngår inkonsistent historikk-fit).
- **Rekkefølge: balanse først.** Størst gevinst for fler-hodet-strategien og
  rent server-arbeid; sti og logging bygger videre.

## Verifisering

- Vitest for `balance.ts`: syntetiske ukesmikser → forventet nudge og score
  (kun-løp → styrke-nudge; rotasjon; polarisert vs grå sone). Trail-effort:
  høydemeter øker effort, sakte sti ikke underskåret.
- `GET /api/cron/domain-signals` + signal-observability for `training_balance`.
- Visuell review av /trening etter `BalanceCard` er montert
  (`VISUAL_REVIEW_CONTEXT`).
- Kontraktsverifisering av evt. nytt logge-endepunkt med curl
  (`x-resonans-user-id`), uendret Ekko-shape.
