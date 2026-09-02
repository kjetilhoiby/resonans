# Vercel ryddet ut av repoet

Dato: 2026-09-02
Status: ferdig

## Kontekst

Flyttingen til egen plattform (`docs/changelog/2026-08-24-plattformport.md`) ble
sekvensert slik at Vercel sto igjen som fallback: `svelte.config.js` valgte
adapter av miljøet, og begge adaptere ble beholdt med vilje. Begrunnelsen holdt
den gangen — en rullback som ikke kan bygges finnes bare på papiret.

Den er nå innfridd. Containeren har stått alene siden slutten av august, og
etter at `cron.yml` ble slettet 2026-09-02 kan Vercel-grenen uansett ikke kjøres
i drift uten et git revert først: den har ingen cron-klokke. En fallback som
verken bygges eller testes er ikke en fallback — den er to kodeveier å holde i
live, og den ene av dem lyver om hva som gjelder.

Det som utløste opprydningen var synlig i GitHub: Vercels GitHub-app postet
fortsatt en sjekk på hver pull request, og den var rød med «Account is blocked».

## Faser

### Fase 1: Byggekjeden

- `vercel.json` og `.vercelignore` slettet.
- `svelte.config.js` bruker `adapter-node` direkte. `DEPLOY_TARGET`-velgeren og
  `VERCEL`-utledningen er borte, og med dem `ENV DEPLOY_TARGET=node` i
  `Dockerfile` — den fantes bare for å nøytralisere en variabel byggemiljøet
  kunne sette.
- Avhengighetene ut av `package.json` og låsefila: `@sveltejs/adapter-vercel`,
  `@vercel/functions` og `vercel`-CLI-en.
- `.vercel` fjernet fra `.gitignore`, `.dockerignore` og vite-serverens
  watch-ignore.

### Fase 2: Kjøretid

- `runInBackground` bruker en ren promise på event-loopen. `waitUntil` fra
  `@vercel/functions` fantes fordi en serverless-funksjon fryses i det responsen
  går ut; under adapter-node lever prosessen videre. Prisen er en annen og står
  nå i doc-kommentaren: SIGTERM ved redeploy avbryter arbeid som ikke er ferdig,
  så noe som MÅ fullføres hører i jobbkøen.
- `appOrigin()` faller ikke lenger tilbake på `VERCEL_PROJECT_PRODUCTION_URL`.
  `ORIGIN` eller et kast — som før, minus én gren.
- `sync-db-schema.mjs` har ikke lenger `VERCEL_ENV`-vakta. Den var uansett bare
  et vern på én plattform; utenfor den var betingelsen alltid falsk. Vernet som
  gjelder overalt — utskrift av HVILKEN database som er i ferd med å endres —
  står som før.
- 25 route-filer hadde `export const config = { maxDuration: N }`. Det er
  adapter-vercel-konfigurasjon og har ingen virkning under adapter-node; et tak
  som ikke gjelder er verre enn ingen, siden det leses som en policy.

### Fase 3: Ord som ikke lenger stemte

- Feilmeldingene i `cron-dispatcher.ts` og `job-worker.ts` viste til GitHub
  Actions som klokka «på Vercel». `cron.yml` er slettet, så med feil driver
  kjører det ingen cron i det hele tatt — nå er det dét meldingen sier.
- Body-grensa: kommentarene i `attachment-extract.ts`, `video-frames.ts`,
  `cloudinary-video.ts` og `/api/cloudinary/sign` oppga Vercels ~4,5 MB som
  grunnen til at store videoer går utenom appserveren. Grensa er nå
  `BODY_SIZE_LIMIT` (25 MB), og begrunnelsen holder fortsatt — en 160 MB video
  skal ikke gjennom appen for å gi seks bilder.
- «Vercel Cron» i tre nudge-/cron-endepunkter → cron-dispatcheren.
- «Vercel-loggen» i `error-report.ts`, `hooks.server.ts`,
  `weight-measurement-store.ts` og CLAUDE.md → containerloggen, med
  `GET /api/admin/logs` som den andre veien inn.
- `scripts/gmail-email-sync.gs` pekte på `https://resonans.vercel.app/api/email/inbound`.
  Det er en død adresse, altså en reell feil og ikke bare en kommentar; satt til
  `resonans.apps.hoi.by`.
- README og `.env.example` beskriver containeren.

## Beslutninger

**Post-mortem-kommentarene om Vercel er BEHOLDT.** Åtte steder står Vercel
fortsatt nevnt, og alle forklarer hvorfor en vakt eller en rettelse finnes:
`cron-auth.ts` (+ test og `/api/cron/daily-checkin`) om `env.VERCEL_ENV &&` som
lot seks nudge-endepunkter stå åpne utenfor Vercel, `db/index.ts` om poolen som
aldri ble lukket, `tesla-register-partner.mjs` om domenet defaulten pekte på.
Å skrubbe plattformnavnet ut av dem ville fjernet grunnen til at koden ser slik
ut — og det er nettopp den slags kommentar som hindrer at feilen kommer tilbake.
Skillet gjennom hele opprydningen: en påstand om hvordan det er NÅ skal
oppdateres, en forklaring på hvordan vi kom hit skal stå.

**Rullbacken er `git revert`, ikke et flagg.** Et adaptervalg som ikke bygges
regelmessig gir en falsk trygghet: den dagen man trenger den, oppdager man at
den ikke virker. En revert av denne commiten gir tilbake nøyaktig det oppsettet
som sist var i drift.

**Sjekken på pull requests følger ikke med.** «Vercel — Account is blocked»
postes av Vercels GitHub-app, ikke av noe i repoet. Den forsvinner først når
Vercel-prosjektets Git-kobling fjernes (eller GitHub-appen avinstalleres for
repoet) i Vercel- eller GitHub-innstillingene. Notert i CLAUDE.md, siden det
ellers ser ut som at opprydningen ikke virket.

## Verifisering

- `npm run check` — 0 errors, 0 warnings.
- `npm test` — 4136 tester i 289 filer, alle grønne.
- `npm run build` uten `DEPLOY_TARGET` satt → «Using @sveltejs/adapter-node».
  Det var poenget med å fjerne velgeren: standardveien skal være den riktige.
- `grep -ri vercel` utenfor `docs/` og låsefila gir bare de åtte bevisst
  beholdte post-mortem-kommentarene.
