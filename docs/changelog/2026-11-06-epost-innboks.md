# E-post fra Gmail: scriptet som postet til en fremmed

6. november 2026.

## Hva skjedde

Apps Script-prosjektet «Resonans» i Gmail postet hvert minutt til
`https://resonans.vercel.app/api/email/inbound`, over to måneder etter at appen
flyttet til `resonans.apps.hoi.by` (se `2026-09-02-vercel-ryddet-ut.md`, som
rettet `scripts/gmail-email-sync.gs` i repoet, men ikke scriptet som faktisk
var installert). Vercel-navnet var i mellomtiden tatt av noen andre: det
sender videre til en dansk musikkside.

- Hver kjøring sendte de samme tre Deichman-påminnelsene og to Oda-kvitteringene
  (med vedlegg), med `EMAIL_WEBHOOK_SECRET` i spørrestrengen.
- Den fremmede siden svarte 404, så labelen ble aldri fjernet og alt ble sendt
  på nytt hvert minutt. Bibliotek-e-postene hadde ligget fast siden slutten av
  september.
- Ingenting i Resonans kunne si det. Feilen var bare synlig i Apps Scripts egen
  kjøringslogg.

Samme dag ble `ENDPOINT` i det installerte scriptet byttet, og de fem trådene
ble levert. **Hemmeligheten må regnes som lekket og roteres** (Coolify →
`EMAIL_WEBHOOK_SECRET`, deretter nytt script fra `/settings/sources`).

## Endringer

- **Script v2** (`$lib/server/email/apps-script-template.ts`):
  - GET mot endepunktet før noe sendes. Uten `service: 'resonans-email-inbound'`
    i svaret sendes verken innhold eller hemmelighet. Også POST-svaret må bære
    feltet, ellers regnes leveringen som feilet.
  - Hemmeligheten i `Authorization: Bearer`, ikke i URL-en. `followRedirects: false`.
  - `userEmail` er kontoen scriptet kjører som. v1 sendte bare `to`, og
    treningsfiltret går på aliaset `workout@hoi.by`.
  - HTML-innholdet sendes med, innebygde bilder er ikke lenger vedlegg, og
    vedlegg over 10 MB hoppes over med navn.
  - Etter 12 feilede forsøk flyttes tråden til `Resonans/Feilet` framfor å prøves
    for alltid.
  - `testResonans()` og `installTrigger()`, så oppsettet ikke krever klikking i
    utløser-dialogen.
- **Innboks-logg** (`email_inbound_log`, migrasjon 0079): én rad per
  Gmail-melding. Dedupe (en behandlet melding kjøres ikke igjen), delvis
  gjentakelse (regler som lyktes sist hoppes over), og synlighet. Innholdet
  lagres ikke.
- **Innstillingene sier fra** (`describeInboundHealth`): når siste e-post kom,
  hvilken scriptversjon som sendte den, og en advarsel når scriptet er eldre enn
  `CURRENT_SCRIPT_VERSION` eller ingenting har kommet på 30 dager. Siste ti
  e-poster vises med utfall og regel.
- **Regelmatching** (`$lib/server/email/inbound.ts`, testet):
  - Avsendermønsteret sjekkes også mot selve adressen. `*@oda.com`, som skjemaet
    foreslår, traff aldri `Oda <hei@oda.com>`.
  - Gjetningen «første bruker med regler» ved ukjent mottaker er fjernet. Ukjent
    mottaker er nå 422, så scriptet beholder labelen; før ble det 200 og e-posten
    forsvant.
- **Testknappen** tørrkjører mot de ekte reglene. Den gikk før gjennom
  `router.ts`, et gammelt label-oppsett som ikke var det scriptet postet til.
- **Ryddet bort:** `/api/email-inbound`, `/api/workouts/email-inbound` (Postmark-shim),
  `email/router.ts`, `email/handlers/*`, `email/types.ts` og de to `.gs`-filene i
  `scripts/`. Malen i innstillingene er eneste kilde til scriptet.
  `buildWorkoutData` bor nå i `email/workout-data.ts`.

## Beslutninger

- **Endepunktet godtar fortsatt `?token=` og v1-payloaden.** Scriptet som kjører
  nå er v1, og det skal fortsette å levere til det er byttet. Innstillingene
  maser til det er gjort.
- **Labelmønstre uten `*` matcher fortsatt som «inneholder».** Strengere matching
  ville vært riktigere, men reglene i prod er skrevet mot den gamle oppførselen.

## Kjent rest

- Ingen varsling fra monitoreringen når innboksen står stille. Innstillingene
  sier fra, men bare til den som åpner dem.
- `GET /api/email/inbound` er uautentisert med vilje og avslører bare at
  tjenesten finnes og hvilken scriptversjon som gjelder.

## Biblioteket (samme dag)

Deichman sender fire typer: påminnelse om forfall, purring, 2. purring og
hentemelding. Gmail-filtret tok bare påminnelsene (`subject:Forfall`), og er nå
`subject:(forfall OR purring OR hentemelding)`. Prosessoren leste bare den første
tittelen, hoppet over purringer (de har ingen dato) og lagde et nytt punkt ved
hver fornyelse.

- Parseren bor rent i `$lib/domain/library-email.ts` (testet, også det gamle
  formatet fra før mars 2026).
- Ett punkt per lån i «Bibliotek-bøker», nøklet på strekkoden. En fornyelse
  flytter punktet og dagspunktet.
- Purring → dagens liste; 2. purring nevner gebyret.
- Hentemelding → «Hent: tittel på Bøler (nr. 13)» med hentefrist, på dagens liste.
  En senere påminnelse for samme strekkode lukker hentepunktet.
- Dagspunktet har `linkedChecklistItemId` mot bibliotekspunktet, så én avkryssing
  holder.

## Skolemeldinger fra appen (samme dag)

Skolen sender ikke lenger e-post. Ukeplanen deles fra skoleappen som PDF og sendes
fra brukeren til seg selv (emne = filnavnet, tom tekst). Da står verken skole
eller barn i avsenderen, og planen sier «Ukeplan 46 2B», ikke navnet.

- `$lib/domain/school-grade.ts` (testet): trinn fra fødselsdato (skoleåret starter
  1. august; født 2019 → 2. trinn 2026/27), trinn fra tekst («2B», «2. trinn») og
  barnet som går på trinnet, bare når det er entydig.
- Prompten får barna med trinn («Erle (2. trinn)») og returnerer `trinn`.
  Rekkefølgen for person: navnet i funnet → fast person på regelen → barnet på
  trinnet → ingen.
- Testet mot ukeplan uke 46: «2B» → trinn 2 → riktig barn på alle seks funn.

Kjent rest: lekser og andre funn uten dato havner bare i oppsummeringen, ikke
på ukelista. Tidlig eller sen skolestart krever fast person på regelen.
