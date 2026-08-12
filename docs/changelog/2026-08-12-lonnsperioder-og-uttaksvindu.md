# Lønnsperioder og uttaksvindu

Dato: 2026-08-12
Status: ferdig

## Kontekst

Brukeren så sparekontoflaten i prod og spurte: **«Hvorfor har vi bare én lønnsperiode?»**
Skjermbildet viste tre ting som hang sammen:

- «For lite historikk · Blandet»
- «Trenger 3 hele lønnsperioder, har 1.»
- «11 uttak over 1 lønnsperioder» · «Uttak per måned **11,0**»

Ingen av dem var sanne om økonomien hans. Alle tre kom fra to feil.

Spørsmålet er verdt å merke seg som en produktobservasjon i seg selv: flaten sa hva den
manglet («trenger 3, har 1») men ikke *hvorfor*, og de to mulige årsakene — for kort
banksynk mot en detektor som ikke fant lønna — krever motsatt handling. Å vente hjelper i
det ene tilfellet og aldri i det andre. Derfor er en tredje endring å si hvilken det er.

## Feil 1: nøkkelordtreff gjorde resultatet dårligere

`detectGlobalPayday` valgte kontoen lønna kommer inn på ved å telle hvor mange
kalendermåneder som hadde en transaksjon med et lønnsord. Så langt riktig. Men deretter:

```ts
sourceTxs = salaryTxs.filter((t) => t.accountId === sourceAccountId);
```

Kandidatsettet ble **begrenset til nettopp de radene som traff nøkkelordet**. To tilfeldige
treff — for eksempel en overføring med teksten «Overføring lønn til felles» — ga dermed to
lønnsdatoer, altså **én** hel lønnsperiode, mens et helt år med regelmessige innskudd på
samme konto ble kastet.

**Feilen var inverse, og det er derfor den overlevde.** Fallbacken (`else`-grenen, som
brukes når *ingen* transaksjon bærer et lønnsord) satte kandidatene til alle inntekter på
kontoen. Den SVAKE signalveien fikk altså det rike kandidatsettet, og den STERKE det
fattige. Å finne lønnsordet gjorde resultatet verre enn å ikke finne det.

Rettelsen: nøkkelordene velger **kontoen** og **fingeravtrykket**, aldri kandidatsettet.
Kandidatene er alle inntektene på kildekontoen, i begge grener.

Å utvide er trygt fordi `pickBestPerMonth` gir fingeravtrykket +120 i score: i måneder der
lønnsraden finnes, vinner den fortsatt. Utvidelsen gir bare *dekning* i månedene der ordet
mangler. Fingeravtrykket utledes fortsatt av treffene når de finnes — uten den
innsnevringen kunne en hyppigere fast overføring blitt «lønna», og da flytter alle
lønnsdatoene seg.

Logikken er flyttet ut i `selectPaydaySource`, en ren funksjon uten DB, fordi det var her
feilen satt og fordi `detectGlobalPayday` ikke kunne testes (CLAUDE.md: unngå DB-mocking,
ekstraher logikken).

## Feil 2: `typeText` ble lest som tom streng

```ts
typeText: sql<string>`''`,
```

Nøkkelordsøket leter i `description + ' ' + typeText`. Feltet var hardkodet tomt, så halve
søket var dødt.

Det er **samme felle som `categorizeTransaction` hadde** fram til migrasjon 0055, og den er
verdt å kjenne igjen: `typeText` er SB1s `category`-felt («Lønn», «Nettgiro», «eFaktura»,
«OVERFØRSEL»), og for en lønnsutbetaling er det ofte det *eneste* stedet ordet «lønn» står —
`descriptionDisplay` bærer arbeidsgivers navn. Feltet kom på canonical i 0055 nettopp fordi
den stien var død; detektoren ble ikke koblet på da.

De to feilene forsterket hverandre: uten `typeText` var de ekte lønnsradene usynlige for
nøkkelordsøket, så de eneste treffene ble tilfeldige tekster i beskrivelsen — og feil 1
gjorde nettopp de tilfeldige treffene til hele kandidatsettet.

## Feil 3: «11 uttak per måned» — teller og nevner fra ulike vinduer

`describeWithdrawalPattern` delte **alle** uttakene på **de komplette** periodene.
Uttakslista leses over et bredere spenn enn `periods` dekker, med vilje: flaten skal kunne
vise ferske uttak, også dem i den inneværende måneden som ikke er omme. Med bare én komplett
periode lå de fleste av de elleve uttakene i den halen, og raten ble `11 / 1`.

Samme klasse feil som effort-ankeret: en rate der de to leddene er målt over ulike vinduer.
Den er lett å lage og vanskelig å se, fordi begge tallene er riktige hver for seg.

Rettelsen: uttak plasseres i sin periode først, og **bare de plasserte** teller i rate,
median og største. `lateShare` brukte allerede bare de plasserte, så den var riktig — det er
grunnen til at «25 % sent i måneden» sto ved siden av «11,0 per måned» uten å skurre.

Uttak som ikke kan plasseres telles i `outsidePeriods` og sies med ord på flaten. En stille
utelatelse ville sett ut som at uttakene ikke fantes.

Uttakslista på flaten er nå gated på **lista**, ikke på raten. Ligger alle uttakene i den
ufullstendige perioden, er `count` 0, og en gating på den ville skjult uttak som finnes.

## Beslutninger

- **Ingen kalenderfallback for lønnsperioder.** Det nærliggende grepet — bruk kalendermåneder
  når lønnsdatoene er for få — ble vurdert og forkastet. Lønn lander typisk rundt dag 12–15,
  så «sent i perioden» ville blitt slutten av kalendermåneden, altså **rett etter** neste
  lønn. Diagnosen ville blitt invertert: kassekreditt lest som støtdemper. En stum flate er
  bedre enn en flate som svarer motsatt, og hele poenget med `describeWithdrawalPattern` er
  at posisjonen i lønnsperioden er det som skiller de to.
- **`source` og `candidateCount` føres til flaten**, ikke bare `paydayDates`. «Trenger 3 hele
  lønnsperioder, har 1» er sant og uten vei videre. Nå står det hvor mange lønnsdatoer som
  ble funnet, og om lønna ble *kjent igjen på ordet* eller *gjettet på beløp* — det er
  skillet mellom kort historikk og en gjenkjenningsfeil.
- **Fingeravtrykket beholdt sin innsnevring** til nøkkelordtreffene selv om kandidatsettet
  ble utvidet. Det er de to sidene av samme avveining: bredt sett for dekning, smalt sett for
  gjenkjenning.

## Verifisering

`npm run check` (0 feil) og `npm test` (3 323 tester).

Nye tester på ren logikk:

| Test | Feilen den fanger |
|------|-------------------|
| `lar to tilfeldige nøkkelordtreff ikke slå ut et helt år med innskudd` | Feil 1 — regresjonen. Gir 14 kandidater og ≥12 lønnsdatoer der gammel kode ga 2 og 2. |
| `finner lønna når ordet bare står i typeText` | Feil 2 |
| `velger kontoen med flest MÅNEDER med treff, ikke flest treff` | Kontovalget, som var riktig og skal forbli det |
| `utleder fingeravtrykket av treffene, ikke av det hyppigste innskuddet` | At utvidelsen av kandidatsettet ikke flyttet gjenkjenningen |
| `holder uttak utenfor periodene ute av raten, og teller dem` | Feil 3 — regresjonen |
| `sier «urørt» når alle uttakene ligger utenfor periodene` | At kanten ikke påstår et mønster |

**Ikke verifisert i prod ennå.** Det som skal sjekkes etter deploy, på sparekontoflaten:
antall lønnsperioder (forventet 6, altså trendvinduet fullt), at «Uttak per måned» faller
fra 11,0 til noe rundt 1–2, og at merkelappen «For lite historikk» forsvinner.

## Åpen sak, større enn disse tre

Samme skjermbilde viser **«Dekning regnet mot 180 424 kr/mnd i forbruk siste tre måneder»**.
Fase 1 og 2 målte reelt forbruk til ~42 000 kr/mnd over 365 dager. 180 424 er 4,3× det, og
høyere enn selv brutto-tallet før interne overføringer ble merket (~132 000).

Konsekvensen er alvorlig fordi dekning er en divisjon: 85 384 / 180 424 gir **0,5 måneders
dekning** der svaret mot 42 000 er drøyt to måneder. Flaten leser da som en krise.

Tre hypoteser, ikke rangert, og ingen av dem avgjort ved å lese kode:

1. **Vinduet.** `readMonthlySpend` bruker 92 dager (mai–august) mot diagnosens 365. Ferie og
   husprosjekt ligger i det vinduet, så retningen er plausibel — men ikke størrelsen.
2. **Umatchede interne overføringer.** `findInternalTransfers` krever at *begge* bein finnes
   i canonical. Kontolista på flaten har ingen lønnskonto, så overføringer der motparten er
   en konto vi ikke synker kan ikke matches og blir stående som forbruk.
3. **Et lesested vi ikke har funnet.** Minst sannsynlig etter fase 1, men ikke utelukket.

Neste steg er å måle, ikke gjette — samme regel som ga diagnose-endepunktet. Bankdiagnosen i
`/settings/sources` rapporterer allerede netto månedsforbruk over valgt vindu, så første
måling er å kjøre den på 90 dager og 365 dager og se om de to er uenige. Er de enige om
~42 000, ligger feilen i `readMonthlySpend`; er 90-dagersvinduet også høyt, er det hypotese
1 eller 2, og da må overføringsmatchingen brytes ned per konto.
