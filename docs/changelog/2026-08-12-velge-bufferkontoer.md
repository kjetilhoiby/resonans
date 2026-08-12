# Velge bufferkontoer

Dato: 2026-08-12
Status: ferdig

## Kontekst

Brukeren spurte: **«Kan jeg justere hva vi regner som sparekontoer? (Barnas er ikke
relevant.)»**

Svaret var nei. `looksLikeSavingsAccount` var ren heuristikk på kontonavn, uten en vei til å
rette den, og i prod ble barnas «Nils Grønningsæter Høiby SPAREKONTO UNG» dermed regnet inn i
husholdningens buffer. Flaten sa det til og med selv, i en fotnote: «Stemmer ikke lista, er
det heuristikken som tar feil — ikke tallene.» Sant, og uten en vei videre.

Det er samme mønster som lønnsperiode-spørsmålet dagen før: flaten var ærlig om hva den ikke
visste, men å være ærlig er ikke nok når brukeren sitter med svaret og ikke kan gi det til
oss. Fase 4 kalte dette **retting der du ser tallet**, og prinsippet gjelder her uendret.

Konsekvensen var ikke kosmetisk. Bufferen, dekningen, bunntrenden og uttaksmønsteret regnes
alle av kontoutvalget, og barnas 5 314 kr lå inne i totalen.

## Løsning

### Tri-tilstand, ikke en boolean

`bank_account_settings.savings_role` er `auto` | `buffer` | `ignore`, med `auto` som standard.

En boolean kunne ikke skilt «heuristikken sa nei, og jeg er enig» fra «jeg har aktivt sagt
nei». Verre er de to enklere variantene, som begge feiler stille:

- **Ren inkluderingsliste:** en ny konto faller ut til noen husker å slå den på.
- **Ren ekskluderingsliste:** en konto heuristikken ikke fanget kan aldri legges til.

Med `auto` som standard virker nye kontoer av seg selv, og et eksplisitt valg står selv om
heuristikken endres senere.

`auto` **sletter raden** framfor å lagre strengen, så «ingen rad» og «auto» er samme tilstand.
Ellers ville det finnes to måter å uttrykke standarden på, og en framtidig endring i
heuristikken ville virket ulikt på rørte og urørte kontoer.

### Barnas kontoer er ute som standard

Navnene leses fra `persons` (`kind = 'child'`, ikke arkivert) med `aliases`, aldri fra en
hardkodet liste — samme regel overføringsflaten følger, så en ny husholdning virker uten en
kodeendring og repoet bærer ikke persondata.

**Barnesjekken må komme FØR navneheuristikken.** Kontoen heter nettopp «SPAREKONTO UNG» og
treffer `spar`, så en sjekk etterpå ville aldri sett den. Det er en `auto`-avgjørelse, ikke en
lås: er kontoen faktisk husholdningens, velges den inn, og valget står.

### `MIN_NAME_TOKEN_LENGTH` bor nå ett sted

Tokeniseringen lå i `routes/api/economics/transfers/+server.ts` og er flyttet til
`$lib/domain/economics/person-name-tokens.ts`. Terskelen er et **kalibreringstall**, og to
kopier av et kalibreringstall driver fra hverandre — samme lærdom som `MET_CALIBRATION`. Her
ville utfallet vært at overføringsflaten kjente igjen et navn kontovelgeren ikke kjente igjen,
uten at noe sa fra.

### `autoWouldInclude`

Beslutningen bærer hva `auto` *ville* gitt, uavhengig av om et valg overstyrer den nå.

Uten feltet kan ikke veksleknappen gå tilbake til `auto`: har brukeren valgt kontoen ut, er
`basis` «utelatt», og flaten vet ikke om heuristikken var enig. Et trykk ville da lagret et
eksplisitt valg identisk med standarden — nettopp den usynlige låsen tri-tilstanden finnes for
å unngå. Første utgave av `nextRole` gjettet på `basis === 'navn'` og tok feil i akkurat det
tilfellet.

### Valget bor på serveren, ikke i localStorage

`AccountSettingsSheet` lagrer favoritter i localStorage, og det var den nærliggende malen. Den
er feil her: **chatten leser samme loader** (`query_economics` med
`queryType: 'savings_buffer'`), så et valg bare klienten kjente ville gitt to ulike svar på
samme spørsmål. Det er hele feilklassen tillitsgjennomgangen handlet om.

## Filer

| Fil | Rolle |
|-----|-------|
| `scripts/db-migrations/0057_bank_account_settings.sql` | Tabellen |
| `src/lib/db/schema.ts` | `bankAccountSettings` |
| `src/lib/domain/economics/savings-buffer.ts` | `resolveSavingsAccounts`, `SavingsRole`, `isSavingsRole` — ren |
| `src/lib/domain/economics/person-name-tokens.ts` | Delt navnematching |
| `src/lib/server/economics/account-settings.ts` | Én skrivevei (`setSavingsRole`) + lesing |
| `src/lib/server/economics/savings-buffer.ts` | Bruker beslutningen, eksponerer `candidates` |
| `src/routes/api/economics/sparing/kontoer/+server.ts` | `PUT` |
| `src/lib/client/savings-account-role.ts` | Klientskriver med serverens feilmelding |
| `src/lib/components/domain/economics/SavingsAccountPicker.svelte` | Velgeren |

## Beslutninger

- **Velgeren viser ALLE kontoer, ikke bare bufferkontoene.** Uten dem som er ute kan man bare
  trekke fra, og en konto heuristikken ikke fanget kunne aldri legges til. Den står også i
  «ingen bufferkonto funnet»-grenen — det er der den betyr mest.
- **Hver rad sier hvorfor.** «Navnet matcher et barn» er en annen beskjed enn «navnet ser ikke
  ut som en sparekonto», og de to inviterer til ulik handling. `basis` bærer seks tilstander,
  inkludert `uten-navn` for PDF-ankre uten kontonavn.
- **Ett kall per konto.** Et batch-kall ville krevd at flaten holdt hele tilstanden og sendte
  den, og da kan to faner overskrive hverandres valg.
- **Flaten henter på nytt etter en endring** framfor å justere lista lokalt. Alle tallene over
  velgeren — buffer, dekning, bunntrend, uttaksmønster — er utledet av utvalget, så en lokal
  justering ville gjort at de ikke stemte med lista under.
- **BSU står fortsatt som sparekonto i heuristikken.** Det er en reell innvending at BSU ikke
  kan røres uten å miste skattefradraget, og at den derfor overdriver dekningen som *buffer*.
  Defaulten er ikke endret, siden det er en vurdering av brukerens penger og ikke en feil —
  men den kan nå velges ut, og det er svaret.
- **Chatten kan lese, ikke skrive.** `query_economics` får riktig utvalg automatisk gjennom
  den delte loaderen. Et `manage_savings_accounts`-verktøy er ikke bygget; klientskriveren
  ligger i `$lib/client` nettopp for at en andre inngang ikke skal få sin egen validering, som
  var feilen fase 4 rettet.

## Verifisering

`npm run check` (0 feil) og `npm test` (3 345 tester, +22).

Nye tester på ren logikk i `savings-buffer.test.ts` og `person-name-tokens.test.ts`:

| Test | Hva den holder fast |
|------|---------------------|
| `holder barnas konto utenfor som standard` | Selve bestillingen |
| `lar barnenavnet slå navneheuristikken, ikke omvendt` | Rekkefølgen — kontoen treffer `spar` |
| `lar brukerens valg slå både barnenavn og heuristikk` | At et valg ikke overkjøres |
| `kan legge til en konto heuristikken ikke fanget` | At man kan legge til, ikke bare trekke fra |
| `sier hva heuristikken ville gjort selv når et valg overstyrer den` | `autoWouldInclude` — den usynlige låsen |
| `skiller «uten navn» fra «ukjent navn»` | PDF-ankre |
| `dropper ord kortere enn terskelen` | At «Ole» ikke treffer «Olerud» |
| `gir false uten tokens — ikke true` | At «ingen barn registrert» ikke matcher alt |

**Ikke verifisert i prod ennå.** Etter deploy: at barnas «SPAREKONTO UNG» ikke er haket, at
bufferen faller fra 85 384 til ~80 070 kr, og at et trykk på en konto endrer totalen over.
