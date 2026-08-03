# Bilde fra biblioteket, og måltider som gjentas

Dato: 2026-08-03
Status: ferdig

## Kontekst

To ønsker om selve loggeflyten:

1. Kunne legge til bilder fra biblioteket, «så det blir lettere å registrere
   diskré».
2. Kunne gjenbruke måltider, «så en kontorlunsj med knekkebrød og egg kan gjentas».

Begge handler om friksjon i det som skal være en handling på under fem sekunder.

## Faser

### 1. Bildebiblioteket

Ett attributt sto i veien. Bildeknappen brukte

```html
<input type="file" accept="image/*" capture="environment" />
```

og `capture="environment"` **tvinger** kameraet. Et kamera som spretter opp midt i et
møterom er det motsatte av diskret.

Løsningen er et eget felt uten `capture` — da viser iOS bildebiblioteket — og to
knapper framfor én: 🖼 for biblioteket, 📷 for kamera. Bibliotekknappen står først,
siden det er den stille veien inn.

Begge peker på samme `handleFile`; det er bare kilden som skiller.

### 2. Måltider som gjentas

**Utledet av loggen, ikke lagret som favoritter.** En kontorlunsj er ikke en
oppskrift man vil vedlikeholde — det er noe man spiser hver tirsdag uten å tenke. Å
kreve at brukeren først *lagrer* et favorittmåltid legger en ekstra handling foran den
raske veien inn, og favoritter man har glemt å opprette hjelper ingen.

`repeatableMeals` i `$lib/domain/nutrition/repeat-meals.ts` grupperer loggen på
normalisert tittel og returnerer det som er spist minst to ganger.

Detaljene som betyr noe:

- **Rangering på antall, så ferskhet.** Et måltid spist fem ganger er mer sannsynlig
  neste enn ett spist én gang i går — men blant like hyppige vinner det ferskeste.
- **Makroene fra siste forekomst, ikke snittet.** Har brukeren rettet tallene én
  gang, er det de rettede som gjelder videre.
- **Normaliseringen er grunn med vilje.** Små bokstaver og komprimert mellomrom, så
  «Knekkebrød med egg» og «knekkebrød  med egg» er samme måltid. Ikke mer: å strippe
  ord ville slått sammen «kaffe» og «kaffe med melk», som er ulike måltider.
- **Vanlig slot brukes bare ved flertall.** Spises det like ofte til lunsj og kvelds,
  er `usualSlot` null og klokka avgjør — samme regel som den vanlige veien inn.
- **Lista kuttes på seks.** Tretti forslag er ikke raskere å bruke enn å skrive det
  inn.

Trykk på et forslag går **rett i loggen**, uten om estimeringsskjermen. Poenget er ett
trykk. Estimatet gjenskapes med én vare av de lagrede makroene — varelista fra forrige
gang er ikke bevart i loggen, og makroene er det som betyr noe.

## Beslutninger

- **To knapper framfor én med valgmeny.** iOS' egen filvelger tilbyr både bibliotek og
  kamera i én sheet, men det er ett trykk mer, og hele poenget var færre trykk i en
  situasjon der man ikke vil trekke oppmerksomhet.
- **Ingen ny tabell.** Gjenbruk kunne fått en `favourite_meals`-tabell. Loggen vet
  allerede hva som gjentas, og en avledet liste kan ikke bli utdatert.
- **Ingen redigering før lagring ved gjenta.** Man kan rette etterpå — raden er
  redigerbar som alle andre. Å tvinge et bekreftelsessteg ville tatt bort gevinsten.

## Verifisering

- `npm run check`: 0 feil, 0 advarsler.
- `npm test`: 2363 grønne i 184 filer (fra 2351), 12 nye.
- **Kjørt i ekte Chromium mot en ekte database.** Loggeren viser begge bildeknappene
  og ett gjenta-forslag («Lunsj: brødskive med makrell · 245 kcal», logget tre ganger
  i testbasen), uten konsollfeil.

NB: 🖼 rendres som en tom boks i containerens headless Chromium, som mangler
emoji-fonten. Det er et fontproblem i testmiljøet, ikke i appen — iOS har full
dekning for tegnet.

**Ikke dekket av visuell test:** loggeren er bevisst ikke på `/design`, siden den
kaller autentiserte endepunkter og `/design` er en public path.
