# Månedssnitt for vekt — og et oppdiktet svar

Dato: 2026-08-09
Status: ferdig

## Kontekst

Brukeren spurte: «Ser du den lange vekthistorikken min? Kan du lage en liste med
snittvekt per måned tilbake til 2014 og interpolere der det ikke finnes data?»

Chatten svarte at den ikke hadde tilgang til månedsdata — og **fant så på tallene**:

```
August 2026: 98,7 kg
Juli 2026:   99,3 kg (interpolert)
Juni 2026:  100,2 kg (interpolert)
Mai 2026:   102,1 kg (interpolert)
...
Januar 2026: 104,0 kg (interpolert)
```

Ingen av dem var regnet ut av noe. Det er en jevn rampe modellen konstruerte, og
merkelappen «(interpolert)» gjorde det verre enn en åpen gjetning: den ga oppspinnet
en metode. En bruker som tar et skjermbilde av dette har åtte tall som ser målte ut.

Historikken fantes hele tiden — 1 200 veiinger tilbake til oktober 2017.

## Det verste: månedene var tett målt

Januar–juli 2026 har veiinger nesten hver dag — grafen viser en sammenhengende kurve
gjennom hele året. Modellen «interpolerte» altså ikke over hull. Den fant på tall for
måneder som var fulle av målinger, og kalte det interpolasjon.

Det flytter diagnosen: dette var ikke tynne data som ble fylt ut. Det var oppspinn over
tette data, med en merkelapp som skjulte det.

## Årsaken

`query_weight` returnerer `trend`, `milestones` og `composition`. Ingen av dem er en
serie. Modellen hadde altså ingen vei til svaret, og **en modell uten vei til svaret
finner på et**.

Det er nøyaktig mønsteret `docs/changelog/2026-08-07-domenedata-til-assistenten.md`
beskriver — «et dashboard uten verktøy er data assistenten ikke har» — i en ny
variant: her fantes verktøyet, men ikke utsnittet spørsmålet trengte.

## Faser

### Fase 1: Serien

`$lib/domain/health/weight-monthly.ts` — `monthlyWeightSeries` og
`summarizeMonthlyWeights`. Rent og testet.

### Fase 2: Verktøyet

`queryType: 'monthly'` på `query_weight`, registrert på begge flater.

### Fase 3: Regelen

`DOMAIN_PROMPTS.health` har fått et eget avsnitt om å aldri finne på et helsetall.

## Beslutninger

**Interpolasjonen regnes i kode, aldri av modellen.** Brukeren ba om interpolasjon, og
det er en legitim forespørsel — det gale var ikke interpolasjonen, men at ingen hadde
regnet den. Nå gjør testet kode det, og hver rad bærer `source: 'measured' |
'interpolated'`.

**Snittet regnes over dagsverdier, ikke over enkeltveiinger.** En dag man veide seg
fire ganger skal ikke telle fire ganger så mye som en dag med én veiing.

**Ingen ekstrapolering — noensinne.** Serien begynner ved første måling og slutter ved
siste. Å strekke den til 2014 fordi noen spurte om 2014 ville vært å oppfylle
spørsmålet framfor å svare på det. `measuredFrom` er derfor det viktigste feltet i
svaret: er første måling oktober 2017, er *det* svaret på «tilbake til 2014».

**`coverage.firstWeighIn` skrives ut, ikke bare `historyDays`.** Modellen fikk «1 204
veiinger over 3 222 dager» og skulle svare på «har du tall fra 2014?». Det krever at
den regner — og en modell som må regne for å vite om den *har* noe, svarer gjerne at
den ikke har det, og finner så på tallene. Datoen står nå i hvert eneste `query_weight`-
svar, uansett `queryType`, så påstanden «jeg har ikke tilgang» motsies av payloaden den
nettopp fikk.

**`gapMonths` på hver interpolert rad.** Et anslag som fyller én måned og ett som
ligger midt i et hull på fjorten er ikke samme påstand, og beskrivelsen ber modellen
kvalifisere det siste.

**Forbudet står i domeneprompten, ikke bare i verktøybeskrivelsen.** Feilen er ikke
vekt-spesifikk: den oppstår hver gang et spørsmål ikke har et verktøy bak seg. Regelen
sier eksplisitt at «interpolert», «omtrent» og «estimert» ikke gjør et oppdiktet tall
akseptabelt — merkelappen forsvinner i neste skjermbilde, tallet gjør ikke det.

## Verifisering

- `npm test` — 2 926 grønne, 12 nye i `weight-monthly.test.ts`. Dekker snitt over
  dagsverdier, lineær interpolasjon, hull over årsskiftet, `gapMonths`, at
  interpolasjon krever to punkter, og at serien **aldri** går utenfor målingene.
- `npm run check` — 0 feil, 0 advarsler.
- Ikke prøvd mot en ekte modell: krever `OPENAI_API_KEY` og database. At verktøyet nå
  *kan* svare er verifisert; at modellen velger det, ser man først i drift.
