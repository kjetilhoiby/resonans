# «I dag» på hjemskjermen

Dato: 2026-10-12
Status: ferdig (første utgave)

## Kontekst

Brevet (`2026-10-06-brev-prototype.md`) ble parkert 8. oktober. Det som virket,
var innholdet — styringssignalene — og at setningene var innganger man kunne
trykke på. Det som ikke virket, var formen: regelbrevet var langt og gjentok seg
(fem mållinjer med «På dagens tempo …»), og modellprosaen krevde mer arbeid enn
den var verdt før den kan vurderes systematisk.

Anbefalingen ved parkering var å ta signalene inn på hjemskjermen som korte,
klikkbare linjer UTEN modell (punkt 1 og 3 i «Hvor vi står»). Hjemskjermen er
flaten som brukes mest (68 av 166 visninger siste uke), og den er nå tegnet i
uttrykk A (`2026-10-08-alle-flater-i-valgt-tema.md`).

## Faser

### Fase 1: linjene

- **Reglene** (`$lib/domain/home-today.ts`, `buildHomeToday`) LESER brevet
  (`buildHomeLetter`) og gjør det kort. Ingenting regnes på nytt.
- **Ett mål, én linje** (`groupedGoalLine`). Hovedmålet sier anslaget sitt; delmålene
  bakes inn med bare hvordan de ligger an («Delmålet 89 kg innen jul ligger bak
  planen, men hovedmålet holder»). Beroligelsen sies bare når hovedmålet faktisk
  holder.
- **Det som venter først.** Linjer med `lens: 'venter'` (arrangementforberedelser,
  punkter som ble liggende, dagens åpne punkter, ukelista uten dag, en rekke som
  forfaller) står over de som bare forteller. Innenfor hver gruppe står brevets
  rekkefølge.
- **Tak på fem** (`MAX_TODAY_LINES`), og resten telles: «2 ting til i brevet ›»
  lenker til `/brev`. En linje som forsvinner stille var det verste ved brevets
  første utgave.
- **Kilder som feilet, sies** («Fikk ikke lest: trening.»). Færre linjer fordi en
  kilde døde skal ikke se ut som en roligere dag.
- **Innhentingen** er `loadHomeToday` i `$lib/server/home-letter.ts`, over den
  samme `loadHomeLetter` som brevet. Payloaden bærer nå `goals` og `today`, som
  grupperingen trenger.
- **Strømmet**: `+page.server.ts` returnerer et UAVVENTET løfte, så hjemskjermen
  tegnes før brevets mange kilder (trening, vekt, mål, arrangementer) har svart. Et
  feilet kall gir `null`, og sonen tier.
- **Flaten** er `HomeTodayZone` (sone 1B, rett under tittelen). Den tar primitiver,
  ikke `HOME_CTX`, så den kan vises i galleriet (`/design/flater`, hjem). Skjules
  mens chatfeltet er åpent, som tittelen. Prikken er uttrykkets sol for det som
  venter, en stille prikk for resten. Hele raden er lenken (≥ 44 px).
- `data-track`: `hjem:i-dag` og `hjem:i-dag-mer`.

## Beslutninger

- **Ingen modell.** Brukeren pekte på de klikkbare setningene, ikke på prosaen, og
  modellversjonen venter på testsuiten (Stemmegaffel).
- **Brevet blir stående som «mer»-målet.** Det er der alt står, og lenken fra
  hjemskjermen er nå den naturlige inngangen; ✉-ikonet i tittelsonen kan fjernes
  når «mer»-lenka har vist seg å bli brukt.
- **Ingen skjelett mens linjene lastes.** Et skjelett ville flyttet seg like mye
  som linjene når de kommer, og på dager uten noe å si ville det vært en tom boks.
  Sonen toner inn når den har noe.
- **Sykdom følger brevet:** sykelinja og målene, ingenting som ber om noe.

## Verifisering

- `src/lib/domain/home-today.test.ts`: én linje per hovedmål, anslaget én gang,
  beroligelsen bare når hovedmålet holder, «venter» før «status», taket og
  tellingen, tomt brev, sykdom.
- Galleriet (`/design/flater?uttrykk=a&fargetema=lys|mork`, hjem) i krem og natt.
- `svelte-check` og `npm test`.

## Kjent rest

- **Ikke sett på den ekte hjemskjermen** — den krever en database. Sjekk `/` etter
  deploy, og les `hjem:i-dag`/`hjem:i-dag-mer` i `/api/diagnostikk/bruk` etter en
  uke.
- **Kveldsvarianten** (refleksjon i stedet for plan) og ukentlige oppgaver i linja
  om ukelista står igjen fra brevet.
- **Mållinja er fortsatt lang** når anslaget og et delmål begge sies. En kortere
  form («foran planen, i mål rundt mai») ville kreve en egen setning fra
  `describeGoalProjection`; det er neste grep hvis linja leses som tung.
