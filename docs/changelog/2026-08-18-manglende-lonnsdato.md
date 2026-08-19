# Manglende lønnsdato ga en periode på 58 dager

Dato: 2026-08-18
Status: ferdig

## Kontekst

Da snittkurven på Økonomi-oversikten ble rettet, viste samme måling at serien gikk til **dag 58**
mens inneværende lønnsperiode var 27 dager. Én «lønnsperiode» dekket altså to.

Målt mot prod, lønnskontoen `iHPE8dcoA1wbJDfhjNDO`:

```
2026-01-22   54 687,92   AMEDIA PRODUKT OG TEKNOLOGI AS
2026-02-24   54 687,92   AMEDIA PRODUKT OG TEKNOLOGI AS
         ←  mars mangler
2026-04-23   54 687,92   AMEDIA PRODUKT OG TEKNOLOGI AS
2026-05-21   87 824,86   AMEDIA PRODUKT OG TEKNOLOGI AS
2026-06-24   54 685,42   Lønn  +  Fra: AMEDIA PRODUKT OG TEKNOLOGI AS
2026-07-23   54 685,42   Lønn  +  Fra: AMEDIA PRODUKT OG TEKNOLOGI AS
```

24. februar → 23. april er **58 dager**. Årsaken er strukturell: `pickBestPerMonth` gir **én
lønnsdato per kalendermåned**, og en måned uten kandidatrad gir ingen dato i det hele tatt.

## Lønna kom, raden gjorde ikke

To målinger avgjør at mars-lønna faktisk ble utbetalt:

1. **Lønnskontoen dekker 2025-12-30 til 2026-08-17** med 524 transaksjoner. Mars er et **hull i
   dataene, ikke en kant**.
2. På en annen konto står `2026-03-24  12 500,00  Kjetil Høiby` — den faste overføringen brukeren
   gjør rett etter lønn. Den skjedde altså.

Lønna kom rundt 23. mars; raden nådde aldri canonical.

## Beslutning: slutt, men merk slutningen

**Alternativet til å slutte er ikke «ingen påstand».** Det er påstanden «februar og april var én
lønnsperiode på 58 dager», som er konkret og gal, og som forplantet seg helt til en graf. Et hull
er ikke fravær av data hos konsumentene; det er feil data. Valget står mellom to slutninger, og
den merkede er bedre.

`fillPaydayGaps` (`$lib/domain/economics/payday-gaps.ts`) fyller hullet med den antatte
lønnsdagen — medianen av observerte lønnsdager, klemt mot månedslengden og trukket bakover fra
helg. 17 tester.

Vaktene er mot å slutte for MYE, ikke mot å slutte:

| Vakt | Verdi | Hvorfor |
|---|---:|---|
| `MAX_INFERRED_RUN` | 2 | Tre måneder uten lønn er jobbskifte eller permisjon, ikke en tapt rad. Å dikte opp tre lønninger ville skjult nettopp den hendelsen. |
| `MIN_OBSERVED` | 3 | Uten nok observasjoner finnes ingen pålitelig lønnsdag, og gjetningen blir en gjetning med selvtillit. |

Måneder som ikke fylles rapporteres i `skippedPaydayMonths`. En stille utelatelse ser ut som full
dekning, og det var nettopp det som gjorde 58-dagersperioden vanskelig å feste.

## Arbeidsdelingen: statistikk fra observasjoner, grenser fra den utfylte serien

Dette er den viktigste delen, og den som hindrer at fixen skaper nye feil.
`GlobalPayday` bærer nå både `paydayDates` (utfylt) og `observedPaydayDates`.

- **`salary-nudge.ts` bruker observerte.** Et varsel om at lønna har kommet skal aldri fyre på en
  slutning. `fillPaydayGaps` fyller bare *mellom* observasjoner, så siste element er observert
  uansett — men et varsel skal ikke hvile på den invarianten.
- **`salary-profile.ts` bruker observerte** til beløpsstatistikk, fingeravtrykk og `typicalDow`.
  De antatte datoene har ikke noe beløp, og de er plassert *på* lønnsdagen, så `typicalDow`
  regnet over dem ville latt en slutning bekrefte seg selv.
- **`detectedPaydayDom` regnes på observerte** av samme grunn. Her endrer det ingenting —
  medianen av en median er den samme — men sirkelen blir reell så snart plasseringen endres.
- **Periodegrenser** (`economics-dashboard`, `savings-buffer`, `month-review`) bruker den utfylte
  serien. Det er den de trenger.

`longestPaydayGapDays` er eksportert som en **etterprøvbar invariant**, samme rolle som
`isMonotonicComparison` har for snittkurven: er den mye over 40 dager etter utfyllingen, står det
fortsatt et hull — og da er det et hull vakten bevisst nektet å fylle.

## Én test som ikke stemte, og som hadde rett

Første utgave krevde at største hull etter utfylling var ≤ 31 dager. Det feilet på 34: 21. mai →
24. juni, som er **ekte drift** i lønnsdagen. Grensa er derfor 40 — den skiller «én måned med
drift» fra «en måned mangler», som er hele skillet funksjonen finnes for. Assertionen var feil,
ikke koden.

## Verifisering

- `npm run check`: 0 feil, 0 advarsler
- `npm test`: 255 filer, 3566 tester (17 nye)
- Prod-serien er gjenskapt som test, med mars som det manglende leddet

## Rest, og den er større enn denne saken

Målingen avdekket at **SB1 skriver samme transaksjon opptil TRE ganger siden juni 2026**, med
ulike beskrivelser:

```
2026-07-27   23 000,00   Overførsel
2026-07-27   23 000,00   Fra: Anita Grønningsæter Digernes Betalt:
2026-07-27   23 000,00   Avtale
```

Før juni: én rad (`Anita Grønningsæter Digernes`). Samme brudd som valutaprefikset, samme måned.

Lønna er også dublett fra juni: `Lønn` + `Fra: AMEDIA PRODUKT OG TEKNOLOGI AS`, samme dag og øre.

**Bøttenøkkelen kan ikke slå disse sammen** — `Avtale`, `Overførsel` og `Regninger` er generiske
kategoriord som ikke deler noe med butikknavnet, så det finnes ingen prefiks å strippe. Og
`booked-duplicates`-motoren krever prefiks-forhold i beskrivelsene, så den ser dem ikke heller.

Dette rammer **inntekt og overføringer**, ikke forbruk, og er neste tråd. Kandidaten er
`canonical_bank_transaction_aliases`: deler de tre variantene `externalTransactionId`, er de
beviselig samme transaksjon. Ikke undersøkt.
