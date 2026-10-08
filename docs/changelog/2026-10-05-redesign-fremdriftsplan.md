# Redesign: fremdriftsplan

Dato: 2026-10-05
Status: pågår

## Kontekst

Utgangspunktet var et brukerintervju og bruksdataene fra `/api/diagnostikk/bruk`
(se `2026-10-05-aapen-bruksdiagnose.md`). Funnene:

- **Resonans brukes til alt, men chatgpt.com vinner som coach.** Det har fire
  grunner: smartere svar, én tråd, «det bare virker» og hukommelse.
- **Appen åpnes sjelden.** Brukeren ønsker en hjemskjerm som skifter med døgnet.
- **Friksjonen:**
  - fragmenterte chatter,
  - usikkerhet om hvilke verktøy som finnes når,
  - ingen enkel vei inn for bilder,
  - for mange flater,
  - for tett og teknisk,
  - et upersonlig uttrykk.
- **ChatGPT-bruken som skal hjem:**
  - intervjuer over flere dager for å prioritere,
  - et prosjekt for overgangen til ny jobb,
  - skjermbilder fra Resonans, Ekko og Strava limt inn. Det er data Resonans
    allerede har.

  ChatGPT kan fortsatt brukes til kode og til raske websøk.
- **Visuelt:** «blekk på krem», men med nattmodus. Tettheten skal være
  **lagdelt**: først en setning, så en graf, så detaljene.

Skissene ligger i artefaktet «Resonans – veier videre»
(https://claude.ai/artifact/VwZGko8Vy4LCtxcvgp4gSS). Det har fire retninger og
et forslag til informasjonsarkitektur:

- A: døgnrytme,
- B: avis,
- C: dagbok,
- D: mørkt.

Brukeren valgte å begynne med coachen («Resonans blir coachen», «smart og
rask»).

## Spor og status

| Spor | Status | Neste steg |
|---|---|---|
| 1. Coachen | Fase 1–6 ferdig. Kuttet måles i skygge, men **målingen sulter**. Coachen tenker ikke (Chat Completions + verktøy) | Chatte som vanlig til 20 svar med verktøykall; deretter Responses-API-et (punkt 6) |
| 2. Én inngang | Ute til utprøving, lite brukt ennå | Les `inngang:*` igjen om et par uker |
| 3. Hjemskjerm etter døgnet | **Brevet parkert** etter fase 7 | Signalene inn på hjemskjermen som klikkbare linjer, uten modell |
| 4. Visuelt uttrykk | Besluttet: A. Fargetemaet bygget, `/` tegnet i A (`2026-10-08-alle-flater-i-valgt-tema.md`) | Arkene på hjemskjermen; så «I dag»-linjene (spor 3) |
| 5. Tre rom (struktur) | Foreslått | Etter spor 3 |
| Sidespor: modeller | GPT-6 Luna valgbar i chatten, Sol i brevet | Testsuite som egen app (brukeren); Sol i chatten krever Responses-API-et |

### Status 8. oktober 2026

Bruksdata siste sju dager (`/api/diagnostikk/bruk?days=7`): 7 av 7 dager
aktive, 27 økter, 166 sidevisninger, 93 minutter oppmerksomhet.

- **Hjemskjermen er flaten**: 68 av 166 visninger og 40 av 93 minutter. Deretter
  temaene (37), ukeplanen (18) og `/brev` (13). Det er derfor spor 3 og 4
  hører sammen og bør starte på `/`.
- **Chatten brukes, men mest i skriveprosjektet**: 39 meldinger, hvorav 30 i
  dagbok-/skrivetråden (`writing`). Den flaten måles ikke i
  `chat_perf_samples`, og hovedchatten hadde 0 målte svar siste døgn. Spor 1s
  neste steg står derfor stille på data, ikke på kode.
- **Én inngang**: `inngang:bibliotek` 3, `inngang:tekst` 3, `inngang:kamera` 2,
  `inngang:apne-hjem` 2. For lite til å si om den nye veien tar over.
- **Brevet**: se `2026-10-06-brev-prototype.md`, «Hvor vi står». Innholdet
  (styringssignalene) og lenkene virker; prosaen krever mer arbeid enn den er
  verdt før det finnes en måte å vurdere den systematisk på.
- **Modeller**: se `2026-10-08-gpt6-modeller.md`. Brukeren bygger en
  testsuite som egen app (fart, kapabiliteter, svarkvalitet), med kartleggingen
  av OpenAI-bruken som grunnlag. Modellbrevet og hovedchatten er de første
  kandidatene til å bli målt der.

### 1. Coachen — ▶ ta opp igjen tråden her

Fase 1–6 er ferdige, se `2026-10-05-coachen-smart-og-rask.md`. Resultatet så
langt er dette:

- Første ord kommer etter median 6,6 s, ned fra 14,5 s.
- Svaret strømmer.
- Avslag fra OpenAI betales én gang per deploy.
- Prompten er målt.
- Verktøyutvalget går i skygge.

**Gjenopptak (i denne rekkefølgen):**

1. **Les `chat.answer.toolSelection` på `/api/diagnostikk`** (sett `?minutes=1440`)
   når `withToolCalls` er minst 20. Dette er avhengig av at brukeren chatter som
   vanlig, og det krever ingen kode.
   - Ligger bom-andelen på 5 % eller lavere, settes `CHAT_TOOL_SELECTION=on` i
     Coolify. Det krever ingen deploy.
   - Ligger den høyere, viser `topMissed` hvilket ord eller hvilken gruppe som
     mangler. Rett det i `detectPromptFocusModules` eller `TOOL_GROUP_MAP`, og mål
     på nytt.
2. **Mål første ord på nytt** med kuttet på. Verktøylista er to tredjedeler av
   prompten, så her ligger den største gevinsten som gjenstår.
3. **Grunnprompten** er 23 800 tegn og **minnet** 9 700. Begge skal krympes, og
   det skal måles med `promptParts`.
4. **Cache-andelen** er ~20 %. Prefikset må være stabilt: det som er likt fra
   kall til kall ligger først, og dato, dag og helse ligger sist.
5. Deretter kommer de av ChatGPT-grunnene som ikke handler om fart:
   - **Én tråd.** Temaer blir filtre på tråden, ikke egne chatter. Det henger
     sammen med spor 5.
   - **Synlig hukommelse.** «Hva jeg vet om deg» blir en side som kan leses og
     rettes.
   - **Prosjekter og intervjuer over flere dager**, som ChatGPT-bruken A og C.
6. **Hovedchatten over på Responses-API-et — coachen tenker ikke i dag.**
   Over Chat Completions kan gpt-5.x, Luna og Sol ikke kalle verktøy med
   resonnering slått på, og hovedchatten sender alltid verktøy. Fase 4 målte 0
   tenketokens; «smart» har vært gpt-5.4 uten tenking. Se
   `2026-10-08-gpt6-modeller.md`, fase 2.
   - Berører verktøyløkka (verktøykall som `function_call`-items), strømmingen
     (en annen hendelsesprotokoll), meldingsformatet og historikken.
     `createChatCompletionWithFallback`, `ModelRejectionMemory` og målingen i
     `chat_perf_samples` må over i samme slengen.
   - Gjøres når testsuiten brukeren bygger kan si om svarene blir bedre og hva
     tenkingen koster i tid til første ord. Uten den er det å bytte en målt
     6,6 s mot en følelse.
   - Mulig gevinst på kjøpet: lagret samtaletilstand (`previous_response_id`).
     Om det løfter cache-andelen fra ~20 % (punkt 4), må måles, ikke antas.
7. **Ekko** (`shared-tools.ts`) har verken modellvalget, strømmingen eller
   verktøyutvalget. Det er en egen runde, og den må koordineres med ekko-repoet.

### 2. Én inngang — ute til utprøving

Fase 1 er bygget **i tillegg til** kamera/lyd/fil i chatfeltet, som brukeren
ba om. Se `2026-10-05-en-inngang.md`. Neste steg er å se i bruksdataene
(`inngang:*`-etikettene) om den nye veien tar over for den gamle, før noe
fjernes.

Opprinnelig beskrivelse:

Tekst, stemme, bilde og fil skal gå gjennom samme knapp og samme skrivevei.
Coachen sorterer etterpå i måltid, sult, symptom, økt, billett og hodedump. Det
svarer direkte på to av funnene: «ingen enkel vei inn for bilder» og
klipp-og-lim til ChatGPT.

- Inngangen er uavhengig av spor 4 og 5, og den bruker `ChatInput` og
  `ChatState`. Det skal ikke bygges et femte chat-lag.
- Mange skrivestier finnes allerede, blant annet `log_nutrition`,
  `analyze_meal_image`, `record_screen_time`, billettleseren og symptomloggen.
  Jobben er først og fremst ruting og én knapp, ikke nye skrivestier.
- Åpent spørsmål: hvor knappen bor før de tre rommene finnes. Forslaget er at
  den står fast nederst på hjemskjermen og i samtalen.

### 3. Hjemskjerm etter døgnet — brevet parkert, signalene videre

Brevet som prototype er ferdig og parkert, se `2026-10-06-brev-prototype.md`.
Det som tas videre er innholdet: styringssignalene og at de er klikkbare.

Opprinnelig beskrivelse:

Skissene A1–A3 viser hjemskjermen som ett brev og én eller to handlinger. Brevet
skifter med tiden:

- om morgenen er det planen,
- om kvelden er det refleksjon,
- etter et fravær er det «siden sist».

- Mye av innholdet finnes allerede i krydderreglene, for eksempel
  `digest-nugget-rules.ts` og `weight-nugget-rules.ts`, og i hurtighandlingene
  (`action-suggestion-service.ts`). Reglene skal **leses**, ikke regnes på nytt.
  Det er samme prinsipp som for push-krydderet.
- «Siden sist» krever å vite når brukeren sist var inne. Det er
  `usage_events`, så det trengs ikke en ny tabell.
- Første versjon kan bygges i dagens visuelle språk, så sporet venter ikke på
  spor 4.

### 4. Visuelt uttrykk — besluttet: A

Brukeren valgte **A (døgnrytme)**, blekk på krem med nattmodus. Svaret var
«enig, men mest A». B sin avistypografi er derfor **ikke** med som standard i
dybdelagene, slik anbefalingen foreslo. Den kan vurderes i en enkelt flate der
den gjør jobben, men ikke som et system.

- **Prinsippet er endret (8. oktober 2026):** «Alltid mørk» er erstattet av
  «Alle flater finnes i valgt tema», i `docs/DESIGN.md` og CLAUDE.md samtidig.
  Fargene skal fortsatt komme fra CSS-variablene i `AppPage`. Det som gjenstår
  er koden: `AppPage` hardkoder de mørke verdiene, de portalerte arkene har egne
  mørke paletter (`--cs-*`), og alle hardkodede antakelser om mørk bakgrunn må
  finnes.
- Overgangen bør skje rom for rom, med `npm run test:visual:review` for hver
  side, framfor i ett stort bytte.

### 5. Tre rom og én inngang (struktur)

Forslaget er tre rom:

- **I dag:** hjemmet etter døgnet.
- **Samtalen:** én tråd og én coach.
- **Livet:** temaer og mortemaer. Plan, mål og retning samles der.

I dag finnes rundt 30 flater og sju chatflater, plan på tre steder og 17
dashboardtyper.

- Strukturen kommer etter spor 2 og 3, fordi de to viser hva rommene trenger.
- Bruksdataene avgjør hva som slås sammen eller fjernes. Flater uten besøk er
  kandidater, og endepunkter utenfor `/api/apps/*` kan endres ut fra dette repoet
  alene.
- «Én tråd» fra spor 1 og «Samtalen» her er samme beslutning, og de tas sammen.

## Forslag til rekkefølge (oppdatert 8. oktober 2026)

1. ~~**Brukeren velger visuell retning** (spor 4).~~ A er besluttet.
2. ~~**Én inngang** (spor 2).~~ Fase 1 er ute til utprøving.
3. ~~**Hjemskjerm v1 som brev** (spor 3).~~ Prototype ferdig og parkert.
4. **Hjemskjerm v2: «I dag» i uttrykk A.** Styringssignalene fra brevet som
   korte, klikkbare linjer øverst på `/`, tegnet i A (blekk på krem, nattmodus)
   på den ene flaten. Det slår sammen spor 3 og 4 der bruken er størst, og
   prøver ut A på én side før resten. Beslutningen om «Alltid mørk» er tatt:
   alle flater finnes i valgt tema.
5. **Tilbake til coachen** når skyggemålingen har 20 svar med verktøykall
   (spor 1, punkt 1). Vurder samtidig om skrivetråden skal måles, siden det er
   der chattingen faktisk skjer.
6. **Tre rom og én tråd** (spor 5 og spor 1, punkt 5).
7. **Det visuelle uttrykket rulles ut** rom for rom.

Parallelt, uten kode i dette repoet: testsuiten for modeller. Når den finnes,
kan modellbrevet tas opp igjen med en måling i stedet for en følelse.

## Beslutninger

- **Coachen først.** Det var brukerens valg, og grunnen er at ChatGPT vinner på
  svarkvalitet. En ny drakt rundt en coach som svarer dårligere enn alternativet
  ville ikke endret hvilken app som åpnes.
- **Struktur etter innhold.** De tre rommene skal tegnes ut fra det spor 2 og 3
  faktisk trenger, ikke omvendt.

## Verifisering

Hvert spor får sitt eget changelog-dokument når arbeidet starter. Denne fila
oppdateres med status og lenke.
