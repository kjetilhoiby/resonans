# Funn — triage-innboks for lagrede lenker/reels

Dato: 2026-07-20
Status: ferdig

## Kontekst

Brukeren lagrer stadig Instagram-reels som er verdt å ta vare på — oppskrifter,
men også ting som «skjær en manuell dovetail på fem minutter». Instagrams eget UI
gjør det kaotisk å finne igjen dette, og lagrede innlegg/samlinger er ikke
tilgjengelig via noe offisielt Instagram-API (verken Graph API eller den avviklede
Basic Display API eksponerer «saved»-innhold).

Konklusjonen ble derfor å droppe en Instagram-integrasjon helt og heller bygge på
den eksisterende e-post-inntaks-pipelinen: brukeren sender en reel til seg selv
(gjerne med caption-teksten limt inn), og Resonans triagerer den — «hva er dette?»
— og arkiverer funnet. Beslutning tatt sammen med bruker:

- **Egen «Funn»-innboks** som triage-flate (ikke auto-arkivering i tema).
- **Oppskrifter promoteres** til mat-temaet (meals) med strukturert uttrekk; andre
  funn lagres enklere (tittel/sammendrag/tema/lenke/thumbnail).

## Faser

### Fase 1: Datamodell
- Ny tabell `finds` (`src/lib/db/schema.ts` + `scripts/db-migrations/0044_funn.sql`):
  `title`, `summary`, `theme`, `kind`, `sourceUrl`, `thumbnailUrl`, `rawText`,
  `extracted` (jsonb), `status` (`inbox`|`kept`|`discarded`), `mealId` (FK →
  meals, satt ved oppskrifts-promotering), `emailFrom`, `emailSubject`.
  Indeks på `(user_id, status, created_at)`.

### Fase 2: Lenke-metadata (OpenGraph)
- `src/lib/server/web/og-tags.ts`: `extractFirstUrl()` + `parseLinkPreview()` (ren,
  testet) + `fetchLinkPreview()`. Henter lenka med en `facebookexternalhit`-UA —
  Instagram serverer `og:title`/`og:description`/`og:image` til slike
  lenke-forhåndsvisninger uten innlogging. Degraderer grasiøst til `null` ved feil,
  så triagen kan lande funnet med bare lenka.

### Fase 3: Triage-processor
- `src/lib/server/email-processors/find-triage.ts`: `processFindTriageEmail()`.
  Finner lenka → henter OG-meta → GPT-4o-mini klassifiserer
  `{title, summary, theme, kind, isRecipe}` → oppskrifter promoteres via ny
  `importRecipeFromText()` i `recipe-import-service.ts` → funnet lagres i `finds`.
  `buildTriageContent()` og `parseTriageResult()` er rene og enhetstestet.
- Ny prosesseringstype `find_triage` koblet inn i `src/routes/api/email/inbound/+server.ts`
  og valgbar i `EmailRulesCard.svelte`.
- `recipe-import-service.ts` refaktorert: felles `extractAndStore()`-kjerne deles av
  `importRecipeFromUrl` (uendret oppførsel) og nye `importRecipeFromText`.

### Fase 4: Funn-innboks (UI)
- `src/routes/funn/` (`+page.server.ts` + `+page.svelte`): faner Innboks/Beholdt/Arkiv,
  kort med thumbnail, tema-chip, type, tittel (lenke), sammendrag og handlinger
  (behold/forkast/gjenopprett/slett + tema-omruting via `<Select>`).
- `src/routes/api/funn/+server.ts`: GET (filtrer på status), PATCH (status/tema,
  eierskaps-sjekket), DELETE.
- Snarvei fra hjem-skjermen (`HomeTitleZone.svelte`, stjerne-ikon → `/funn`).

### Fase 5: Hint, lenketype-ruting og dedup
- **Hint:** brukeren kan skrive `Hint: <tekst>` (eller `Hint - …`) på egen linje i
  e-posten. `extractHint()` plukker det ut og løfter det øverst i triage-prompten
  med tung vekt — styrer tema, og brukes gjerne som tittel («underskap til seng»).
  Lagres i `finds.extracted.hint`.
- **Oppskrifts-ruting etter lenketype** (`isWalledMediaUrl()`): fetchbare sider
  (blogg/nettbutikk/artikkel) hentes i sin helhet via `importRecipeFromUrl`
  (JSON-LD), med fallback til caption-tekst; murte IG/YT-lenker bruker
  `importRecipeFromText` på caption/OG-teksten.
- **Dedup:** samme `sourceUrl` sendt på nytt lager ikke et nytt funn (unngår
  dobbelt-funn og dobbel oppskrifts-import ved gjentatte delinger).

## Beslutninger

- **Ingen Instagram-OAuth.** Lagret innhold er ikke API-tilgjengelig; e-post er den
  eneste lovlige og pålitelige veien. Caption limt inn av brukeren er den beste
  kilden til selve oppskriften; OG-taggene gir tittel/thumbnail/utdrag som bonus.
- **`find_triage` bruker ingen sensor.** I motsetning til de andre e-post-prosessorene
  er funn ikke sensor-data — de lagres direkte i `finds`, så ingen
  `FRESHNESS_THRESHOLDS`-oppføring trengs.
- **`theme` er fri tekst, klemt til DomainType + `annet`** i både processor og API,
  slik at UI kan mappe til etikett/emoji uten enum-migrasjon.

## Verifisering

- `npm run check` (TypeScript/Svelte) og `npm test` (nye tester for `og-tags` og
  `find-triage`).
- Manuell flyt: opprett en `find_triage`-regel under Kilder → E-post, send deg selv
  en reel med caption → funnet dukker opp i `/funn`, oppskrifter havner i mat-temaet.
