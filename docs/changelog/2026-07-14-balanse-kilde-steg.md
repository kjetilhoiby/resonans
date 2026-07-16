# Balanse-kildesteget i livsintervjuet

Dato: 2026-07-14
Status: ferdig (ende-til-ende-verifisering gjenstår i dev)

## Kontekst

Livsintervjuet ble bygget uten import av den gamle ChatGPT-tråden («Balanse»). Brukeren
ombestemte seg på ett punkt: «jeg tror jeg var mer konkret og direkte i fjor enn i år» —
materialet fra Balanse er skarpere enn dagens formuleringer og skal brukes som
**konfrontasjonsmateriale**, ikke bare bakgrunn. Materialet skal gi fire konkrete ting:
hva brukeren har sagt om **identitet**, hva han har **stått i**, hvilke **grep** han tok,
og hvilke **mål** han satte.

## Faser

### Kildesteget
- Nytt steg 0 `kilde` i livsintervju-flowen (`registry.ts`): valgfritt textarea-felt der
  råmateriale limes inn. Steget forklarer fire-akse-bruken og at tidligere import
  allerede er med.
- Ny refleksjonstype `livsintervju_kilde` (`reflections.ts`): rått materiale lagres
  **append-only** i originalformat via `createReflection` — aldri overskrevet, aldri
  destillert bort. Lagt i `TRANSCRIPT_REFLECTION_KINDS` (`reflection-block.ts`) så den
  aldri dumpes i systemprompten, og er automatisk lesbar via `query_reflections`.

### Prompt-bruk — fire akser
- Ny ren hjelper `resolveKilde(data, maxChars = 8000)` i `livsintervju.ts` (testet):
  fersk innliming prioriteres over tidligere import, kuttes med
  «… [forkortet — fullteksten er lagret]» for prompt-bruk.
- **`verdier`**: kilde-blokk med instruks om å lese etter identitet + hva han sto i, og
  påpeke der dagens svar er vagere enn den gang.
- **`ti_aar`** (cap 6000): tiårsbildet holdes opp mot identiteten og målene fra Balanse —
  hva står seg, hva er forlatt, og er det forlatt med vilje?
- **`speil`**: eksplisitt sammenligning på alle fire aksene — grepene: holdt de? målene:
  nådd, droppet eller glemt? — og «hva har blitt vagere, og hvorfor?».
- `fem_aar`/`ett_aar` får ikke kilde-injeksjon (statusblokkene bærer essensen; promptene
  holdes slanke).

### Rundtur
- `onComplete` sender `kilde` (full tekst); tomt intervju-guard godtar kilde alene.
- `api/retning/livsintervju`: kilde → `createReflection('livsintervju_kilde')` FØR
  visjonene; id-en inngår i `inputRefs.reflectionIds` (visjonene sporer til kilden).
- `api/retning/interview-context`: returnerer siste kilde som `kildemateriale` (full
  tekst; trimming skjer i buildPrompts) → `_kildemateriale` i `initialData` fra både
  HomeScreen og /drommer.
- `query_reflections`-beskrivelsene (verktøyfil + chat-rute) nevner `livsintervju_kilde`.

### Tonejustering: varm + skarp

Brukerinnsikt: det som overrasket positivt i Balanse-tråden var ikke direktheten alene, men at
svarene var **varme og innsiktsfulle** — varmen er fundamentet som gjør konfrontasjonen mulig å
ta imot. Livsintervju-promptene hadde mistet ordet «varm» på veien (i motsetning til
selvangivelsens «varm, nysgjerrig — venn, ikke terapeut»). Justert:

- Tone-linjene i alle livsintervju-steg + retningssamtalen: «varm og skarp — utfordringen
  kommer fra omsorg, ikke distanse. Se først, utfordre så.»
- Speilet åpner nå med hva som er mest levende og ekte i det brukeren har formulert, FØR
  spenningene og det ubehagelige spørsmålet.
- Konfrontasjonsinstruksen i chat-konteksten (`direction-context.ts`) rammer inn gapene med
  varme (testet).
- Prinsippet er skrevet inn i VISION.md under «Retningen er målestokken».

### FlowSheet-robusthet: bevar chat-state ved navigasjon, vern usendt tekst

Reell hendelse under første bruk: bruker trykket «Neste» i stedet for «Send» med tekst i
feltet, gikk «Tilbake» — og steget startet på nytt (autoSend re-fyrte). Tre rotårsaker fikset:

- **Kontinuerlig tråd-synk:** `{stepId}_thread`/`{stepId}_lastMessage` skrives nå etter hvert
  replikkskifte (via `syncChatStepData` + rene hjelpere `serializeChatThread`/
  `rehydrateChatMessages` i flow-helpers, testet) — ikke bare ved «Neste». Trådene bærer nå
  også `rawText` så `<status>`-blokker overlever rehydrering. En økt som aldri når «Neste»
  mister ingenting.
- **Rehydrering i stedet for omstart:** `initChatStep` gjenoppretter lagret tråd ved
  tilbake-navigasjon og gjenopptatte utkast, og hopper over autoSend. `handleNext` skriver
  kun når steget fikk nye replikkskifter (`chatStepDirty`) — en urørt visning overskriver
  aldri lagret tråd. «Start på nytt» gir fortsatt ekte omstart.
- **Vern mot usendt tekst:** input-utkastet løftes via `onTextChange` → «Neste» disables med
  hint («Send eller tøm meldingen først»), og `{#key currentStep.id}` gir fersk ChatInput per
  steg så tekst ikke henger igjen på neste steg.

Gjelder alle chat-flyter (livsintervjuet, selvangivelsen, retningssamtalen, day_plan osv.).

## Beslutninger

- **Full tekst lagres, utdrag brukes**: samme prinsipp som resten av «samtalen er data» —
  ingen mini-modell-oppsummering av kilden; prompt-caps (8000/6000 tegn) er ren trunkering
  med eksplisitt markør, og fullteksten er alltid tilgjengelig via verktøy.
- **Steget er alltid synlig og valgfritt** — man kan lime inn mer materiale ved senere
  re-intervjuer; hver innliming blir en ny append-only rad.

## Verifisering

- `npm test` (nye `resolveKilde`-tester; TRANSCRIPT-testen dekker ny kind automatisk) +
  `npm run check`.
- I dev: start livsintervjuet → kilde-steget vises først; lim inn tekst → fullfør →
  `livsintervju_kilde`-rad med full tekst, visjonenes `inputRefs.reflectionIds` inkluderer
  den; re-åpne intervjuet → verdier/ti_aar/speil-promptene inneholder utdraget med
  fire-akse-instruksen; i vanlig chat: «hva sto i Balanse om …» → `query_reflections`
  med kind `livsintervju_kilde`.
