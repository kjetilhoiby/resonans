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
| 1. Coachen | Fase 1–6 ferdig, kuttet måles i skygge | **▶ Ta opp igjen her** (se under) |
| 2. Én inngang | Ikke startet | Kan startes nå |
| 3. Hjemskjerm etter døgnet | Skissert (A1–A3) | Kan startes nå |
| 4. Visuelt uttrykk | Skissert (A–D) | **Venter på et valg fra brukeren** |
| 5. Tre rom (struktur) | Foreslått | Etter spor 2 og 3 |

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
6. **Ekko** (`shared-tools.ts`) har verken modellvalget, strømmingen eller
   verktøyutvalget. Det er en egen runde, og den må koordineres med ekko-repoet.

### 2. Én inngang — kan startes nå

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

### 3. Hjemskjerm etter døgnet — kan startes nå

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

### 4. Visuelt uttrykk — venter på et valg

Anbefalingen er **A (døgnrytme) som hovedretning, med B sin avistypografi i
dybdelagene**, blekk på krem og nattmodus. Den er ikke besluttet.

- **NB:** `docs/DESIGN.md` og CLAUDE.md sier «Alltid mørk». En lys krem-modus er
  derfor en endring av et designprinsipp, ikke bare et tema. Begge filene må
  oppdateres samtidig, og alle hardkodede antakelser om mørk bakgrunn må finnes.
  Fargene skal fortsatt komme fra CSS-variablene i `AppPage`.
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

## Forslag til rekkefølge mens chatten måles

1. **Brukeren velger visuell retning** (spor 4). Det er en kort beslutning, og
   den låser opp alt det visuelle.
2. **Én inngang** (spor 2). Den gir mest igjen, og den avhenger av minst.
3. **Hjemskjerm v1** (spor 3) i dagens uttrykk.
4. **Tilbake til coachen** når tallene fra skyggemålingen er inne (spor 1,
   punkt 1).
5. **Tre rom og én tråd** (spor 5 og spor 1, punkt 5).
6. **Det visuelle uttrykket rulles ut** rom for rom.

## Beslutninger

- **Coachen først.** Det var brukerens valg, og grunnen er at ChatGPT vinner på
  svarkvalitet. En ny drakt rundt en coach som svarer dårligere enn alternativet
  ville ikke endret hvilken app som åpnes.
- **Struktur etter innhold.** De tre rommene skal tegnes ut fra det spor 2 og 3
  faktisk trenger, ikke omvendt.

## Verifisering

Hvert spor får sitt eget changelog-dokument når arbeidet starter. Denne fila
oppdateres med status og lenke.
