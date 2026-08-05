# Kroppsprofil i innstillingene

Dato: 2026-08-04
Status: ferdig

## Kontekst

`estimateDailyExpenditure` returnerer **null** uten en komplett kroppsprofil — vi
gjetter ikke på kroppshøyde, fordi et forbrukstall bygget på en antatt høyde ser like
troverdig ut som et ekte. Men profilen fantes bare som endepunkt
(`PUT /api/helse/profil`), satt med curl under utviklingen. For alle andre betyr det at
energibalansen stille faller tilbake til Withings' `totalCalories` — nettopp det tallet
som viste seg upålitelig i august (`calories`-feltet krediterte 52 minutter el-sykkel
med 1 460 kcal).

Profilsiden hadde allerede en plassholder som sa det: «Høyde og kjønn — ikke modellert i
brukerprofil enda.»

## Faser

### Fase 1: Feltlogikken ut i domenelaget

`src/lib/domain/health/body-profile-fields.ts` *(ny)* med grensene
(`HEIGHT_MIN_CM`/`MAX`, `DESK_FACTOR_MIN`/`MAX`), `birthYearFromDate`,
`isPlausibleBirthYear`, `ageFromBirthYear`, `missingProfileFields`, `validateHeightCm`
og `validateDeskJobFactor`. 14 tester.

Tre lag trengte samme regler: endepunktet validerer, `readBodyProfile` leser, og
innstillingsflaten viser hva som gjenstår. Duplisert ville grensene sprikt, og et felt
som godtas av flaten men avvises av endepunktet er den verste varianten. `PUT
/api/helse/profil` og `body-profile.ts` bruker nå de samme funksjonene, så feilmeldingen
er ordrett den samme.

`ageFromBirthYear` flyttet fra serverlaget hit og re-eksporteres derfra, slik at
`nutrition-dashboard` ikke måtte endres.

### Fase 2: Fødselsåret får én kilde

`readBodyProfile` faller nå tilbake til self-personens `birthDate` når
`metricSettings.profile.birthYear` ikke er satt, og returnerer `birthYearSource`.

### Fase 3: Kortet

`src/lib/components/domain/health/BodyProfileCard.svelte` *(ny)*, montert i
`/settings/profile` der plassholderen sto. Høyde, kjønn og aktivitetsfaktor, med
hvileforbrenningen regnet live.

`Input.svelte` fikk `inputmode` og `dataTrack`. Det første fordi `type="number"` alene
ikke gir talltastatur på iOS; det andre fordi brukslogging krever `data-track` på
tekstfelt, og komponenten ikke støttet det — alle 61 eksisterende `data-track`-felt
brukte rå `<input>` for å komme rundt det.

### Fase 4: Oversikten sier fra

`/settings` laster `bodyProfile.complete` og viser «Mangler kroppsprofil —
energibalansen bruker Withings i mellomtiden» med gul prikk. En manglende profil er
ellers *stille*: flaten ser like ferdig ut, bare med et dårligere tall.

## Beslutninger

### Fødselsår spørres ikke om i kroppsprofilen

Fødselsdato bor allerede på self-personen, der den driver årskavalkaden og
selvangivelse-fristen. Et eget fødselsårsfelt i kroppsprofilen ville vært to felt for
samme faktum — og to sannheter så snart bare ett rettes.

Derfor: `metricSettings.profile.birthYear` er en **overstyring** som vinner når den
finnes, ellers utledes året av fødselsdatoen. Mangler datoen, peker kortet til
Profil-kortet over framfor å tilby et nytt felt.

Året, ikke datoen: Mifflin-St Jeor flytter seg ~5 kcal på ett års alder, så en bursdag
senere i året er under støygulvet.

### Resultatet vises mens man skriver

Hvileforbrenning og «kontorhverdag uten trening» regnes i kortet fra samme
`basalMetabolicRate` serveren bruker. Fire tall inn og et forbrukstall ut er hele
grunnen til å fylle ut skjemaet, og et skjema som ikke viser hva det gjør blir ikke
fylt ut. Null vises på samme vilkår som serveren gir null, så kortet ikke lover et tall
flaten ikke får.

### Aktivitetsfaktoren advarer mot seg selv

Feltet sier eksplisitt at treningsøktene legges på toppen, og at en høy faktor teller
treningen to ganger. Taket er 1,9 som i endepunktet, men standardtabellenes «svært
aktiv» er feil bruk her — og et fritt felt uten den advarselen ville invitert til
dobbeltelling.

### Vekt er ikke et felt

Vekta kommer fra Withings og kan ikke skrives inn, så «mangler vekt fra Withings» er en
annen beskjed enn «mangler høyde». `missingProfileFields` tar vekt som argument framfor
som felt nettopp for å holde de to fra hverandre.

## Verifisering

- `npm run check`: 0 feil. `npm test`: 187 filer, 2418 tester (14 nye).
- I Chromium på 390 px mot lokal Postgres:
  - Kortet rendret med lagrede verdier (187 cm, Mann) og regnet 1 784 kcal hvile /
    2 230 kcal kontorhverdag fra 82 kg og 42 år.
  - Høyde `1,87` — den sannsynlige skrivefeilen — ga «Høyde må være mellom 120 og
    230 cm» og deaktivert lagreknapp.
  - Lagret 185 cm / Kvinne / 1,35 → 1 605 og 2 167 kcal, som stemmer med
    Mifflin-St Jeor for hånd. Basen fikk
    `{"sex":"female","heightCm":185,"birthYear":1984,"deskJobFactor":1.35}` — og
    `birthYear` overlevde selv om kortet ikke sender det, altså holdt
    nøkkelbevaringen i endepunktet.
  - Uten fødselsdato: «Mangler fødselsdato før hvileforbrenningen kan regnes» og en
    peker til Profil-kortet. Etter `PUT /api/profile/birthdate` med `1984-03-17`:
    «42 år, fra fødselsåret 1984. Utledet av fødselsdatoen over.»
  - `/settings`: grønn prikk med «Navn, fødselsdato, kroppsprofil og partner» når
    profilen er komplett; gul prikk med «Mangler kroppsprofil — energibalansen bruker
    Withings i mellomtiden» når `profile` er fjernet.

### Feil funnet i nettleseren, ikke i testene

Første utgave bandt `heightInput` som `string` og kalte `.trim()` på verdien.
`bind:value` mot en `type="number"` **konverterer til tall**, så siden felte med
`$.get(...).trim is not a function` — hele `/settings/profile`, ikke bare kortet.
Enhetssuiten kan strukturelt ikke se den feilklassen (den rendrer ikke Svelte), og
`npm run check` så den heller ikke, siden `Input.value` er `string | number`. Utkastene
er nå typet `string | number` med `parseNumber`/`isBlank` som tåler begge.

## Gjenstår

Makromålene fikk sitt UI samme dag: `NutritionTargetsCard` på Ernæring-flaten, med
`saveNutritionTargets` som eneste skrivevei for endepunktet, kortet og chat-verktøyet.
Se `2026-08-04-dagsmal-chat-og-ui.md`.
