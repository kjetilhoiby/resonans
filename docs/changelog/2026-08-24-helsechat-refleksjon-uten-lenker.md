# Helsechatten svarte som et venterom

Dato: 2026-08-24
Status: ferdig

## Kontekst

Brukeren satt i Samtaler på Helse-temaet og reflekterte over en avgjørende fase i
treningsåret sitt:

> «Det som ofte skjer er at jeg har en seig start på våren, får god progresjon fra
> juli-august og frem til september eller oktober, og deretter faller tilbake og får
> en ny seig vår året etter. Hvis jeg kunne bevart 'spruten' i beina gjennom vinteren
> hadde det vært lettere å bygge videre. Hvordan ser en april der jeg har løpt minst
> et kvarter seks av sju dager siste halvår ut sammenliknet med når jeg har tre
> skiturer og ti halv-lange, trege løp i samme periode?»

Svaret var to symmetriske punktlister med de samme fire rubrikkene under hvert
alternativ (Kondisjon / Skaderisiko / Mentalitet / Fleksibilitet), en
«Konklusjon»-overskrift, «Er det noe mer spesifikt du vil utforske i planen din?»,
tre sjablongbilder av løpere og seks lenker — blant dem *4 Running Workouts to Stay
in Shape This Winter* og en nettbutikk for kinesiologiteip.

Ikke ett tall fra brukerens egne ni år med økter. Brukerens egen beskrivelse: «litt
som å sitte på venterommet hos legen».

Fire uavhengige feil traff samtidig, og hver av dem er nok alene.

## Faser

### Fase 1: Aktivitetsordene manglet i helse-rutingen

`detectPromptFocusModules` (`src/lib/server/openai.ts`) hadde ikke ETT av ordene
brukeren skrev: hverken «løp», «skitur», «sykkel», «intervall», «puls» eller
«økter». Ordet «trening» brukte brukeren ikke. Meldingen ruta derfor til
`domains: ['general']` — uten helse-blokka finnes ikke `query_training`,
`query_weight`, `query_sleep` eller retningslinjene for helsetall for modellen i det
hele tatt.

Dette er samme felle som CLAUDE.md alt advarer mot for «belastning», «pulsfall»,
«restitusjon» og «effort», én runde senere. Lagt til:
`\bløp`, `\bskitur`, `\bsykl`, `\bsykkel`, `\bintervall`, `treningsøkt`,
`\bøkter\b`, `\bøkta\b`, `\bpuls`, `\bmaraton`, `\bkondis`, `\butholden`.

To bevisste utelatelser, begge testet:
- **`\bl[øo]p` er ikke brukt** — o-varianten treffer «loppemarked».
- **`\bøkt` er ikke brukt** — «økt» er også partisipp av «øke» («forbruket har
  økt»), og ville dratt helse-blokka inn i økonomi-samtaler. «økter»/«økta» er
  entydige substantiv.

### Fase 2: En løs regex tvang websøk på brukerens egne data

`chat-router.ts` hadde en *andre*, løsere nyhets-regex ved siden av
`classifyResearchTopic` — uten ordgrenser — og den avgjorde tvangen alene:

```js
researchTopic === 'news' || /nyhet|…|siste|…|valg|børs|marked|…/.test(text)
```

«siste halvår» traff `siste`. Og tvang er ikke et hint: den låser
`tool_choice` til `web_search`, så det FØRSTE modellen gjorde var å søke på nettet.
Samme regex traff «valgt» på `valg`, «markedet» på `marked` og «aktuelle» på
`aktuell`.

Regexen er slettet — klassifiseringen skal skje ett sted, slik kommentaren over den
allerede hevdet at den gjorde. I tillegg: **spørsmål om brukerens egne data er aldri
et nyhetsspørsmål.** Treffer meldingen health/economics/self/family, tvinges det
ikke websøk, og hintet sier i stedet at egne data skal hentes. Reise beholder
tvangen med vilje — et sted finnes faktisk ute, og en reisesamtale nevner nesten
alltid familie underveis.

### Fase 3: NEWS_RE leste rene tidsord som nyheter

`research-domains.ts` hadde `i dag`, `denne uk[ae]`, `aktuelt` og `oppdatering` i
`NEWS_RE`. Konsekvensen målt: **«hvor mye har jeg sovet denne uka?» var et
nyhetsspørsmål** — `forceWebSearch`, og søket låst til `NEWS_DOMAINS` (nrk.no,
vg.no). Et tidsord sier NÅR, ikke at svaret finnes ute på nettet; brukerens egne
netter er også ferske.

Bar `konflikt` er også ute: «vi har en konflikt hjemme» ble et nyhetssøk mot
aviser. `krig` krever nå «i/mellom» etter seg.

Grensene står nå **per alternativ**, ikke som en felles hale, fordi `\b` er ASCII i
JS: `været nå\b` ville aldri matchet — «å» er ikke et ordtegn, så grensen finnes
ikke der.

### Fase 4: Refleksjon var det samme som å være uten data

Den dypeste feilen. `isConversationalMode` i `routes/api/chat/+server.ts` styrte
tre ting samtidig: modellvalg, token-tak **og om `tools` ble sendt i det hele tatt**.

```js
: isConversationalMode ? {} : { tools, tool_choice: 'auto' }
```

Idet AI-ruteren klassifiserte en melding som `conversation` — altså nettopp når
brukeren sluttet å slå opp og begynte å tenke høyt — mistet coachen tilgangen til
brukerens egne tall. Det er i refleksjonen de betyr mest. En assistent uten dem har
bare generelle råd å gi, og det er hele «venterommet».

Nå går bare de virkelig spesialiserte flatene uten verktøy — bok, film og flyt,
altså de som sender sitt eget systemprompt (`systemPromptPrefix`). Ellers følger
verktøyene med, med `tool_choice: 'auto'`: modellen KAN la dem være, men den kan
velge dem.

### Fase 5: Formen og lenkene

- `prompts/base.ts`: **«Refleksjon er ikke et oppslag»** — punktlister er for ting
  som ER en liste, ingen «Konklusjon»-overskrift, ta stilling framfor to
  symmetriske fordel/ulempe-lister, ikke avslutt med «Er det noe mer spesifikt du
  vil utforske?», og bruk brukerens egne ord («spruten i beina», ikke
  «løpeøkonomi»).
- `prompts/base.ts`: **brukerens egne data slår alltid en artikkel**, og **lenker er
  ikke et svar** — har du søkt, skal funnene være inne i svaret, formulert av deg.
  Mangler du data, si hva som mangler; det er bedre enn råd som ville passet på hvem
  som helst.
- `prompts/domains.ts` (health): **«hvordan har mine år sett ut» er et dataspørsmål,
  ikke et søk.** `query_sensor_data` tar `period='month'|'week'|'year'` med `limit`,
  så flere år bakover kan faktisk sammenlignes. Sjekk premisset brukeren selv la
  («seig vår, god progresjon i juli–august») mot tallene, og si det hvis det ikke
  stemmer.
- `chat/+server.ts`: **bilder bare for steds-treff** (`includeImages: scope.topic
  === 'travel'`), av samme grunn som kartet alt var begrenset slik i changelog
  2026-07-23. Tre sjablongbilder av løpere over et svar om brukerens egne vintre er
  pynt, og pynt gjør et tynt svar tynnere.

## Beslutninger

- **Klassifiseringen bor ett sted.** Den løse regexen ble slettet framfor strammet
  inn. To steder som bestemmer «er dette et nyhetsspørsmål» blir aldri enige, og
  kommentaren over dem hevdet alt at det bare var ett.
- **Reise beholder tvangen, nyheter mister den på personlige domener.** Skillet er
  om svaret KAN finnes ute: et sted kan det, brukerens aprilmåneder kan det ikke.
- **Verktøy i refleksjonsmodus, men `tool_choice: 'auto'`.** Alternativet — å tvinge
  et dataoppslag — ville byttet én tvang for en annen. Modellen skal kunne svare
  uten oppslag når spørsmålet ikke har et tall i seg.
- **Innsnevringen av tvangen er bevisst, og web_search er ikke fjernet.** Ordene
  `politikk`, `iran`, `ukraina`, `gaza` og `marked` tvinger ikke lenger søk alene
  («hva skjer i Ukraina» gjør det fortsatt, via `hva skjer i`). Tvang handler bare
  om å garantere det FØRSTE verktøykallet; verktøyet ligger uansett i `tools` med
  `tool_choice: 'auto'`, og BASE_PROMPT ber modellen søke om ferske hendelser. En
  tvang som slår inn på feil spørsmål koster hele svaret, mens et hint som slår inn
  for sjelden koster ett tapt søk.
- **Ingen ny prompt-flate.** Formregelen hører i BASE_PROMPT, ikke i helse-blokka:
  den samme punktliste-refleksen ville truffet en karriere- eller
  samlivsrefleksjon like hardt.
- **En stale testforventning ble rettet, ikke omgått.**
  `prompt-focus-modules.test.ts` slo fast at «hvor mange kilometer løp jeg i juli»
  IKKE skulle treffe health. Invarianten testen ville verne (`\bkilo\b` mot
  «kilometer») er riktig; eksempelet var feil, og at meldingen falt utenfor var
  nettopp feilen. Eksempelet er byttet til «vi kjørte 40 kilometer til hytta», og
  den positive retningen har fått en egen test.

## Verifisering

- `npm test`: 3765 tester grønne (268 filer), 11 nye — refleksjonsmeldingen ordrett
  som regresjonstest, tidsord i dataspørsmål, konflikt hjemme, aktivitetsordene inn
  til health, og de to bevisste utelatelsene («forbruket har økt», «loppemarked»).
- `npm run check`: 0 errors, 0 warnings.
- Ingen `.svelte`-filer endret, så visuelle baselines er urørt.
- Ikke verifisert i prod: at modellen faktisk henter flere år med
  `query_sensor_data` på dette spørsmålet. Verktøyet finnes og helse-blokka er nå på
  plass, men rekkevidden av et enkelt `period='month'`-oppslag mot spørsmålet
  «april etter en tett vinter» er ikke målt. Se under.

## Kjent rest

- **Ingen av dashboard-lasterne har et historisk vindu.** `query_training`,
  `query_weight`, `query_sleep` og `query_egenfrekvens` svarer alle på NÅ.
  Sammenligningen «april etter en tett vinter mot april etter en tom vinter» må
  derfor bygges av modellen fra `query_sensor_data`-rader. Et eget
  sesong/periode-verktøy over `buildUnifiedWorkoutActivities` ville gjort samme
  jobb med samme tall som flaten — jf. prinsippet i changelog 2026-08-07.
- **«vi har en konflikt hjemme … med kona» ruter til `home` (bolig), ikke
  `family`.** `HOME_DOMAIN_TRIGGER` treffer «hjemme», og familie-mønsteret har
  `kone` men ikke `kona`. Et samlivsspørsmål får dermed hus-prosjekt-instrukser.
  Rørt bare så langt websøk-tvangen gjelder her; ordet «kona» og
  hjemme/hjem-tvetydigheten står igjen.
