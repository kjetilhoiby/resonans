# App-callbacken krever en ekte innlogging

Dato: 2026-09-27
Status: ferdig (ikke verifisert mot prod)

## Kontekst

`/api/apps/callback` er siste ledd i Ekkos innlogging (`/api/apps/authorize` →
`/auth` med Google → callback), og utsteder en `rsn_`-hemmelighet som sendes til
appen i `ekko://auth?secret=…`. Stien står i `PUBLIC_API_PREFIXES`, så
`authorizationHandle` sjekker ingenting — endepunktet må selv avgjøre hvem
hemmeligheten gjelder.

Det kalte `resolveRequestUserId`, som faller tilbake på `?userId=` og
`resonans_user_id`-cookien **uten dev-gate** (bare headeren var låst av
`isUserHeaderTrusted`). 401-grenen slo bare til når header, query OG cookie alle
manglet. Funnet ved kodelesing:

- `GET /api/apps/callback?app=ekko&userId=<uuid>` uten innlogging ga en
  fungerende API-hemmelighet for den brukeren. Hovedbrukerens uuid står i
  klartekst i `playwright.config.ts`, og repoet er offentlig.
- Fallbacken kaller `ensureUser`, så en VILKÅRLIG id opprettet en bruker forbi
  allowlisten og fikk en hemmelighet til den.

## Faser

### Fase 1: callbacken leser bare økta

- `src/lib/server/request-user-sources.ts` (ny, ren):
  `sessionUserIdForAppCallback(session)` — økta, og ingenting annet, heller ikke
  i dev. `pickFallbackUserId` og `sanitizeUserId` flyttet hit.
- `src/routes/api/apps/callback/+server.ts`: bruker den nye funksjonen, og logger
  én `[apps-callback]`-linje per utstedt hemmelighet.

### Fase 2: query og cookie er aldri bevis utenfor dev

`resolveRequestUserId` leser `?userId=` og cookien bare når `dev`. På gatede
stier var fallbacken alt uoppnåelig i prod (økt og API-hemmelighet vinner, og
gaten krever en av dem eller en betrodd header), så dette endrer ingen legitim
flyt — det gjør bare at neste offentlige sti som kaller funksjonen ikke arver
hullet.

## Beslutninger

- **Ingen fallback i callbacken, heller ikke i dev.** En sti som UTSTEDER
  legitimasjon skal ikke ha en kodevei der noe annet enn en innlogging avgjør
  hvem den gjelder.
- **Kildetest på ruta** (`request-user-sources.test.ts`): feiler hvis
  `resolveRequestUserId(` kommer tilbake i callbacken.
- Kjent rest: callbacken har ingen `state`/PKCE. En innlogget bruker som lokkes
  til `/api/apps/authorize?app=ekko` i Safari får en hemmelighet levert til den
  appen som eier `ekko://`-skjemaet. Riktig løsning er PKCE (engangskode byttet
  mot hemmelighet med verifier), og det krever endring i Ekko.

## Verifisering

- `npm test` (5036 grønne), `npm run check` (0 feil).
- Lokal dev-server: anonym `GET /api/apps/callback?app=ekko&userId=<uuid>` → 401;
  `/api/apps/authorize?app=ekko` → 303 til `/auth?next=…callback…` som før.
  Den innloggede grenen er ikke kjørt lokalt, fordi lokal `.env` peker på en
  Neon-base og en kjøring ville mintet en ekte hemmelighet.
- Hemmeligheter som alt er utstedt: se revisjonsspørringen i PR-en/økta.
  Callbacken logget ingenting før denne endringen, så loggene kan ikke svare —
  `user_api_secrets` kan.
