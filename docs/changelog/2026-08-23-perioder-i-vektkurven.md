# Perioder i vektkurven: topper, bunner og strekkene mellom

Dato: 2026-08-23
Status: ferdig

## Kontekst

Milepælen på Vekt-flaten sa «Ned 1,8 kg på 365 dager — den bratteste
365-dagersperioden siden 28. mai 2025». Brukeren kalte den slapp, og hadde rett:
nedgangen begynte i april og økte i tempo utover sommeren, så det ekte tallet var
nesten seks kilo. Årsvinduet blandet inn oppgangen som lå foran nedgangen, og
gjennomsnittet av tre retninger er ikke en beskrivelse av noen av dem.

Faste vinduer (30/90/180/365 dager) er valgt med vilje — skanner man alle
vinduslengder etter det største fallet, finner man alltid noe, og svaret blir
«største 3-dagersfall», altså væsketap. Men prisen er at vinduet starter et
vilkårlig antall dager tilbake.

Halve løsningen fantes alt: `weight-declines.ts` avgrenset nedgangsperioder
topp-til-bunn på trenden, med toleranse for tilbakeslag. Den var bare **usynlig
for brukeren** — eneste kaller var `query_weight` med `queryType: 'declines'`, og
den kjente ikke oppganger.

## Faser

### Fase 1: Én motor for begge retninger

`$lib/domain/health/weight-swings.ts` er avgrensingen generalisert:
`findWeightSwings` gir periodene kronologisk med `direction: 'ned' | 'opp'`,
endring, varighet, tempo i kg/uke og kg/måned, og lengste hull uten veiing inne i
perioden.

`weight-declines.ts` er nå et **utsnitt** av den — nedgangene, med feltnavnene
chat-verktøyet alt brukte. Ikke to motorer: flaten skulle vise de samme periodene,
og to motorer som leter etter «en nedgang» i samme kurve blir aldri enige. Da sier
chatten ett tall og skjermen et annet, og begge ser plausible ut.

To terskler med to jobber, og de må være ulike tall:
`REBOUND_TOLERANCE_KG` (1 kg) avgjør **strukturen** — når en periode er over —
mens `MIN_SWING_KG` (2 kg) og `MIN_SWING_DAYS` (21) avgjør hva som er verdt å
**vise**. En struktur-terskel på 2 kg ville slått sammen perioder som gikk motsatt
vei; en visningsterskel på 1 kg ville fylt lista med væske.

Nytt i avgrensingen: **et platå i ytterpunktet tilhører ingen av periodene.**
Perioden slutter på FØRSTE punkt med ytterverdien og den neste starter på det
SISTE, så en flat uke i bunnen ikke trekker tempoet i nedgangen ned. Det er den
samme utvanningen faste vinduer lider av, i miniatyr. Konsekvensen er synlig i
`weight-declines.test.ts`: en fixture med to dager på 99 gir nå 28 dager, ikke 29.

### Fase 2: Den pågående perioden som milepæl

Ny milepæl `current-swing`, rangert **over** `largest-drop`:

> Ned 5,9 kg siden toppen 14. april 2026 — 1,4 kg i måneden over 4 måneder. Den
> største sammenhengende nedgangen vi har målt. Siste 30 dager: 2,1 kg i måneden,
> altså raskere.

Setningen bygges i domenelaget (`describeCurrentSwing`) og bærer forbeholdene
sine selv:

- **`recentPace`** nevnes bare når de siste 30 dagene avviker minst
  `PACE_SHIFT_KG_PER_MONTH` (0,5) fra snittet, og bare når perioden er minst 60
  dager. Uten lengdekravet sammenlignes perioden med seg selv, og «raskere nå»
  blir en avrundingsfeil med selvtillit.
- **`retraceKg`** sier at ytterpunktet ligger bak oss: «Bunnen var 12. august;
  siden har trenden steget 0,4 kg». Terskelen (`MIN_RETRACE_KG` = 0,3) **må** ligge
  under vendeterskelen, ellers er feltet dødt kode — et tilbakeslag på et helt kilo
  har alt avsluttet perioden. Første utgave brukte `MIN_SWING_KG / 2`, altså
  nøyaktig vendeterskelen, og en bunn tre uker tilbake ble presentert som «faller
  fortsatt».
- **Muskeltap avlyser feiringen**, samme kvalifisering som det faste vinduet får.

To retellinger undertrykkes, fordi to bulletter om samme hendelse leses som to
hendelser — og den svakeste låner troverdighet fra den sterkeste:

- `largest-drop` vikes for en pågående **nedgang**. En pågående **oppgang** er en
  annen historie enn et fall over året, og da får begge stå: «opp 2 kg siden juni,
  men fortsatt ned 4 kg på et år».
- `above-nadir` vikes når en pågående oppgang starter PÅ historikkens lavpunkt —
  da er «3 kg over lavpunktet» og «opp 3 kg siden bunnen» samme setning.

### Fase 3: Flaten viser periodene

`WeightPeriodsCard` står rett under grafen: radene er lesningen av kurven man
nettopp så. Hver rad har retning (pil og ord, aldri farge alene — en oppgang er
ikke en fiasko), endring, datospenn, varighet og snittempo. Den pågående får
merket «pågår», men bare når ytterpunktet er ferskere enn `SWING_FRESH_DAYS` (7):
«pågår» om noe som flatet ut i juli er en påstand om i dag som ikke stemmer.

De samme vendepunktene markeres som ringer i `WeightTrendChart`, med et
legende-innslag. Uten dem må leseren holde datoene i hodet mens hen blar mellom
graf og liste. Markeringer nær lavpunktsringen eller sluttpunktet dropper vi — to
ringer oppå hverandre gjør begge vanskeligere å lese.

Notisen under lista sier at den har **hull**: bevegelser under terskelen er utelatt,
så mellom to rader kan det ligge bevegelse som ikke nådde 2 kg. En liste som ser
komplett ut men ikke er det, er verre enn en med et forbehold.

### Fase 4: Chatten svarer på det samme

`query_weight` sin `queryType: 'declines'` er erstattet av `'periods'`: begge
retninger, den pågående perioden, og den ferdig formulerte setningen om den.
Nedgangs-statistikken (største/raskeste/lengste, vektet snittempo) står ved siden
av — «hvor fort klarte jeg det sist» er et annet spørsmål enn «hva har skjedd».

Ordene måtte også inn i `detectPromptFocusModules`: «hvor mye har jeg gått ned
siden april» inneholder ikke ordet «vekt» og traff ingen modul, så modellen visste
ikke at `query_weight` fantes og svarte på siste enkeltmåling i stedet. Lagt til:
`nedgang`, `oppgang`, `gikk/gått ned`, `\bkilo\b` (ordgrensa holder «kilometer»
utenfor).

## Beslutninger

- **Kurven bestemmer grensene, ikke et søk etter det beste vinduet.** Fritt søk
  etter det største fallet finner alltid noe; topp-til-bunn er avgrenset av data.
- **De faste vinduene beholdes.** De svarer på et annet spørsmål («er dette bratt
  sammenlignet med før?») og er den eneste formen som kan sammenlignes med
  ikke-overlappende historikk.
- **Ett vokabular.** Datoer, spenn og kilotall flyttet til `weight-text.ts` og deles
  av milepælene og periodene. «12. mars 2025» ett sted og «12.3.2025» et annet
  leses som to kilder, og en av dem ser mindre til å stole på ut.
- **Retningen fargelegges ikke.** Flaten vet ikke om en oppgang er et problem, og
  fargekoding ville moralisert over et tall brukeren ikke styrer fra dag til dag.

## Verifisering

- `npm test` — 3701 grønne. Nye: `weight-swings.test.ts` (22), periode-testene i
  `weight-milestones.test.ts` og `weight-summary.test.ts`, og fokusord-testene.
- `npm run check` — 0 feil, 0 advarsler.
- `/design`-galleriet rendret i Chromium på 390 px: periodekortet viser tre rader
  (ned/opp/ned) med «pågår» på den øverste, og grafen viser vendepunktringene med
  legende. Mock-serien `weightDaysSwinging` er regnet av den ekte motoren, ikke
  håndskrevet — en mock som går rundt tersklene viser noe annet enn flaten.
- **Piksel-baselines er ikke oppdatert:** `dashboardkort`-seksjonen og Vekt-flaten
  har endret seg, og `npm run test:visual:update` krever databasetilgang som ikke
  fantes i miljøet endringen ble skrevet i.
