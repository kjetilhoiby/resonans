# Array-parametere til Postgres skrives selv, ikke gjettes av driveren

Dato: 2026-09-03
Status: ferdig

## Kontekst

SpareBank1 sluttet å synke 30. august — samme dag containeren tok over med
`DB_DRIVER=postgres`. Reautorisering hjalp ikke: importen fra `/settings/sources`
feilet umiddelbart med

```
The "string" argument must be of type string or an instance of Buffer or
ArrayBuffer. Received an instance of Array
```

Meldingen er en Node-TypeError, ikke en databasefeil, og den kan bare komme fra
`Buffer.byteLength(<Array>)`. Sporet gjennom postgres-js:

| Sted | Hva skjer |
|---|---|
| `types.js` `inferType` | En **Array** får skalar-OID-en til FØRSTE element — ikke array-OID-en |
| `connection.js` `Bind` | Verdien serialiseres med `serializers[type]`, ellers `'' + x` |
| `bytes.js` `str(x)` | `Buffer.byteLength(x)` — kaster hvis `x` fortsatt er en Array |

Det gir to utfall, og begge rammet SpareBank1:

- **Liste av strenger** → type 0 → serializeren gjør `'' + x` → `"a,b"`. Det er
  ikke et gyldig array-literal (Postgres krever `{a,b}`), så
  `UNNEST($1::text[])` feiler med «malformed array literal».
- **Liste der første element er et `Date`** → type 1184 → drizzles transparente
  date-serializer returnerer Arrayen **urørt** → `Buffer.byteLength(Array)` →
  meldingen over.

Reprodusert med `drizzle(postgres(…))` satt opp som i `db/index.ts`.

**Hvorfor det virket før:** under neon-http serialiseres parametere av en helt
annen driver. UNNEST-skrivingene kom inn 14. august (`git log -S "UNNEST("`) og
kjørte der uten problemer. Containeren byttet driver 30. august. Koden var
uendret; det var underlaget som skiftet.

## Faser

### Fase 1: Vi skriver literalen selv

Ny ren modul `$lib/db/pg-array.ts` med `toPgArrayLiteral`, 12 tester. De tre
`UNNEST`-kallene i `sparebank1-sync.ts` (linje ~135, ~185, ~272 — 33 parametere)
sender nå en ferdig streng i stedet for en JS-Array.

**Alle ikke-null-elementer siteres, også tall.** Postgres godtar siterte
elementer for enhver elementtype (`'{"1","2"}'::int[]` er `{1,2}`), så vi slipper
å avgjøre per element om sitering trengs — og nettopp den avgjørelsen er
feilkilden i håndskrevne array-literaler. En bankbeskrivelse som «KIWI 123, OSLO»
ville uten sitering delt seg i to elementer og forskjøvet ALLE radene fra det
punktet, stille.

### Fase 2: Serializeren kan ikke lenger returnere en Array

`dateSerializer` i `db/index.ts` returnerte verdien urørt når den ikke var et
`Date`. Den returnerer nå alltid en streng, og bygger et array-literal for
lister. Det gjør ikke SpareBank1-stien riktigere — den går ikke der lenger — men
det fjerner fella for neste rå spørring.

## Beslutninger

**Driveren får ikke gjette typen.** Alternativet var `sql.array()`, som lar
postgres-js bruke sin egen `arraySerializer`. Den er korrekt, men avhenger av at
`typeArrayMap` er fylt fra serveren ved tilkobling; slår det feil, faller den
tilbake på den samme gjettingen som er hele feilen her. En ferdig streng har
ingen slik avhengighet.

**Escapingen er pinnet mot driverens egen `arraySerializer`** i en test.
Utdataene er byte-identiske på alle tilfellene som er testet — komma,
anførselstegn, backslash, tom streng, krøllparenteser, æøå — bortsett fra `null`,
der vi skriver `NULL` og driveren `null`; `array_in` i Postgres leser begge.
Importen går på filsti fordi pakken ikke eksporterer modulen. Ryker den ved en
oppgradering, er det riktig tidspunkt å se på escapingen på nytt.

**Vi rørte ikke `sql.array`-veien for drizzle-spørringer.** Drizzles egne
spørringer sender skalare parametere per rad og var aldri berørt.

## Verifisering

- `npm run check` — 0 errors, 0 warnings.
- `npm test` — 4217 tester i 295 filer, alle grønne (12 nye).
- `npm run build` — grønt.
- Krasjen ble reprodusert isolert (`[Date, …]` gjennom drizzles serializer) før
  rettelsen, og literal-byggeren er sammenlignet element for element mot
  postgres-js sin egen serializer.

## Kjent rest

**Ikke bekreftet mot prod.** Det finnes ingen Postgres i utviklingsmiljøet her,
så ingen av de tre spørringene er kjørt mot en ekte base. Rettelsen hviler på at
literalet er identisk med driverens eget — sterkt, men ikke det samme som en
vellykket synk. Neste SpareBank1-kjøring er fasit; `lastError` bærer nå feilen
hvis den fortsatt er der (se `2026-09-03-synkfeil-som-sier-fra.md`).

**Stacktracen fra prod er aldri sett.** Ringbufferen er per prosess og var tømt
av to redeploys før feilen ble undersøkt. Det er derfor ikke utelukket at
`Buffer.byteLength`-krasjen kom fra et fjerde sted enn de tre som er rettet —
men de tre var brutt uansett, på en måte som forklarer tidspunktet nøyaktig.
