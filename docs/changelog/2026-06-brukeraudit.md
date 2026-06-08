# Brukeraudit: Hvordan Resonans faktisk brukes

Dato: 2026-06-08
Status: ferdig

## Kontekst

Etter å ha bygget test-infrastruktur og monitorering, kartla vi hvordan eieren faktisk bruker appen til daglig — for å prioritere hva som bør forbedres.

## Bruksmønster

| Område | Frekvens | Detaljer |
|--------|----------|---------|
| Helse-dashboard | Daglig | Kjernebruk. Withings-data, treningsbelastning, søvn, vekt. |
| Ekko (iOS) | Aktivt | Logger økter, bruker treningsprogrammer, GPS-tracking. |
| Daglig sjekkliste | Daglig | Primært berøringspunkt. Sjekker av oppgaver, autocheck mot trening. |
| Familie/Spond | Jevnlig | Barnas aktiviteter, ferieplanlegging. |
| Økonomi | Sjelden | SB1 tilkoblet men brukes ikke til aktiv styring. |
| Egenfrekvens | Falt av | Prøvd men ikke sticky — mangler trigger. |
| AI-chat | Sjelden | Ikke klart å flytte inn fra ChatGPT. Brukt litt innen noen domener. |
| Nudges | Delvis | Push for løp/veiing fungerer. Google Chat-nudges leverer ikke. Mangler strukturert daglig push. |

## Nøkkelinnsikter

### 1. Nudges er nøkkelen til aktivering

Egenfrekvens og økonomi har god infrastruktur men mangler det daglige dyttet. Push-notifikasjoner for trening/veiing fungerer — samme mønster bør utvides til:
- Morgen-push: "Planlegg dagen" med lenke til sjekklisten
- Egenfrekvens-push: Daglig innsjekk-påminnelse
- Økonomi-push: Ukentlig forbruksoppsummering

Google Chat-nudges er bygget (`NudgeOrchestrationService`, 8+ typer registrert) men leverer tydeligvis ikke til bruker. Må undersøkes — trolig manglende webhook-konfigurasjon eller routing.

### 2. AI-chatten trenger kontekst for å slå ChatGPT

Chatten konkurrerer med ChatGPT og taper fordi den ikke utnytter det den vet. 12 signaler produseres (treningsbelastning, budsjettpress, feriehuller, rutine-adherence) men injiseres ikke i `buildModularSystemPrompt`. Chatten bør *vite* ting ChatGPT ikke kan:

- "Du har trent tungt 3 dager på rad — vurder en rolig dag"
- "Forbruket denne uken er 40% over snitt"
- "Ingen dekning for barna 15.–17. juli"

### 3. Sjekklisten er det daglige berøringspunktet

Brukeren er i sjekklisten hver dag. Det er stedet der kryss-domene innsikter bør surfaceres — ikke som separate dashboards man må navigere til:
- Egenfrekvens-prompt som del av morgensjekklisten
- Treningsbelastning-varsel i dagsvisningen
- Forbruksstatus som kontekst i ukenotatet

## Teknisk status per funksjon

### Fungerer godt (daglig bruk)
- Withings-sync → sensor_events → aggregater → helse-dashboard
- Ekko ↔ Resonans: treningsprogrammer, GPS, effort-scoring
- Sjekkliste med autocheck mot treningsøkter
- Spond-sync → familieaktiviteter → feriedashboard

### Infrastruktur klar, men ikke aktivert
- **Signal-til-prompt**: 12 produsenter, 0 konsumenter i AI-prompten
- **Google Chat nudges**: Orkestrering bygget, levering feiler
- **Økonomi-innsikt**: Kategorisering + lønnsdeteksjon fungerer, ingen proaktiv surfacing
- **Egenfrekvens**: Komplett flyt, mangler daglig push-trigger

### Mangler
- Signal-injeksjon i `buildModularSystemPrompt`
- Strukturerte push-nudges (morgen, kveld, ukentlig)
- Kryss-domene kontekst i sjekklisten
- Jobb-domene (fokusøkter, quick wins)

## Oppfølgingssamtale (samme dag)

### Sjekkliste/oppgaver er hovedsatsingen
Brukeren bygger aktivt ut hierarkiet tasklist → taskgroup → rutiner → prosjekter. Oppgaver berikes med klokkeslett, deadline, mentions, auto-check. Målet er å senke friksjon og bygge personlig kontekst gjennom den daglige kontaktflaten. Rutiner er spesielt lovende. Prosjekter trenger mer arbeid.

### Chat fungerer når konteksten er smal og rik
Bok-chat med AI-kuratert kontekst (boken, klipp, leselogg) har vært den beste chat-opplevelsen. Generell chat og planlegging-chat har vært blandede. Mønsteret: gi hvert domene sin "bok-chat-opplevelse" — helse-chat som vet om dine siste økter, økonomi-chat som vet om forbruksmønsteret, ikke en generalist som vet litt om alt.

### Samtalen er verdifull — oppsummeringen er det ikke
Brukeren opplever frustrasjon når refleksjoner i chat komprimeres til ufullstendige to-setningers oppsummeringer. Det som skrives i chat bør behandles som førsteklasses data. Oppsummeringer bør være indeks, ikke erstatning.

### Push bør være rike og kontekstuelle
Ikke bare statusvarsler, men signal-drevne meldinger med inngang til chat: "Nå løp du fort — ny PR?" eller "Vekta har stagnert, skal vi prate om inntak?"

### Egenfrekvens trenger redesign
Nåværende fast morgen/kveld-modell er ikke sticky. Brukeren tenker på situasjonsavhengige mikro-sjekkins: "Hvordan gikk jobb?" (16:15), "Hvordan gikk ettermiddagen?" (19:15), "Hvordan sov du?" (07:00). Tas som eget prosjekt.

## Anbefalte neste steg (prioritert)

1. **Injiser signaler i AI-prompt** — la chatten vite om treningsbelastning, budsjettpress, feriehuller. Viktigste enkeltgrep for å gjøre chatten nyttig.
2. **Rikere push-meldinger** — signal-drevne, kontekstuelle, med inngang til domene-chat.
3. **Kontekstkuraterte domene-samtaler** — bygg "bok-chat-opplevelsen" for helse, økonomi, familie.
4. **Bevar samtale-rikdom** — chat-refleksjoner som førsteklasses data, ikke bare oppsummerings-input.
5. **Egenfrekvens redesign** — situasjonsavhengige mikro-sjekkins som eget prosjekt.
6. **Surfac signaler i sjekklisten** — vis relevante innsikter der brukeren allerede er.
