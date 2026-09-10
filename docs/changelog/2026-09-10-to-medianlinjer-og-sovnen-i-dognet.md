# To medianlinjer, og søvnen i døgnet

Dato: 2026-09-10
Status: ferdig

## Kontekst

Sykdomsforløpet ble tatt i bruk samme dag det ble bygget, og brukeren leste av
to ting fra sin egen skjerm.

**Én linje er ikke en sammenligning.** Radene tegnet baselinen som en stiplet
strek og punktene over den. Setningen under sa «49 slag/min under forløpet,
6 slag/min over de 14 dagene før (44)» — altså to nivåer — men bare det ene sto
i grafen. Avstanden setningen tallfester var ikke å se noe sted.

**Søvnraden sa 4,6 t** under et forløp der brukeren sov 8–12 timer i døgnet.
Det er ikke en liten skjevhet; det er motsatt retning av det som skjedde.

## Faser

### Fase 1: begge medianene tegnes

`SickEpisodeTrack.svelte` tegner nå to referanselinjer:

- **baselinen** stiplet over HELE bredden — den er referansen alle dagene måles
  mot, også etterdagene der spørsmålet er «kom det tilbake?»
- **forløpsmedianen** heltrukket over BARE sykedagene, der den gjelder

Avstanden mellom dem er tallet setningen oppgir. Det var det som manglet.

Stiplet mot heltrukket, ikke farge mot farge. To grunner: en farge her ville
lest som en dom (forløpet har ingen varselfarge — akutt/kronisk er fortsatt det
eneste signalet som får uttale seg om kroppen), og `preserveAspectRatio="none"`
strekker dashene vannrett, så to ulike stiplinger ville vært umulige å skille.

`episodeAxis` tar nå `during` med i domenet. Det er en **no-op i dag** — en
median av punktene ligger alltid innenfor punktenes eget spenn — og står
likevel, med den begrunnelsen i koden: baselinen har samme linje ved siden av,
og en framtidig endring av hvordan `during` regnes ville ellers flyttet en linje
ut av rammen uten at noe sier fra.

Tegnforklaringen står **én gang**, under datoaksen, av samme grunn som aksen
gjør det: linjene betyr det samme i hver rad. Per rad ville den samme setningen
stått åtte ganger og druknet setningene som faktisk sier noe.

### Fase 2: søvnraden teller døgnet

`episodeSleepByDay` summerer nattesøvn **pluss dupper** per dag. Raden hoppet
før over alt `buildSleepNightSeries` merket som dupp.

Alle andre lesere av søvn holder dupper utenfor, og har rett i det: en flis om
dagen skal ikke dra nattsnittet opp, og «sov du nok i natt» er et spørsmål om
natta. Her er det motsatt, og grunnen er hva et forløp SPØR om. Den som ligger
nede sover om dagen. Det er ikke støy i målingen av nattas søvn — det ER
sykdommen, og det er halve svaret på «hvor mye har kroppen hvilt».

Baselinen regnes av de samme reglene, så sammenligningen holder: på friske dager
finnes det knapt dupper, og de fjorten dagene før flytter seg nesten ikke.

## Beslutninger

**Kilden navngis, selv om det bare finnes én.** Raden sier nå «tid sovet i
døgnet, dupper inkludert». `sleepDuration` er `total_sleep_time` fra Withings,
altså tid SOVET — ikke tid i senga. Åtte timer i senga leses derfor normalt som
seks–sju, og det avviket ser ut som en feil hos den som teller timene sine selv.
Regel 3 i modulen sa «navngi kilden der flere finnes»; her er lærdommen at den
også må navngis der tallet MÅLER noe annet enn ordet på etiketten.

Dette er også halve svaret på «4,6 t»: en del av gapet mot 8–12 er dupper som
falt ut (rettet her), resten er at vi måler søvn og brukeren teller senga.

**Ingen ny tolkning av hva som er en dupp.** `isNap`-inferensen står urørt —
dagtid og under tre timer. Vi kunne slått av nap-klassifiseringen i en
sykeperiode, men da hadde raden fått en annen definisjon enn baselinen sin.
Summen er det som gjør begge sider sammenlignbare.

**Dupper telles ikke separat.** «Hvorav 3,2 t på dagtid» ble vurdert og lagt
bort: en rad til på en flate med åtte rader koster mer enn den sier, og
døgnsummen er tallet spørsmålet handler om.

## Verifisering

- `npm run check` — 0 feil
- `npx vitest run` — 4714 tester i 322 filer, grønt
- Nye tester: `episodeSleepByDay` (dupp lagt til natta, dag med bare dupper,
  avrunding, hull som fravær) og `episodeAxis` (forløpsmedianen får plass)
- Mocken i `/design/flater` bærer den nye kilde-etiketten

Kjent rest: den visuelle baselinen for `sykdomsforlop` må oppdateres
(`npm run test:visual:update`) — begge endringene er synlige.
