# Referansen som velger og slider

Dato: 2026-09-04
Status: ferdig

## Kontekst

To tallfelt for tempo-referansen krevde at brukeren visste sin egen PR i
sekunder. Etter at placeholder-fella var rettet
(`2026-09-04-importkortet-loy-om-tempokontrollen.md`) sto feltene tomme og
riktige, men fortsatt upraktiske: «3120» er ikke en tid noen har i hodet.

## Faser

### Fase 1: Lukket distanseliste

`PACE_REFERENCE_DISTANCES` i `import-triage.ts`: 3 km, 5 km, 10 km,
halvmaraton (21 097 m).

Lukket, ikke et fritt tall, og det er en presisjonsbeslutning: referansen skal
være en distanse man HAR en tid på. Et fritt felt inviterte til «4000 m» fra en
tilfeldig treningsøkt, som ikke er en PR og derfor ikke en referanse.

### Fase 2: Slider med grenser som følger distansen

`paceReferenceSliderRange(distanceMeters)`. Båndet er **tempo** (3:00–9:00/km),
ikke tid — et fast tidsbånd ville gitt en halvmaraton på tjue minutter i nedre
ende, og et som passer halvmaraton ville gjort hvert piksel på 3 km til et
minutt.

Målt for de fire distansene:

| Distanse | Bånd | Steg | Posisjoner |
|---|---|---|---|
| 3 km | 9:00–27:00 | 5 s | 216 |
| 5 km | 15:00–45:00 | 10 s | 180 |
| 10 km | 30:00–1:30:00 | 15 s | 240 |
| Halvmaraton | 1:03:30–3:09:30 | 30 s | 252 |

Brukerens egen mil (52:00) ligger 37 % inn i 10 km-båndet og er eksakt
treffbar med 15-sekundssteget.

### Fase 3: Avlesningen

Tiden STOR (1,6 rem), tempoet under. Tiden er det man husker; tempoet er det
som gjør den etterprøvbar — «52:00» kan man ta feil av, «5:12/km» kjenner man
igjen som sitt eget. Under slideren står begge ender og steglengden.

## Beslutninger

- **Slideren teller ikke som satt før den er rørt** (`timeSet`). Den MÅ stå et
  sted visuelt, men den posisjonen er VÅR. Regnet vi den som satt, ville
  tempo-kontrollen slått seg på med et tall vi valgte — samme feil som
  placeholderne «10000» og «3120», bare vanskeligere å oppdage: da så feltet
  tomt ut mens kontrollen var av, nå ville det sett satt ut mens kontrollen var
  på med en gjetning.
- **Bytte av distanse NULLER tiden.** 52:00 er en mil, ikke en halvmaraton. Ble
  tiden stående, ville et bytte fra 10 km til halvmaraton gitt en referanse på
  2:28/km — en kurve som holder nesten hele arkivet ute.
- **Taket på posisjoner (260) er en presisjon vi kan gi bort.** Porten
  sammenligner mot en Riegel-kurve med 10 % margin, så ±30 sekunder på en
  halvmaratontid flytter ingen dom. En slider med tusen posisjoner kan ikke
  treffes med en tomme.
- **`formatPace` gjenbrukes** fra `$lib/utils/activity-metrics` — en fjerde
  tempoformatterer i repoet ville drevet fra de tre andre.
- **Grensene bor i domenelaget**, ikke i kortet: de utledes av distansen og kan
  være feil, altså skal de kunne testes.

### Sporet måtte tegnes selv, og det ble målt

`accent-color` farger tomlen og fyllet, men lar SPORET stå i nettleserens lyse
standard — som lyser på en alltid-mørk flate. `color-scheme: dark` rørte det
ikke (målt i Chromium). Styrer man sporet, forsvinner fyllet. Løsningen er en
gradient med fyllgraden som CSS-variabel (`--fill`, regnet i `sliderFill`), som
gir både mørkt spor og synlig fyll — med kortets egne variabler, ikke faste
farger.

## Verifisering

- `npm test`: 4515 tester i 312 filer, alle grønne. 12 nye på
  `paceReferenceSliderRange` og `sliderMidpoint` (bånd følger distansen,
  brukerens mil er innenfor, taket på posisjoner holder for alle fire, grensene
  snapper til steget, grovere steg for lengre distanser).
- `npm run check`: 0 feil, 0 advarsler.
- **Rendret i nettleser** gjennom en midlertidig rute under `/design`
  (offentlig sti), drevet med Playwright mot `/opt/pw-browsers/chromium`:
  velgeren finnes ikke før en zip er valgt; 10 km gir «– – : – –» og «Dra for å
  sette tiden»; slideren til 3120 s gir «52:00 / 5:12 /km» og den grønne linja;
  bytte til halvmaraton nuller tiden og flytter båndet til 1:03:30–3:09:30.
  Ingen JS-feil. Fargene målt, ikke bedømt: `--text-primary` er `rgb(238,238,238)`
  inne i `AppPage`.
- Ruta er slettet igjen — den var et verktøy, ikke en flate.

## Kjent rest

- **Filvelgeren er nettleserens standard** og sier «Choose File» på engelsk midt
  i en norsk flate. Den sto der før denne endringen. Å style den krever
  label + skjult input, som flytter klikkflaten og `data-track`-etiketten — en
  egen endring.
- Referansen huskes ikke mellom kjøringer.
- Kortet har ingen visuell regresjonstest. `/design`-galleriet dekker
  komponenter, ikke settings-kort, og å legge det inn der er et nytt mønster
  for galleriet.
