# Tittelklikket på Helse gjorde ingenting

Dato: 2026-08-03
Status: ferdig

## Kontekst

«Hvis jeg trykker på tittelen når jeg står på Helse kommer jeg ikke til
hjemskjermen.»

`docs/DESIGN.md` sier at **tittelen ER tilbakeknappen**. Fra et undertema går den til
mortemaet, ellers til forsiden. Logikken i `ThemePage.goBack` var riktig, og lokalt
virket det: tittelen på `/tema/helse` hadde `aria-label="Gå til forsiden"` og
navigerte til `/`.

I prod sa den samme markupen `aria-label="Tilbake til Helse"`.

**Helse var sin egen forelder.** `parentTheme = 'Helse'` på Helse-raden, så
`parentThemeId` pekte på temaet selv, og tittelen navigerte til siden man alt sto
på. Ingen feilmelding, ingen 404 — bare et trykk som ikke gjorde noe, og «Gå til
forsiden» som aldri ble tilbudt.

`themes.parentTheme` er fritekst mot forelderens navn, ikke en fremmednøkkel, så
databasen kunne ikke hindre det.

## Faser

### 1. Reproduser før du fikser

Prod-tilstanden ble satt i den lokale basen:

```sql
UPDATE themes SET parent_theme = 'Helse' WHERE name = 'Helse';
```

Da oppsto feilen lokalt, i ekte nettleser: `aria-label="Tilbake til Helse"`, og
klikket landet på `/tema/<helse-id>`.

### 2. Vakta i domenelaget

`src/lib/domain/theme-hierarchy.ts` *(ny)*:

- `resolveParentThemeId(theme, parent)` gir null når `parentTheme` er tomt, når
  forelderen ikke finnes som rad, **eller når forelderen er temaet selv**.
- `isSelfParented(theme)` for å luke selvløkker ut av barnelister.

Navnesjekken er med i tillegg til id-sjekken, fordi hierarkiet faktisk bæres av
navnet: to rader med samme navn ville gitt ulike id-er, og en «forelder» med samme
navn er like sirkulær.

`/tema/[id]/+page.server.ts` bruker den nå. Etter fiksen — med den ødelagte dataen
fortsatt i basen — sa tittelen «Gå til forsiden» og navigerte til `/`, mens
`/tema/trening` fortsatt gikk til mortemaet.

### 3. Barnelister

`getChildThemes` filtrerer bort selvløkker. Uten det dukket mortemaet opp i sin egen
barneliste — blant annet i `themeIdsByName` fra `ensureHealthSubthemes`, som er
hvordan tilstanden i det hele tatt ble oppdaget. Undertema-stripen viste riktig sett
uansett, fordi den filtrerer mot det lukkede `HEALTH_SUBTHEMES`.

### 4. Skrivestien

`PATCH /api/tema/[id]` har alltid avvist selvforeldre. `ensureThemeForUser` gjorde
det ikke, og den er stien provisjoneringen bruker med `forceParentTheme`. Den
stryker nå et `parentTheme` som er lik temaets eget navn, og logger at den gjorde
det.

Stille framfor å kaste: kallerne bruker funksjonen til provisjonering, og en
selvløkke skal ikke kunne velte en Withings-synk.

### 5. Dataen

`DATA_MIGRATIONS` i `scripts/sync-db-schema.mjs`:

```sql
UPDATE "themes" SET "parent_theme" = NULL WHERE "parent_theme" = "name"
```

Idempotent, og treffer bare rader som faktisk er sirkulære. Kjørt mot den lokale
basen: 1 rad.

## Beslutninger

- **Både kode og data, ikke bare data.** En migrering alene ville fikset i dag og
  ikke i morgen. Vakta gjør at flaten oppfører seg riktig uansett hva som står i
  kolonnen — verifisert ved at fiksen virket *før* migreringen ble kjørt.
- **Vakt på alle tre nivåene.** Lesing (`resolveParentThemeId`), lister
  (`getChildThemes`) og skriving (`ensureThemeForUser`). Fritekstkolonnen har ingen
  referanseintegritet, så den må håndheves der den brukes.
- **Ikke funnet hvem som satte den.** `HEALTH_SUBTHEMES` inneholder ikke «Helse», så
  dagens provisjonering kan ikke gjøre det. Sannsynligvis en tidligere versjon av
  mortema-arbeidet. Vakta gjør spørsmålet mindre viktig enn å hindre gjentakelse.

## Verifisering

- `npm run check`: 0 feil, 0 advarsler.
- `npm test`: 2283 grønne i 177 filer (fra 2276), 7 nye.
- **Reprodusert og verifisert i ekte nettleser** mot den lokale basen, med
  prod-tilstanden satt: `/tema/helse` → «Gå til forsiden» → `/`, `/tema/trening` →
  mortemaet, og ingen Helse-i-Helse i undertema-stripen.
- Migreringen kjørt lokalt: 1 rad rettet.

Prod-raden rettes ved neste deploy, når `sync-db-schema.mjs` kjører. Vakta gjør at
tittelen virker allerede før det.
