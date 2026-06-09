# PWA: oppdage og hente nye deploys i kjørende økter

Dato: 2026-06-09
Status: ferdig

## Kontekst

Service worker-fundamentet var sunt (HTML caches ikke, versjons-nøklede cacher, skipWaiting/claim,
immutable chunks overlatt til HTTP-cache), men en langlevd PWA-økt fikk aldri vite om nye deploys:
ingen versjonspolling, ingenting som lyttet på `updated`, ingenting som kalte
`registration.update()`. På telefon kunne appen kjøre gammel frontend i dagevis til OS-et drepte
prosessen eller en chunk-last feilet.

## Endringer

- `svelte.config.js`: `kit.version.pollInterval = 60_000` — klienten poller `_app/version.json`
  hvert minutt i aktive økter.
- `src/routes/+layout.svelte`:
  - `beforeNavigate`: når `updated.current` er satt blir neste klient-navigasjon en full sidelast
    (`location.href = to.url.href`) — vi prøver aldri å laste chunks fra en utdatert build.
  - `visibilitychange`: ved forgrunning kalles `registration.update()` (SW-en sjekker seg selv) og
    `updated.check()`. Har appen vært i bakgrunnen i over 30 minutter og ny versjon finnes,
    reloades siden umiddelbart — brukeren har ikke rukket å starte på noe, og «åpne appen om
    morgenen»-gesten gir alltid fersk frontend. Korte app-bytter reloader aldri (utkast bevares).

## Beslutninger

- **30 minutters terskel** for auto-reload ved forgrunning: balanserer «alltid fersk ved
  dagens første åpning» mot «aldri mist tekst under et raskt app-bytte».
- Ingen «ny versjon»-toast — reload ved navigasjon/forgrunning er usynlig nok i denne appen.

## Verifisering

- `npm run check` grønn for de endrede filene; røyktest i dev med simulert
  `visibilitychange` (hidden → visible) ga ingen runtime-feil.
- Selve versjonsbyttet kan først observeres over to ekte deploys (dev kjører alltid samme versjon);
  mønsteret er SvelteKit-dokumentasjonens anbefalte bruk av `updated`.
