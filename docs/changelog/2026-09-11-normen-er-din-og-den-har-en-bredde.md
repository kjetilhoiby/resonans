# Normen er din, og den har en bredde

Dato: 2026-09-11
Status: ferdig

## Kontekst

Brukeren avviste innrammingen flaten hadde fått samme morgen:

> *«Jeg tror ikke "bekymringsfullt" er forklaringen jeg leter etter, men heller
> hvor langt fra normen vi er og hvilken retning det går. […] jeg håper jo at
> noen av dem kanskje vil være gode indikatorer på at det er tryggere å gå
> tilbake til vanlig aktivitet uten å risikere tilbakeslag.»*

Og la til det som gjorde det byggbart:

> *«Siden norm er individuelt — vi har jo historikken min, og kan lage normer
> basert på målinger med identisk utstyr.»*

Det er en bedre innramming enn den som sto. «Er dette bekymringsfullt» er et
klinisk spørsmål vi ikke kan svare på. «Hvor langt fra MITT normale, og går det
riktig vei» er et spørsmål om brukerens egne tall — og det kan besvares helt
uten å uttale seg om kroppen.

**Baselinen ga avviket et NIVÅ å måle fra, men ikke en SKALA å måle i.** 17 ms
er mye om du normalt svinger 4 ms fra natt til natt, og støy om du svinger 20.
Den forskjellen lå i historikken hele tiden.

## Faser

### Fase 1: normalområdet (`$lib/domain/health/normal-band.ts`)

p10–p90 av brukerens friske dager siste `NORM_WINDOW_DAYS` (180).
«Ni av ti friske dager ligger her» er en setning man kan lese høyt.

- `rankInNormal` — andelen friske dager under verdien. «Lavere enn 96 % av dine
  friske netter» trenger ingen skala ved siden av seg.
- `distanceOutside` / `normalDirection` — er de ferskeste målingene på vei MOT
  båndet?
- `recentValue` — medianen av de tre siste, ikke siste måling.

### Fase 2: radene

`buildEpisodeTrack` tar friske verdier og får `normal`, `normalText`,
`returnText`. Båndet tegnes som et kromafritt felt bak kurven, så «hvor langt
fra det vanlige» blir noe man SER.

### Fase 3: én linje øverst

`describeReturnSummary`: «3 av 5 signaler er tilbake i ditt vanlige. Utenfor:
hrv, sovepuls.» — med forbeholdet innbakt i samme setning.

## Beslutninger

**Persentiler, ikke snitt ± standardavvik.** Et standardavvik forutsetter en
form på fordelingen vi ikke har sjekket, og én natt med dårlig sensorfeste
blåser det opp. En test viser det: en utligger på 400 i et sett rundt 50–70
flytter p90 under to enheter.

**Sykedagene er UTE av normen, og de sju dagene etter også.** Uten det måler
forløpet seg mot et normalområde det selv har vært med på å utvide — og jo
oftere man er syk, desto mindre unormalt ser sykdom ut. Dagen du friskmelder
deg er dessuten ikke dagen kroppen er tilbake; det er hele grunnen til at denne
flaten finnes.

**Retningen måles i AVSTAND TIL BÅNDET, ikke i verdi.** En HRV som stiger fra
44 til 51 nærmer seg båndet nedenfra; en sovepuls som faller fra 55 til 49
nærmer seg ovenfra. Retningen i verdi er motsatt, retningen mot normalen er den
samme — og det er den som betyr noe. To tester, én per side.

**Terskelen for «en retning» er en ANDEL av båndets bredde** (15 %), ikke et
absolutt tall. Da er den den samme i ms, slag og timer uten at noen setter tre
konstanter som driver fra hverandre.

**Halvår, ikke lengre og ikke kortere.** Kortere, og en enkelt treningsperiode
eller årstid ER normen. Lengre, og man blander inn en kropp og et utstyr som
ikke er dagens — `hr-trust-periods.ts` finnes nettopp fordi utstyr skifter uten
å si fra. Brukerens eget poeng om identisk utstyr er derfor innfridd omtrent,
ikke eksakt: **vi har ingen utstyrslogg for søvnsensorene**, og et halvår er en
antakelse om at ingenting byttet, ikke en sjekk på at det ikke gjorde det.

**`describeReturnSummary` sier i samme setning at den ikke er en klarering**,
og en test krever at den setningen står i hver variant. Dette er det nærmeste
flaten kommer «er det trygt å gå tilbake til vanlig aktivitet», og grunnen til
at den ikke svarer er konkret: ingen av disse målingene skiller en kropp som
tåler belastning fra en som ikke gjør det. Et tall som leses som en klarering
er verre enn intet tall.

**Persentilen sies BARE utenfor båndet.** «Høyere enn 43 % av dem» betyr «midt
i normalen» — en presisjon uten innhold.

**Båndet er kromafritt.** Fikk det en kulør, ville det konkurrert med kurven og
lest som en dom om hvilken sone som er riktig å ligge i.

## Verifisering

- `npm run check` — 0 feil
- `npx vitest run` — grønt
- 16 nye tester på `normal-band` (persentiler, gulvet for antall, robusthet mot
  utligger, rangering, retning fra begge sider, median av halen)
- 10 nye tester på radene og sammendraget

## Kjent rest

**Ingen utstyrslogg.** Brukeren spurte eksplisitt om «målinger med identisk
utstyr», og 180 dager er en tilnærming til det. Et bytte av søvnmatte eller
klokke midt i vinduet ville flyttet båndet uten at noe sier fra — samme klasse
som `hr-trust-periods.ts` løser for pulsdata, og den samme løsningen (perioder
med dom per periode) er veien.

**Forløpene sammenlignes ikke med hverandre.** Brukerens hypotese — *«HRV er
kanskje noe som blir brått verre og sakte bedre»* — kan bare besvares av deres
egen historikk over flere forløp: hvor mange dager tok hvert signal på å komme
tilbake, sist? Dataene finnes (perioder + bånd + dagsverdier), men ingenting
regner det ennå. Det er den neste tingen som faktisk ville svart på spørsmålet,
og den kan ikke svares av litteratur — bare av gjentakelse.

**Retningen leses av tre målinger.** På rader som måles sjelden er det et
tynt grunnlag, og `DIRECTION_SAMPLES` er ikke justert per rad.
