# En stille coach som ser frisk ut

Dato: 2026-08-24
Status: ferdig

## Kontekst

Felttest: 8 km på 54 minutter, i et område med notorisk dårlig dekning — altså en bevisst
stresstest av reconnect-veien. Opplevelsen var «fin coaching et stykke, og så slo den over på
regelcoach etter et stykke».

Diagnoseloggen viser noe verre enn et fall tilbake til regelcoachen. Live var **oppe** hele
veien.

## Målingen

Fra økta 14:37–15:28 (`gemini-3.1-flash-live-preview`, tone `vennlig`, stemme `Puck`):

- 14:40–14:43: hendelser sendes, modellen svarer, alt som det skal.
- 14:43:12 `sender hendelse: periodisk-status` → 14:43:16 `watchdog: ingen lyd på 4 s →
  regelcoach-frase`. Socketen var i ferd med å dø.
- 14:44:03 brudd. Deretter **34 reetableringer** til 15:28, hver med `setup ferdig — kanalen er
  åpen` og `Live-coachen er klar`.
- Og etter 14:43:12: **ingen `sender hendelse` i det hele tatt.** Nedlasta står stille på
  0,54 MB i 45 minutter. Ingen statuspuls, ingen bakker, ingen runder.

## Årsaken

`inFlightTurnId` i `LiveCoachBridge` ryddes bare to steder: `finishTurn()`, som kalles på
`turnComplete` fra modellen, og `stop()`. Dør socketen mens en tur er underveis, kommer
`turnComplete` aldri — og «en tur er underveis» blir en påstand som er sann for resten av økta.

Tre konsekvenser, alle stille:

1. `deliver()` tar coalescing-grenen for hver nye hendelse: den lagres i `pendingEvent`, som
   bare flushes i `finishTurn`.
2. `startStatusTicker` har `inFlightTurnId == nil` i vakten sin, så pulsen hopper over hver
   runde.
3. `ask()` avviser frie spørsmål av samme grunn.

Regelcoach-gulvet dekket hullet, som det skal — og det er nettopp derfor feilen er ubehagelig:
**den ser ikke ut som en feil noe sted.** Loggen viser friske tilkoblinger, appen viser en
Live-coach som er «klar», og brukeren hører en coach. Bare ikke den de valgte.

## Beslutninger

**Broen forlater turen når den mister `ready`.** Watchdog og avspillingstak kanselleres,
tur-tilstanden nullstilles, og linja `forlater turen — socketen døde før svaret` skrives.
Ryddingen skjer i tilstandshåndtereren, ikke i reconnect-koden: det er tapet av `ready` som er
hendelsen, uansett hvorfor den skjedde.

**Den ventende hendelsen kastes, den sendes ikke ved gjenoppkobling.** En bakkeinngang fra fire
minutter siden er ikke en beskjed lenger, den er en feil — og stedbundne meldinger er nettopp de
som ikke tåler forsinkelse. Loggen navngir det som ble kastet (`kaster ventende bakke-inngang`),
fordi «noe ble kastet» ikke kan feilsøkes.

**Linja er stille når det ikke var noe å forlate.** 3.1 lukker med 1008 hvert tredje minutt —
femten ganger på en økt — og en logglinje per brudd om en tur som ikke fantes ville begravd de
linjene som betyr noe.

## Fase 2: stemmevalget som ble forkastet av et dekningshull

Samme logg avslørte en feil innført dagen før, i stemmevelgeren.

`shouldAbandonVoice` så bare på «kom setupet i mål?». På denne turen ble `Puck` godtatt **tre
ganger** (14:40:03, 14:44:05, 14:46:41) og deretter forkastet 14:50:15 — fordi socketen timet ut
i et dekningshull. Brukeren mistet stemmen sin i tretti minutter for en feil som ikke fantes.

Regelen har nå tre vilkår: setupet kom ikke i mål, stemmen har **aldri** blitt godtatt i økta, og
socketen lukket med en **protokollkode**. Det siste er skillet som mangler i en bar
nettverksfeil: en avvist setup får en ekte close-frame (1007 «not supported for this model
configuration», 1008), mens et dekningshull river forbindelsen uten at noen legger på. Uten det
er «Google nektet stemmen» og «vi mistet nettet» samme hendelse — og på en løpetur i dårlig
dekning er den andre regelen.

Kostnaden ved å være streng er en runde ekstra for en stemme som faktisk er ugyldig, men der
første forsøk tilfeldigvis døde uten close-frame. Den runden koster et par sekunder; den motsatte
feilen kostet en hel tur.

## Det som virket

Verdt å notere, siden turen var en stresstest:

- **Tone og stemme nådde fram.** `tone: vennlig (valgt: vennlig)` og `stemme: Puck` i loggen —
  begge nye i går, begge verifisert i felt. Ekkoet gjorde `Puck`-feilen mulig å se.
- **Token-gjenbruken holdt.** `gjenbruker tokenet (ingen ny mint)` gjennom hele økta; ingen
  ratelimit, tross 34 reetableringer.
- **Den vedvarende reconnect-stigen gjorde jobben.** To fullstendige utfall (14:50–14:57 og
  15:00–15:04, altså 7 og 4 minutter uten nett) endte begge med at Live kom tilbake av seg selv.
  Med assistentens korte stige — tre forsøk på 3,5 sekunder — ville økta vært over.
- **Slusen holdt igjen som den skal**, med de nye gulvene per kategori: `slusen holdt igjen
  periodisk-status — 2 s til gulvet` mens hendelser slapp gjennom.

## Verifisering

Fire nye tester på den forlatte turens logglinje, seks på stemmereglen (inkludert feilen fra
denne turen, i testform). **Swift-koden er ikke kompilert** — Actions-workflowen for Ekko er
slettet, og Xcode Cloud kjører ikke testmålet før et delt schema ligger i repoet.

Selve fiksen kan bare bekreftes på en ny tur i samme område. Det som skal stå i loggen da:
`forlater turen — socketen døde før svaret` ved bruddet, og `sender hendelse` som fortsetter
etterpå.
