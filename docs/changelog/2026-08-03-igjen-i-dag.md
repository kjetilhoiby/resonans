# «Underskudd 2 396 kcal» kl. 07:27

Dato: 2026-08-03
Status: ferdig

## Kontekst

Spørsmålet var: gir det mening å la «forbrent» vokse gjennom dagen?

Svaret er nei, men problemet lå et hakk dypere. Skjermbildet kl. **07:27** viste:

| | |
|---|---|
| Spist | 62 kcal |
| Forbrent | 2 458 kcal |
| **Underskudd** | **2 396 kcal** (i grønt) |

Det ser ut som en prestasjon før frokosten er ferdig, og det er bare at dagen ikke
har begynt.

## Diagnosen

De to sidene måler ulike ting.

- **Forbrent** er et anslag for *hele døgnet*. Hvilestoffskiftet — 2 458 av tallet —
  ligger der fra midnatt.
- **Spist** er *så langt*.

Å trekke det ene fra det andre gir et tall som starter på sitt maksimum og krymper
utover dagen. Det er motsatt av hva «underskudd» i grønt kommuniserer.

Teksten under gjorde det verre: *«Dagen er ikke omme — begge tallene vokser fram til
midnatt.»* Det var sant da forbruket kom fra Withings, som akkumulerer. Vårt eget
anslag vokser ikke — bare øktene legges til. Setningen var blitt feil uten at noen
merket det.

## Løsningen: framoverskuende framfor bakoverskuende

To framinger er hver for seg koherente: begge sider akkumulerer, eller begge sider
gjelder hele døgnet. Feilen var å blande dem.

Men å pro-rate hvilestoffskiftet etter klokka løser bare aritmetikken, ikke
nytteverdien. Før dagen er omme er det ene meningsfulle tallet **hvor mye som er
igjen å spise**. Det er handlingsrettet kl. 07 og kl. 15, det krymper naturlig
gjennom dagen, og det later ikke som dagen er gjort opp.

`frameDay` i `$lib/domain/nutrition/day-framing.ts`:

- **Før midnatt:** «Igjen i dag», målt mot dagsmålet når det er satt, ellers mot
  forbruksanslaget (som tilsvarer å holde vekta). Kortet sier hvilket av de to.
- **Har man spist mer enn grunnlaget:** «Over for i dag», i gult. Verdt å merke,
  ikke å skjelle ut.
- **Etter midnatt, og for historiske dager:** «Underskudd» / «Overskudd» /
  «Balanse», som før — der dekker begge sider samme døgn.

Målet vinner over forbruket i «igjen»-modus fordi det er målet man styrer etter. På
en avsluttet dag er målet irrelevant: da er regnskapet spist mot forbrent.

## Beslutninger

- **Reframing framfor pro-rating.** Vi *kunne* delt hvilestoffskiftet på klokka og
  beholdt «underskudd». Tallet ville blitt aritmetisk riktig og fortsatt ubrukelig —
  et underskudd kl. 07 sier ingenting man kan handle på.
- **«Igjen» mot målet, ikke mot forbruket, når målet finnes.** To ulike spørsmål, og
  brukeren styrer etter det ene.
- **Teksten sier hva den måler mot.** Uten det er 2 538 og 1 161 samme tall for
  leseren.

## Verifisering

- `npm run check`: 0 feil, 0 advarsler.
- `npm test`: 2370 grønne i 185 filer (fra 2363), 7 nye.
- 07:27-tilfellet ligger som test: 62 spist, 2 458 forbrent → «Igjen i dag», ikke
  «Underskudd».
- **Kjørt i ekte Chromium mot ekte database** med profil og dagsmål satt: kortet
  viser «Igjen i dag 2 538 kcal» med 62 spist og et mål på 2 600, og setningen «Mot
  dagsmålet ditt». Ingen konsollfeil.
