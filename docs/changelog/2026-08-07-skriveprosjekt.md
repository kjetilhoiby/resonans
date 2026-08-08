# Skriveprosjekt, kompislesing og notatblokk

Dato: 2026-08-07
Status: pågår (fase 1, 2, 2b, 4 og 5 ferdig; fase 3 utsatt)

## Kontekst

Bestillingen kom som et spørsmål — «hadde det gitt mening med en god notatblokk med
semantisk søk?» — og vokste over tre runder til noe større: starte et skriveprosjekt,
bygge karakterer og scener og skrive det hele sammen; få feedback og *kompislesing*;
få tips til skriveøvelser som gjør at man setter seg ned med notatblokka framfor
telefonen på kvelden; og et alternativ til notes-appen på telefonen som er lett
søkbart og fleksibelt (dokumenter, lister, frie notater, transkripsjoner).

To funn snudde utformingen.

**Semantisk søk er ikke et prosjekt — det er i drift.** pgvector er installert
(`0037_pgvector_embeddings.sql`), `embedding-service.ts` gir
`text-embedding-3-small` med 1536 dimensjoner og feiler aldri blokkerende,
`reflections.embedding` fylles ved hver skriving (`server/reflections.ts:50`), og
`query_reflections` gjør cosine-søk på tvers av alle kinds. `backfill-embeddings.mjs`
finnes for gamle rader. Det som mangler er ikke søket, men **leseflaten**: et grep
etter hvilke sider som leser `reflections` gir to treff, og ingen av dem viser
notater. Notatblokken er write-only i dag — et notat dikterte i mars kan bare hentes
ved å spørre chatten, og da må man huske at det finnes.

**Bok-domenet er dette systemet, speilvendt.** Der leser man andres bok med kuratert
kontekst; her skriver man sin egen. Nesten hver mekanisme finnes:

| Ønsket | Finnes som |
|---|---|
| Skriveprosjekt m/ karakterer og scener | `books` + `book_clips`, eid av et tema |
| Kompislesing | `buildBookSystemPrompt` + egen `conversationId` per bok |
| Transkripsjoner | `transcribeAudioWithWords` (Whisper, ord-nivå tidsstempler) |
| Skriveøvelser som vane | 9 nudge-moduler, cron hver time, `nudge-time.ts` |
| Søkbar notatblokk | pgvector + `reflections` + `create_note` |

Kompislesings-prompten er allerede skrevet. `BookChatTab.svelte:119`: «Du er en
oppmerksom og reflektert leser … bygg videre på deres observasjoner, vær konkret
(referer til scener og detaljer), tør å formulere hva som kan være ubehagelig eller
uklart», med eksplisitt forbud mot «sterk historie» og «interessant». Den peker bare
på feil bok.

## Beslutninger

### `reflections` holder ikke for dokumenter — men skal beholde fangsten

Kolonnene (`schema.ts:1179`) er `kind`, `periodKey`, `content`, `scores`,
`flowRunId`, `embedding`, `createdAt`. **Ingen tittel, ingen `updatedAt`, ingen
status.** Det er semantikken, ikke en forglemmelse: en refleksjon er et øyeblikksbilde
identifisert av (kind, periodKey) — `plan_artifacts` har en unik indeks på nettopp den
trippelen. Log-naturen er gjort bokstavelig i `create_note`, som legger dagens notat
til forrige ved **konkatenering** (`appendDiaryNote`, create-note.ts:74).

Et dikt er det motsatte: det har tittel, det finnes i utkast 7 som erstatter utkast 6,
og identiteten er ikke en dato. Legges det i `reflections`, skrives `content` over ved
hver redigering (og embeddingen regenereres, `reflections.ts:86`), og lista viser
førstelinjer uten titler.

**Arbeidsdelingen: `reflections` eier fangst og tidsstemplede refleksjoner,
`writing_docs` eier dokumenter man kommer tilbake til.**

### Én dokumenttabell med `kind`, ikke fire tabeller

`writing_projects` (tittel, sjanger, status, `conversationId`, temakobling) eier
`writing_docs` med `kind`: `scene` | `kapittel` | `karakter` | `sted` | `notat` |
`dikt` | `liste` | `transkripsjon`. Pluss `body`, `sortOrder`, `status`, `embedding`,
`updatedAt`.

Dette er repoets eget idiom. `streak_definitions` dekker tre semantikker i én tabell
«så alle streaks kan vises med samme visuelle språk i stedet for hver sin widget», og
`cut_lists` holder materialer i JSONB framfor egne tabeller. Karakterer og scener er
ikke ulike nok til å fortjene hver sin tabell — de er dokumenter med ulik rolle.
`sortOrder` er det som lar en «skrive det hele sammen».

### Karakterer skal ikke inn i `persons`

Fristende, siden `persons` har relasjoner ferdig modellert. Det er en felle:
`persons.birthDate` mater kroppsprofilen for self-personen
(`metricSettings.profile.birthYear` er bare en overstyring), og
`manage_relation`/familie-domenet leser samme tabell. Fiktive folk der forurenser
ekte data. Karakterer er `writing_docs` med `kind='karakter'`.

### Skrive-chatten bygger prompt server-side, og legger ikke til globale verktøy

Bok-prompten bygges i dag i en Svelte-komponent (`BookChatTab.svelte:85`). Det går
når konteksten er en ferdig `contextPack`; et manus er større og må hentes selektivt
(denne scenen, disse karakterene).

CLAUDE.md advarer presist her: 48 verktøy ≈ 7 000 tokens, og treffsikkerheten faller
med antallet — `query_food` mot `query_nutrition` forvirrer alt i dag. Løsningen er
den bok-chatten allerede bruker, og som VISION peker på («hvert domene bør ha sin
bok-chat-opplevelse»): et **smalt kontekstmodus** med egen systemprompt, ikke flere
globale verktøy.

**Forbudslista beholdes ordrett.** En modell som alltid finner noe klokt å si om
diktet ditt er en smigermaskin. Guarden mot «sterk historie»/«interessant» er
forskjellen mellom kompislesing og smiger.

### Kveldsnudgen bærer øvelsen, den minner ikke om den

Konkurrenten er telefonen i det øyeblikket man har ledig tid. `sendFuelNudge` lærte
to ting som gjelder her: den gater på **én per dag** fordi «en nudge som fyrer hver
dag blir bakgrunnsstøy, og bakgrunnsstøy blir slått av», og `repeatableMeals` finnes
fordi «favoritter man har glemt å opprette hjelper ingen» — friksjon i
handlingsøyeblikket dreper alt.

Varselet skal derfor inneholde en konkret femminutters øvelse generert fra eget
materiale («skriv 200 ord der Ida lyver til broren»), ikke «husk å skrive». Det er
også det som skiller dette fra en generisk skriveprompt-app: øvelsen kjenner
prosjektet.

### Streaken måler dager skrevet, ikke ord

Samme lærdom som atferdsmilepælene i vektdomenet: «en motor som bare feirer synkende
vekt er stum i alle ukene vekta stiger». En dag med tung redigering gir negativ
ordproduksjon. Dager skrevet er sant uansett retning; ord er sekundært tall.

`streak_definitions` dekker regelen (`consecutive_days`) og har **ingen lagret
teller** — streaks beregnes on-demand fra hendelser.

*Rettet i fase 4:* planen sa at `source` trengte en ny `writing`-kilde. Det
stemte ikke — `sensor_event` dekker det. Det som faktisk manglet var
hendelsesloggen selv, som streaken ikke kan være sann uten. Se fase 4.

### Notatblokka eier ikke oppgaver

Resonans har ukeplan, handleliste og innboks fra før. En liste som skal *gjøre* noe
hører dit. Mønsteret for overlevering finnes i drift: `find-triage.ts` promoterer
oppskrifter fra `finds` til `meals`. Samme grep her — en jotting som viser seg å være
en oppgave, flyttes ut. Det er også svaret på «parses over i strukturerte data
senere»: ikke en ny parser, men triage-mønsteret som allerede kjører.

## Brukssituasjoner (fra intervju 2026-08-07)

### To flater, tre lagringssteder — og søket som binder dem

Notatblokka og skriveprosjektet skal være **to flater**: notatblokka er den frie,
raske innboksen; skriveprosjektet er et eget rom med karakterer, scener og egen chat.
Notater skal kunne flyttes inn i et prosjekt.

Det gir en seam som må avgjøres nå, ikke oppdages: `create_note` skriver i dag til
`reflections` (dagsnotat eller feriedagbok), mens notatblokka trenger dokumenter med
tittel og `updatedAt`. Skal et stemmenotat fra Ekko og et notat skrevet i
notatblokka havne to steder?

**Ja — og det er riktig, fordi søket er unifiseringen, ikke tabellen.** Et dagsnotat
fra bilen *er* et tidsstemplet øyeblikksbilde og hører i `reflections` med sin
`periodKey`; det ville mistet mening som redigerbart dokument. Et notat man kommer
tilbake til og endrer hører i `writing_docs` med `projectId = null`.

Konsekvensen for fase 1: den delte søkefunksjonen må søke **på tvers av begge
tabellene** og returnere en samlet, rangert liste. Det er billig — begge har
`embedding vector(1536)` fra samme modell, så cosine-avstandene er sammenlignbare.
Notatblokk-flaten viser dem i to seksjoner (dokumenter / fangst), ett søkefelt.

Å flytte et notat inn i et prosjekt er da to ting: `writing_docs` får `projectId` og
`kind` satt, og en `reflections`-fangst *kopieres* inn som dokument (originalen blir
stående — den er en logg-rad, og logger redigeres ikke). Samme grep som
`find-triage.ts` bruker når en oppskrift promoteres fra `finds` til `meals`.

### Mobil og desktop skal være like gode

Dette er det dyre svaret, og det bør stå at det er dyrt: to redigeringsopplevelser mot
samme dokument. Dokumentmodellen forblir én; det er editorene som skiller lag —
tommelvennlig fangst og autolagring på mobil, rolig langtekst-modus på desktop.

**Fellen er samtidig redigering, og den er reell selv for én bruker:** et dokument
åpent på telefonen hele kvelden, endret på desktop i mellomtiden, lagrer over ved
neste tastetrykk. Siste-skriv-vinner er feil default her fordi taperen er den lengste
teksten. Tiltaket er billig: klienten sender `updatedAt` den lastet, og skrivingen
avvises med en tydelig melding hvis raden er nyere. Ingen merge, bare en ærlig
kollisjon — og den skal *vises*, ikke svelges i en `catch {}` (jf. CLAUDE.md om
`extractApiErrorMessage`).

### Kompislesing har tre moduser, alle på forespørsel

**leser** (reagerer, foreslår ikke), **redaktør** (konkrete forbedringer) og
**sparring** (prosjektet som helhet, ikke linje for linje) — og alt **på
forespørsel**, som er et *tidspunkt*, ikke en fjerde modus. Ingenting skjer
uoppfordret. Det er en lettelse for arkitekturen: ingen proaktiv feedback-flate,
ingen nudge på tekst.

**Modusen skal være eksplisitt UI-tilstand, ikke noe modellen utleder.** Glir den
mellom leser og redaktør, blir tilbakemeldingen mush — man vet ikke om «denne
replikken bærer ikke» er en observasjon eller en instruks. Moduset velges i flaten og
sendes til den serverbygde prompten. Fire prompter som deler den samme forbudslista
mot «sterk historie»/«interessant».

Sparring-modus er den som trenger bredest kontekst (hele prosjektet), leser-modus den
smaleste (teksten som deles). Det er et argument for serverbygging i seg selv.

### Øvelsene blandes, og appen velger

Beslutningen skal bo rent og testet i et domenemodul, slik `decideFuelNudge` gjør —
ikke inne i cron-endepunktet. Foreslått rangering, som speiler fuel-nudgens tre
varianter:

1. **Prosjektbundet** når et aktivt prosjekt har noe åpent (en scene i utkast, en
   karakter uten beskrivelse). Flytter manuset framover.
2. **Fri øvelse** når det ikke finnes aktivt prosjekt, eller når prosjektbundet har
   fyrt flere ganger på rad — variasjon er poenget, og en fri øvelse er ofte veien
   tilbake inn når man står fast.
3. **Ingenting** når dagens skriving alt er gjort. En nudge som gratulerer med noe du
   nettopp gjorde er støy.

Gates arves fra `sendFuelNudge`: én per dag, stille timer, og et tidsvindu som treffer
kvelden.

## Faser

### Fase 1: Tabeller, notatblokk og søk på tvers — FERDIG

`0050_skriveprosjekt.sql` oppretter `writing_projects` og `writing_docs`
(`project_id` nullable), med matchende definisjoner og relasjoner i `schema.ts`.

**Domenelaget** (rent og testet, 36 tester):
- `domain/writing/doc-kinds.ts` — de åtte typene, `ordered`-flagget som skiller
  manusets egne typer (scene, kapittel) fra materialet rundt, `displayTitle` og
  `countWords`.
- `domain/writing/concurrency.ts` — `checkNotStale`.
- `domain/writing/notebook-results.ts` — normalisering og fletting av treff.

**Søket** (`server/writing/search.ts`) genererer embeddingen **én gang** og
gjenbruker den mot begge tabellene. Det er ikke bare en besparelse: to kall kunne
gitt to ulike vektorer, og da ville rangeringen på tvers vært meningsløs.
`query_reflections` er skrevet om til å bruke `searchReflections`, så chatten og
flaten søker likt — verktøyet er nå 40 linjer kortere.

**Skriveveien** (`server/writing/docs.ts`) er én vei inn for API, chat-verktøy
(fase 2) og transkripsjon (fase 3). Den regenererer embeddingen når teksten endres
— uten det står likheten mot den gamle teksten og søket lyver.

**Versjonssjekken gjelder bare tekstendringer.** Å flytte et dokument inn i et
prosjekt eller endre status kan ikke ødelegge noens skriving, og skal ikke kunne
blokkeres av at en annen enhet skrev ett tegn. PATCH svarer **409** med en melding
som sier hvor gammel versjonen din er — to sekunder er en dobbeltlagring, to timer
er den andre enheten — og flaten viser den i en innrammet boks framfor å lagre over.

**Forfremmelse av fangst** (`promoteReflectionToDoc`) kopierer en `reflections`-rad
inn som dokument og lar originalen stå. Samme grep som `find-triage.ts`.

Endringer i delte komponenter: `Textarea` fikk `dataTrack` og `onInput`, `Input`
fikk `ariaLabel` og `onInput`, `Select` fikk `dataTrack` og `ariaLabel`. Alle tre
manglet felt de to andre hadde — en placeholder er ikke et tilgjengelig navn, og et
tekstfelt uten `data-track` ender som anonym `input[text]` i bruksstatistikken.

Dekker notes-app-erstatningen alene.

### Fase 2: Prosjektrommet og kompislesing — FERDIG

**Plasseringen ble toppnivå, ikke tema.** Det åpne spørsmålet fra fase 1 lente mot
tema, siden bok-domenet bor der. Det snudde ved nærmere ettersyn:
`resolveThemeDashboardKind` utleder dashboardtypen fra temanavnet med
delstreng-matching for termer ≥5 tegn, og «skriv» er akkurat 5. En ny
`DashboardKind` ville lagt en ny felle i `THEME_DASHBOARD_MATCHERS` for å oppnå noe
`/notater` allerede løser uten. `/skriv` og `/notater` er dessuten søsken —
å nøste den ene under tema og ikke den andre ville vært vilkårlig.
`writing_projects.themeId` står igjen, så et prosjekt kan knyttes til et tema uten
at ruta bor der.

**`/skriv`** lister prosjekter og oppretter nye. **`/skriv/[id=uuid]`** er rommet:
tre faner (Manus, Materiale, Kompislesing). Manuset er de ordnede typene sortert på
`sortOrder`; materialet er karakterer, steder og notater. Dokumentredigering
gjenbruker `/api/notater` med `projectId` satt — én skrivevei, som lovet.

**Prompten** (`domain/writing/coach-prompt.ts`, 17 tester) er ren og testet.
Modusens `scope` styrer bredden: `leser` ser bare teksten, `redaktor` ser tekst og
materiale, `sparring` ser prosjektet og manusets deler — men ikke fokusteksten,
siden sparring ikke handler om linjer. Tester låser nettopp de grensene: at
karakterer *ikke* lekker inn i leser-modus, og at fokusteksten *ikke* lekker inn i
sparring.

**Endepunktet** `/api/skriveprosjekt/[id]/lesing` er en egen SSE-rute, ikke
`/api/chat-stream-messages`. Grunnen er beslutningen over: prompten skal bygges på
serveren. Den bruker ingen verktøy — dette er et smalt kontekstmodus, ikke et
agent-løp.

**Modellen er `gpt-5.4`, ikke `gpt-4o`.** Første utgave hardkodet `gpt-4o`, kopiert
fra `chat-stream-messages`. Det var feil, og på en måte som var lett å overse:
hovedchatten tar allerede motsatt valg for akkurat denne samtaletypen. I
`api/chat` gjør et satt `systemPromptPrefix` samtalen «conversational», og da blir
modellen `gpt-5.4` — kommentaren der sier «skip tools for conversational/literary
contexts, use stronger model». Bok-chatten, mønsteret denne ruta kopierer, kjører
altså på gpt-5.4. Ved å bygge prompten selv går ruta utenom den ruteren, og arvet
dermed ikke valget.

To følger av det:

- **Parameterformen er en annen.** `gpt-5.4` matcher `isReasoningModel`, som krever
  `max_completion_tokens` og **ingen** egendefinert temperatur. Den opprinnelige
  `temperature: 0.7` ville gitt 400 fra OpenAI. Ruta bruker nå `completionTuning`
  fra `model-tuning.ts`, som allerede er testet for gpt-5.4.
- **`WRITING_CHAT_MODEL` overstyrer**, som `EKKO_ASSISTANT_MODEL` gjør for
  assistenten. Et hardkodet modellnavn er en påstand med utløpsdato.

**Sletting av prosjekt sletter ikke skrivingen.** `ON DELETE SET NULL` gjør at
dokumentene faller tilbake til notatblokka. Å slette et prosjekt skal ikke slette
månedene som ligger i det.

### Fase 2b: Rekkefølge, sammenhengende lesing og henting — FERDIG

Fase 2 leverte et rom man kunne skrive *i*, men ikke skrive *sammen*: `sortOrder`
fantes i basen uten noen måte å endre den på, så manuset var en liste sortert på
opprettelsestidspunkt.

**Rekkefølgen sendes som hele lista**, ikke som «flytt denne opp». Det gjør
operasjonen idempotent, og to raske trykk kan ikke bytte plass med hverandre — den
siste vinner og bærer hele sannheten. `applyOrder` beholder deler klienten ikke
nevnte, så en utdatert klient ikke kan miste et kapittel ut av manuset ved å
utelate det.

**Alle rader starter på `sortOrder = 0`**, og det er grunnen til at
`normalizeOrder` finnes: uten tetting ville «flytt opp» sammenlignet nuller og
ikke gjort noe. Serveren skriver bare radene som faktisk flyttet seg — en full
omskriving ville rørt `updatedAt` på hele manuset og fått alt til å se nylig
endret ut.

**Sammenhengende lesing** (`compileManuscript`) setter delene sammen i rekkefølge
med ordtelling. Tomme deler tas med i oversikten — en scene uten tekst er en scene
du ikke har skrevet ennå — men bidrar ikke med tekst, ellers ville lesingen fått
hull av blanke overskrifter.

**Henting fra notatblokka** setter `projectId` på et fritt dokument gjennom
`/api/notater`. Ingen kopi, ingen ny skrivevei.

Manus-fanen er en egen domenekomponent (`components/domain/writing/ManuscriptTab`)
framfor mer markup i ruta. Flyttingen er optimistisk med rulling tilbake ved feil;
pilene ville ellers føltes trege nok til at man trykker to ganger.

20 nye tester.

### Fase 5: Chat-verktøy og «Skriving» som tema — FERDIG

To hull ble synlige da brukeren spurte «blir dette et tema?».

**Chatten var blind for hele domenet.** Det smale kontekstmodus i
`/api/skriveprosjekt/[id]/lesing` dekker samtalen *om* en tekst, men ingen verktøy
så `writing_docs` eller `writing_projects` — «hva skrev jeg i går», «hvem er Ida»
og «hvor langt har jeg kommet» hadde ingen kilde fra vanlig chat.

`query_writing` dekker tre spørsmålsformer: `projects` (ordtelling og streak),
`documents` (nyeste først) og `search` (semantisk, gjenbruker `searchDocs`).
Beskrivelsen avgrenser eksplisitt mot naboene, siden `query_food` mot
`query_nutrition` er repoets kjente eksempel på to verktøy modellen blander:
dette dekker tekst man **redigerer**, `query_reflections` dekker tidsstemplet
**fangst**. Samme skille som tabellene.

**Begrunnelsen for å velge bort tema i fase 2 var feil.** Jeg avviste det fordi
`resolveThemeDashboardKind` gjør delstreng-matching på termer ≥5 tegn og «skriv»
er akkurat 5. Men regelen (`theme-dashboard-registry.ts:368`) er
`words.some((w) => w === t) || (t.length >= 5 && normalized.includes(t))` —
**eksakt ordmatch gjelder alltid**, delstreng er et tillegg. Et tema som heter
«Skriving» treffer uansett. Risikoen gjaldt bare hvilken term jeg valgte, ikke om
tema var mulig.

Den ekte kostnaden ved å stå utenfor var navigasjon: temaer er hjemskjermens
fliser, mens en toppnivå-rute bare fikk et ikon i tittellinja.

`DashboardKind: 'writing'` med termene `skriving`, `skriveprosjekt`,
`forfatterskap` og `notatblokk` — alle ≥8 tegn, så «Beskrivelse» ikke kapres.
Tester låser begge retninger.

**Dashboardet er bevisst tynt.** Det viser streak, ordtelling og prosjektliste, og
sender videre til `/skriv` og `/notater`, som eier redigeringen. Å duplisere
prosjektrommet inn i temaet ville gitt to steder å vedlikeholde samme liste —
samme arbeidsdeling som mortema mot undertema.

### Fase 3: Transkripsjon inn — UTSATT

`kind='transkripsjon'` via `transcribeAudioWithWords`. Whisper-stien og
Cloudinary-opplastingen finnes i `/books/[bookId]/transcribe`. Nedprioritert av
brukeren: det er en inngang til noe man allerede kan skrive inn.

### Fase 4: Skrivestreak og kveldsnudge — FERDIG

**Planen sa at `streak_definitions.source` trengte en ny `writing`-kilde. Det var
feil** — `sensor_event` dekker det allerede. Men forutsetningen var oversett: uten
en hendelseslogg kan ingen skrivestreak være sann. `writing_docs.updatedAt` er
mutabel og husker bare *siste* dag et dokument ble rørt, så redigerer man samme
scene mandag, tirsdag og onsdag, forsvinner mandag og tirsdag ut av streaken.

Derfor logger skriveveien nå en hendelse i `sensor_events`
(`dataType: 'writing'`, egen `manual`/`writing_log`-sensor) hver gang teksten
faktisk endres. Å flytte et dokument inn i et prosjekt eller endre status teller
ikke — det er ikke en skrivekveld. Loggingen er best-effort: den skal aldri velte
lagringen av teksten.

Fordi hendelsene ligger der, virker eksisterende streak-maskineri uten endring:
en definisjon med `source: { kind: 'sensor_event', dataType: 'writing' }` gir
flisen blant de andre streakene.

**Streaken på `/skriv` krever likevel ikke oppsett.** `writingStreakDays` regner
dager på rad direkte fra dagsnøklene, fordi en streak som først blir sann når
brukeren har opprettet en definisjon ikke ville vært sann den kvelden det gjaldt.
**I dag teller ikke som brudd** — kvelden er ikke over, og en streak som viste 0
hele formiddagen ville vært feil hver eneste dag.

**Nudgen** (`domain/writing/exercise.ts`, 20 tester) rangerer som planlagt:
prosjektbundet → fri → ingenting. `MAX_PROJECT_RUN` tvinger variasjon etter tre
prosjektbundne på rad, og bare den *ledende* serien teller — en fri øvelse i
mellomtiden nullstiller den.

To ting testene låser, fordi de er lette å brekke senere:

- **Ingen plassholder slipper ut.** Et prosjekt uten karakterer må ikke gi «skriv
  200 ord der {karakter} lyver». Malene velges i deterministisk rekkefølge, og en
  mal hoppes over når materialet den trenger mangler.
- **Øvelsen er deterministisk per dag** (seed = dagsnummer). Det gjør en
  `?force=1`-kjøring til en ekte verifisering: den gir samme øvelse som den ekte.

Nudgen holder også kjeft for brukere uten skriving og uten prosjekt
(`not-in-use`) — en kveldspush om en funksjon man ikke har tatt i bruk er spam.

**Cron-jobben er registrert i `JOBS`** (`api/cron/jobs`), hver time, med
gating på Oslo-tid i nudgen selv framfor et fast UTC-slot, siden kveldsvinduet
flytter seg med sommertid.

## Åpne spørsmål

- **Desktop-editoren er uspesifisert.** «Rolig langtekst-modus» er en retning, ikke et
  krav. Begge flatene bruker foreløpig samme `Textarea`; det er ærlig, men det er ikke
  «likeverdig på desktop» ennå.
- **Løst i fase 2b:** rekkefølgen kan endres. Det er piler, ikke dra-og-slipp —
  dra-og-slipp på tvers av mobil og desktop er en egen jobb, og piler er dessuten
  det eneste som fungerer med tastatur og skjermleser.
- **`/api/cron/fuel-nudge` er ikke registrert noe sted.** Oppdaget mens
  writing-nudge skulle registreres: endepunktet finnes og er instrumentert med
  `withCronTracking`, men står verken i `JOBS` (`api/cron/jobs`) eller i
  in-app-scheduleren. Da fyrer den aldri i prod — sultnudgen fra august er død
  kode. Ligger utenfor dette prosjektet, men bør fikses: det er én linje i
  `JOBS`.
- **Modellnavn er hardkodet 52 steder i repoet** (`gpt-4o-mini` 31, `gpt-4o` 21),
  uten noe register. `ChatModel` i `api/chat` kjenner `gpt-4.1` og `gpt-5.4`, men
  den typen er lokal til den fila, og `chat-stream-messages` sin direct-modus
  ligger fortsatt på `gpt-4o`. Konsekvensen er den som traff denne ruta: en ny
  kallsted arver ikke et valg som alt er tatt et annet sted. Et delt
  modellregister ville løst det, men det er en egen opprydding — ikke en del av
  dette prosjektet.
- **Avklart i fase 2:** plasseringen ble toppnivå-rute — se fase 2 over.

### Inngangen fra hjem

Begge rutene var i praksis uåpnelige fram til nå: Resonans har ingen global
navigasjon, og toppnivå-ruter nås fra ikonlenkene i `HomeTitleZone`. `/skriv` og
`/notater` sto ikke der, så de kunne bare nås ved å skrive URL-en.

**Én inngang, og den peker på notatblokka.** Fangst er høyfrekvent og skjer med
tjue sekunder ledig; et skriveprosjekt er noe man setter seg ned med. Det er
fangst-øyeblikket hele prosjektet er bygget for å vinne — «heller notatblokka enn
telefonen» — og da skal det være det som er ett trykk unna. Veien videre til
`/skriv` ligger på `/notater`, og `/skriv` lenker tilbake.

## Verifisering

Fase 1, 2, 2b, 4 og 5:

- `npm test` — 2 702 tester i 203 filer passerer, hvorav 93 nye i
  `src/lib/domain/writing/`
  pluss tre nye i `theme-dashboard-registry.test.ts`. Ingen eksisterende tester brøt av omskrivingen av
  `query_reflections`.
- `npm run check` — 0 feil, 0 advarsler.
- `npm run build` — fullfører (med dummy `DATABASE_URL`; containeren har ingen base).

**Ikke verifisert, og det bør gjøres før flaten regnes som ferdig:**

- **Visuell regresjon mangler baseline.** `/notater` er lagt til i
  `tests/visual/pages.spec.ts`, men baselinen kan ikke genereres uten en base å
  laste fra. Kjør `npm run test:visual:update` lokalt én gang.
- **Ingen kjøring mot ekte base.** Migrasjonen er ikke kjørt, så
  `db.query.writingDocs` og cosine-spørringene mot `writing_docs` er verifisert av
  typesjekk og build, ikke av en faktisk spørring. Kjør `npm run db:sql-migrate`
  først.
- **Kollisjonshåndteringen er enhetstestet, ikke ende-til-ende.** `checkNotStale`
  er dekket av åtte tester, men selve 409-runden (to enheter, samme dokument) er
  ikke prøvd mot en levende base.
- **Kompislesingen har aldri snakket med OpenAI herfra.** Prompten er testet som
  ren funksjon — inkludert at materialet ikke lekker inn i leser-modus — men
  SSE-runden mot `gpt-4o` er ikke kjørt. Det som mest sannsynlig røyner først er
  historikken: `getConversationHistory` henter de 20 siste meldingene *før*
  brukermeldingen skrives, og en lang tråd i én modus vil farge svaret i en annen.
  Om det blir et problem, er svaret trolig å filtrere historikken på
  `metadata.mode`.
