# Bil-assistent: nå-kontekst og skarpere system-prompt

Dato: 2026-06-24
Status: ferdig

## Kontekst

Brukertest av bil-/Ekko-assistenten (`/api/apps/assistant`) avdekket to ting som fikk den til å
føles «dum som et brød»:

1. **Feil årstall.** På «hvilken dato er det i dag?» svarte den «6. november 2023». Assistenten
   fikk aldri injisert nåtid, så modellen falt tilbake på treningsdataen sin og gjettet feil.
   Til sammenligning injiserer hovedchatten (`/api/chat`) en `DAGENS DATO`-blokk.
2. **Vage ikke-svar.** På åpne spørsmål («hva bør jeg prioritere i morgen?») ga den generell
   filler i stedet for å hente kontekst via verktøyene den faktisk har, og på spørsmål utenfor
   rekkevidde svarte den bare «jeg har ikke tilgang» uten å peke på hva den kan hjelpe med.

## Faser

### Fase 1: Nå-kontekst i Oslo-tid
`src/lib/server/assistant/assistant.ts`: ny `buildTimeContext(now)` som bygger en talevennlig
nå-blokk (ukedag, dato, klokkeslett, ISO) i `Europe/Oslo` via `localHm`/`localIsoDay` fra
`nudge-time`. Injiseres som egen system-melding rett etter hovedprompten i `buildAssistantMessages`,
så både strømmende og ikke-strømmende vei får den. Colocated test i `time-context.test.ts`
verifiserer riktig dato/ukedag og at Oslo-tid (ikke serverens UTC) brukes ved døgnskifte.

### Fase 2: Skarpere system-prompt
Samme fil: system-prompten lister nå eksplisitt hva assistenten kan hente (trening, dag/sted, bil),
ber den hente kontekst FØR den svarer på vage spørsmål, og ber den ved spørsmål utenfor rekkevidde
(kjøreavstand, vær, alder på familie) peke på hva den faktisk kan hjelpe med — i stedet for et bart
«jeg har ikke tilgang».

## Beslutninger

- **Hardkodet `Europe/Oslo`** i stedet for et ekstra DB-oppslag for brukerens tidssone i
  varm-stien. Appen er enbruker/norsk; `gatherDayContext` faller uansett tilbake på Oslo.
- **Ingen nye verktøy.** Brukertesten viste at eksisterende verktøy (teslaState, program*) virker;
  problemet var manglende forankring og svak prompt, ikke manglende data. Navigasjon/vær er reelle
  hull, men egne, større oppgaver.

## Verifisering

`npm test` → 714 tester grønne (inkl. 2 nye for `buildTimeContext`).
