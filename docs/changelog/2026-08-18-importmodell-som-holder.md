# Importmodell som holder

Dato: 2026-08-18
Status: ferdig

## Kontekst

> «Nei. Jeg vil ikke ha ansvar for å kjøre noe som helst. Jeg vil ha en modell for import av
> transaksjonsdata som fungerer og som vi kan bygge verdifulle views oppå som kan føre til bedre
> oversikt og kontroll på privatøkonomien.»

Riktig ramme, og en korreksjon av arbeidet fram til hit. Fase 3 endte med to knapper og en
anbefaling om å trykke dem månedlig. **En importmodell som krever at brukeren husker noe er ikke
ferdig — den har flyttet feilen ut av koden og over på et menneske.** Og en anbefaling om månedlig
vedlikehold er dessuten en garanti for at tallene før eller siden er gale, siden ingen gjør det.

## Diagnosen: bøttenøkkelen er utledet av en visningsstreng

`canonical_bank_transactions` har unik nøkkel
`(sensor_id, account_id, canonical_date, amount, merchant_key)`, og `merchant_key` var
`normalizeTxDescription(description)` — altså **bankens formatering av en tekst**.

Konsekvensen er strukturell: endrer SB1 formatet, splittes ett kjøp i to rader, ingenting varsler,
og forbruket vokser. Det skjedde 23. juni 2026 da banken begynte å skrive «DKK DANSK CAMPING UNION»
ved siden av «DANSK CAMPING UNION».

Beskrivelsen kan ikke bare fjernes fra nøkkelen: uten den kollapser to ekte Ruter-billetter på
41 kr samme dag til én rad. Den er der for å skille **gjentatte kjøp**, og det er en reell jobb.
Forsvaret må derfor være å strippe det som er **format** og beholde det som er **identitet**.

## Faser

### Fase 1: Bøttenøkkelen ut av synken, med tester

`normalizeTxDescription` lå **privat og utestet** inni `sparebank1-sync.ts` — samtidig som den
avgjør hvilke transaksjoner som blir én rad og hvilke som blir to, altså alt som teller kroner.

Flyttet til `$lib/domain/economics/merchant-key.ts` (`merchantKeyFromDescription`) med 23 tester.
Aliaset beholdes i synken fordi navnet brukes på seks steder der og betyr det samme.

Testene dekker **først** den gamle oppførselen. En utflytting som endrer noe for rader som alt
finnes er ikke en utflytting.

### Fase 2: Tre manglende regler

| Regel | Hva den løser | Målt i prod |
|---|---|---:|
| Ledende valutakode | `DKK/USD/SEK/EUR X` mot `X` | 33 par / 90 dager |
| Ledende `DD.MM` | `02.07 SPORT 1 RINDAL` mot `SPORT 1 RINDAL` | 2 par |
| `TIL: X` → `X` | `Til: Påmelding for …` mot `Påmelding for …` | 1 par (2 000 kr) |

**`TIL:` var glemt mens `FRA:` fantes.** Jeg klassifiserte først 2 000-kr-paret som et
personnavn-prefiks vi ikke kunne gjøre noe med. Det var et manglende motstykke til en regel som alt
fantes — en asymmetrisk regel ser komplett ut.

To detaljer som ikke er kosmetiske:

- **Format strippes FØR kjedereglene.** Ellers treffer «DKK KIWI BØLERL BØLERLIA» ikke
  `KIWI `-regelen og får sin egen bøtte.
- **En kode som er hele teksten er et navn, ikke et prefiks.** Returnerte vi `''` for «USD», ville
  alle slike rader kollapset i én bøtte — mye verre enn å la dem stå.

Og en regresjon testene fanget med én gang: `TIL: BETALT:` starter med `TIL: `, så den nye
prefiksregelen strippet den til «BETALT:» — en bøtte oppkalt etter et formatord. De navnløse
formene må sjekkes først.

**Om valutalista:** changeloggen advarer mot å strippe valutakoder. Den advarselen gjaldt å
*matche* duplikater, der lista dekker tre av fire tilfeller og ser ut som en løsning. Her er den
motsatt vei: en kode som mangler gir bare den gamle oppførselen (to rader), som ryddejobben tar.
**Lista kan aldri gjøre noe verre enn før den fantes.**

### Fase 3: Visningsteksten — to vaner som peker motsatt vei

Upserten foretrakk den **lengste** beskrivelsen ved lik status-rank. Med prefiksstripping ville
«USD OPENAI» da vunnet over «OPENAI» — dårligere å lese, og dårligere for kategoriseringen, som
leser beskrivelsen. En opprydding ville gjort noe verre.

Skillet er presist:

- **Trunkering:** den korte er et **PREFIKS** av den lange («SPORT 1 RINDAL RINDALSVEG» ⊂
  «… RINDALSVEGEN RINDAL») → den lange er mest komplett. Uendret.
- **Formatprefiks:** den korte er en **SUFFIKS** av den lange («OPENAI» ⊂ «USD OPENAI») → den
  korte er butikkens navn.

`RIGHT(...)` framfor `LIKE '%' || x`: en beskrivelse kan inneholde understrek og prosenttegn
(«Google Workspace_hoi.by»), som er jokertegn i LIKE. Mellomromskravet hindrer at «NORDEA»/«EA»
leses som samme navn.

### Fase 4: Ingen knapper

`/api/cron/economics-dedup`, daglig 04:10 UTC, kjører den bokførte duplikatryddingen med
`dryRun: false` og `confidence: 'high'` for alle brukere med aktiv SB1-sensor. Registrert i
`/api/cron/jobs` og i `monitoring-service.ts` med 28t buffer.

Tre grunner til at jobben trengs selv om nøkkelen er rettet:

1. **Historikken.** Rader skrevet før rettelsen ligger alt i to bøtter, og SB1 leverer bare ferske
   transaksjoner — de blir ikke skrevet om av seg selv.
2. **Format vi ennå ikke har sett.** 23. juni kom uten forvarsel; neste gang blir det noe annet.
3. **Personnavn-prefikser**, som ingen regel kan strippe. De telles (`totalHeldBack`) men skrives
   ikke, så en voksende restpost er synlig.

**Hvorfor det er trygt uten menneske i løkka:** samme dag, eksakt beløp, samme konto, begge
bokført, og beskrivelsene må være ULIKE. To rader med identisk beskrivelse røres aldri — et
gjentatt kjøp ser nøyaktig slik ut. `is_active = false` sletter ingenting.

**`success` er falsk hvis noen bruker feilet**, ellers ville monitoreringen sett en grønn kjøring
der halve jobben ikke ble gjort. Og overvåkingen er ikke pynt: stopper jobben stille, drifter
forbrukstallene oppover igjen uten at noe sier fra.

## Beslutninger

**Reservasjonsryddingen er IKKE automatisert.** `deactivateSupersededReservations` matcher på
beløp og konto **uten beskrivelse**, innenfor ±3 dager — så to like Ruter-billetter der den ene
ennå er PENDING kan bli paret. Det er en reell falsk positiv, og den skal ikke skje usett. Målt i
prod var det dessuten bare **ett** slikt par igjen; de 242 første var et engangsetterslep.

**Ingen bulk-reprojeksjon av `merchant_key` på gamle rader.** Å slå sammen eksisterende rader
krever å flytte aliaser, summere `evidence_count` og velge status — mer risiko enn å deaktivere
den ene, som gir samme korrekte totaler og er reversibelt. Cron-jobben gjør det uansett innen
et døgn.

## Verifisering

- `npm run check`: 0 feil, 0 advarsler
- `npm test`: 253 filer, 3532 tester (23 nye på bøttenøkkelen)
- Effekten måles mot prod etter deploy: `GET /api/admin/economics/duplikater` skal falle mot 0 for
  valuta- og datoparene, og `foreignByMonth.currencyPrefixUnpaired` skal slutte å vokse.

## Neste

Grunnlaget er nå til å bygge views på. Det som står igjen fra tillitsgjennomgangen:

- `sensor_events` 0,7× canonical — flagget på flaten, årsak ikke målt
- Dagligvare-kategorien fanger byggevarer (`'coop '`, `'obs '` i nøkkelordene)
- `categorized_events` er ikke nøklet på `canonicalId`
- 11 uparede prefiksrader i juni–august
