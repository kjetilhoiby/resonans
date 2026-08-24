# Fire toner for Live-stemmen

Dato: 2026-08-22
Status: ferdig

## Kontekst

Etter løpeturen 19. august var tilbakemeldingen at Live-coachen fungerte godt og presenterte
tallene riktig, men at hun «kan være litt knapp». Det er ikke et teknisk problem — det er
personaen, og personaen bor på serveren nettopp for å kunne endres uten et TestFlight-bygg.

Men én stemme kan ikke være riktig for alle turer. En 5 km i fart og en to timers rolig tur
har motsatt behov: den første vil ha noen som presser, den andre vil ha noen som ikke gjør
det. Ønsket var derfor tre-fire toner å bytte mellom, der den vennlige er tenkt for lange
turer i lav fart uten press.

## Fasene

### Fase 1: Tone som egen akse (server)

`COACH_TONES = ['krevende', 'noytral', 'vennlig', 'stille']` i
`$lib/domain/ai/gemini-live-profiles.ts`. `personaForProfile(profile, tone)` setter sammen en
base + et tonetillegg; `resolveCoachTone` tar imot råverdien fra appen.
`POST /api/apps/gemini/ephemeral-token` godtar `tone` i kroppen, ekkoer den i `persona.tone`,
og logger den ved siden av modellen.

### Fase 2: Valget i appen (Ekko)

`CoachTone`/`CoachToneSetting` (`Services/CoachToneSetting.swift`), en velger i
**Innstillinger → Lydcoaching → Tone**, og lesing inne i
`ResonansAPI.geminiEphemeralToken` — samme grep som modell-overstyringen, så både
assistenten og coachen får tonen uten at kallstedene røres. Diagnoseloggen skriver
`tone: vennlig (valgt: vennlig)` per tilkobling.

## Beslutninger

**Tone er ortogonal til profil.** Profilen bestemmer hva tokenet får GJØRE
(verktøyskjemaene, altså sikkerhetsgrensa), tonen hvordan det LYDER. Var de samme akse,
ville fire toner × tre profiler blitt tolv verktøyskjemaer å holde i sync — og et skjema som
driver fra appens parser er nøyaktig feilen fra 17. august, der «elsykkel» manglet i
verdilista og økta ble løping.

**Grunnreglene tilhører basen, aldri tonen.** «Siter tallene ordrett», «bekreft muntlig før
du handler», «unngå ordet ekko» og «ingen påstander om helse» står i basen for alle toner, og
en tone kan bare legge til stil. Kunne en tone overstyre dem, ville en innstilling vært en
vei til å prompte bort en sikkerhetsregel — og «Krevende» ville gjort det først, siden press
er nettopp det som frister til å love noe om kroppen. Det er testet per tone, ikke antatt.

**Ukjent tone gir ikke 400.** Det er motsatt av `startWorkout.type`, som avviser en oppgitt
men ukjent verdi, og skillet er verdt å holde: **spørsmålet er om en stille default kan gjøre
noe galt.** En gjettet idrett ble en løpeøkt på en elsykkel; en gjettet tone blir bare den
forrige stemmen. Samtidig må en gammel app kunne sende ingen tone og en ny app kunne sende en
tone en gammel server ikke kjenner, uten at en økt avbrytes.

**Derfor ekkoes tonen.** Uten `persona.tone` i svaret er en skrivefeil i appens råverdi helt
stum: man hører at hun er «like nøytral som før» og tror det er prompten som ikke virker.
Appen logger valgt og ekkoet side om side, så de to forklaringene kan skilles i ettertid.

**Etikettene er bevisst duplisert til appen.** Ellers gjelder «serveren eier ordene» i dette
repoet, men en innstillingsskjerm skal virke i flymodus og på et fjell uten dekning — en
velger som må hente fire ord over nett er dårligere enn en som ikke kan drifte. Det serveren
eier er PROMPTEN, som er det man faktisk justerer etter å ha hørt den på en tur. Kontrakten
som holder sidene sammen er råverdiene, og en test i EkkoTests slår fast at de er nøyaktig
`COACH_TONES`.

**Nøkkelnavnene er ASCII** (`noytral`, ikke `nøytral`). Verdien går gjennom JSON,
UserDefaults og en logglinje, og «ø» er den bokstaven som blir et spørsmålstegn i det ene
laget ingen tester.

**Tonen styrer hvor MYE som sies, ikke hvor OFTE.** Frekvensen bor i appens
`CoachMessageGate` (gulv per kategori), så «Stille» gjør coachen kortere, ikke sjeldnere.
Innstillingsteksten sier det rett ut — å love noe annet ville vært et løfte serveren ikke kan
holde. Teksten sier også at regelcoachens fraser er kannede og tonefrie: hører man de samme
setningene som før, er det gulvet man hører.

**Standarden er `noytral`**, som er byte-nær stemmen fra før tonene fantes. En ny innstilling
skal ikke endre oppførselen for noen som ikke har valgt.

## Fase 3: Stemmen, som er en tredje ting

Spørsmålet som fulgte var om det også er serveren som setter kjønn, alder og dialekt. Svaret var
nei — og det viste seg at ingen satte dem: setup-ramma sendte ingen `speechConfig` i det hele
tatt, så Google valgte stemme selv.

Stemmen ble derfor en app-innstilling (`GeminiLiveVoice` i Ekko), ikke et felt i token-svaret.
**Tonen er ordene, stemmen er røsten**, og de to hører på hver sin side: personaen itereres
etter en tur og må kunne endres uten et bygg, mens `speechConfig` er klient-skrivbart (masken
låser bare `model,tools`) og ikke endrer seg av seg selv. Et stemmefelt i token-svaret ville
vært en andre vei inn til samme innstilling.

Tre grenser vi ikke kan flytte, og som derfor står i flatens tekst framfor å bli oppdaget:

- **Det finnes ingen katalog over gyldige Live-stemmer.** Google dokumenterer 30 for
  TTS-modellene og skriver at Live har «et litt annet sett» — for Live nevnes bare «Kore». Lista
  i appen er kandidater. Et ugyldig navn avvises i setupet, og en avvist setup er en død økt
  (samme klasse feil som 1007-en fra 2.5), så sesjonen forkaster stemmevalget og kobler til uten
  det når socketen dør før `setupComplete`. **Et feil stemmenavn skal koste en logglinje, ikke
  turen.**
- **Kjønn og alder er ikke parametere.** Google oppgir et karaktertrekk per stemme («Firm»,
  «Youthful», «Warm»), ikke kjønn. Velgeren viser trekket oversatt og påstår ikke mer — en
  gjetning om kjønn ut fra hvordan et navn høres ut, ville vært samme feil som en stille default
  som gjetter en konkret verdi.
- **Dialekt kan ikke velges.** Native-audio-modellene «velger språk automatisk og støtter ikke å
  sette språkkode eksplisitt», og aksenten følger stemmemodellen. En prompt som ber om østnorsk
  endrer ordvalg, ikke uttale.

## Verifisering

`npm test`: 3632 tester i 260 filer passerer, inkludert åtte nye på tonene — at ukjente
verdier faller til nøytral, at alle fire gir merkbart ulike preambler, at grunnreglene og
helse-forbudet står i alle fire, og at `voice-test` er urørt.

Swift-siden (`CoachToneTests.swift`, sju tester) er **ikke kompilert** — Actions-workflowen
for Ekko er slettet 22. august (macOS-minutter koster 10× på et privat repo), og Xcode Cloud
kjører ikke testmålet før et delt schema finnes i repoet.

Selve tonene kan bare bedømmes på en tur. Det er hele poenget med at de bor på serveren:
høres «vennlig» fortsatt ut som en trener, er det en setning som skal endres, ikke et bygg
som skal lages.
