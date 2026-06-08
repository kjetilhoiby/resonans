# Testing Fremdriftsregistrering

## Hvordan teste

### 1. Opprett et mål med oppgaver
I chatten, si noe som:
```
Jeg vil løpe 5 km uten pause. Det er viktig for meg fordi jeg vil ha mer energi. 
Jeg vil gjøre dette ved å løpe 3 ganger i uken.
```

AI-en skal:
- Opprette målet
- Foreslå å lage oppgaver

### 2. Be om å lage en konkret oppgave
```
Lag en oppgave for å løpe 3 ganger per uke
```

AI-en skal bruke `create_task` funksjonen.

### 3. Registrer fremgang
Si noe som:
```
Jeg løp 3 km på 18 minutter i dag!
```

AI-en skal:
- Bruke `log_progress` funksjonen
- Registrere 3 km som verdi
- Legge til "på 18 minutter" som note

Andre eksempler:
```
Trente styrke i 45 minutter
Løp 5 km på 25 min
Mediterte i 10 minutter
```

### 4. Se fremgang på Goals-siden
Gå til `/goals` og se:
- Progresjonsbarer på mål
- Progresjonsbarer på oppgaver
- Siste registreringer med datoer
- Verdier og notater

## Hva AI kan gjøre nå

✅ **Opprett mål** - `create_goal()`
✅ **Opprett oppgaver** - `create_task()`
✅ **Registrer fremgang** - `log_progress()`

AI får automatisk kontekst om:
- Alle brukerens mål
- Alle aktive oppgaver med ID-er
- Frekvens og målverdier

## Eksempel-flyt

1. **Bruker**: "Jeg vil bli bedre i form"
2. **AI**: Stiller spørsmål om mål
3. **Bruker**: "Løpe 5km uten pause på 3 måneder"
4. **AI**: Oppretter mål → foreslår oppgaver
5. **Bruker**: "Lag en oppgave for å løpe 3 ganger per uke"
6. **AI**: Oppretter oppgave "Løp 3 ganger per uke" med targetValue=3, unit="ganger per uke"
7. **Bruker**: "Løp 3km på 18 min i dag"
8. **AI**: Registrerer fremgang med value=3, note="På 18 minutter"
9. **Bruker**: Går til /goals → ser fremgang visualisert

## Neste steg (bildeanalyse)

For å få bildeanalyse av treningsapper:
- Legg til fileopplasting i chat UI
- Bruk GPT-4o Vision API
- Ekstraher data fra skjermbilder
- Registrer automatisk

Dette krever mer arbeid, men grunnlaget er på plass!
