# Dagen som ikke er omme, og tallet uten skala

Dato: 2026-09-11
Status: ferdig

## Kontekst

Forløpsflaten ble lest kl. 08:01, og tre ting sviktet på én skjerm.

**«0 skritt».** Overskriften på skrittraden sto på 0, rett over en setning som
sa «1 950 skritt under forløpet». Aktive minutter sa «0 min» over «5 min under
forløpet». Brukerens dom: *«mye som summerer til null, litt usannsynlig»* — og
det var riktig.

**«−17 ms» uten noe å måle mot.** *«Vanskelig å vite hva −17 i hrv er når det
ikke er skalaer eller referanseverdier noe sted.»* Raden viste avviket, og
avviket alene. Ingen y-akse, ingen baseline.

**Fargen forklarte ikke seg selv.** *«Vet heller ikke hva som er bra og hva som
er bekymringsfullt.»* Gult på tre rader, uten et ord om hvorfor.

## Faser

### Fase 1: en teller som går er ikke et døgn

Skritt og aktive minutter AKKUMULERER fra midnatt. Kl. 08:01 sto dagens rad på
0, og `latest` plukket den som «siste måling». Vekt, puls, søvn og temperatur
gjør ikke dette — en veiing er et punkt, og natta er ferdig i det du våkner.

`accumulates` på radspesifikasjonen. Er den satt, holdes DAGENS dag utenfor
raden i sin helhet: ikke i punktene, ikke i medianen, ikke i nevneren.
`todayExcluded` sier fra, og flaten skriver «i dag teller ikke før døgnet er
omme».

Samme feil som «Underskudd» på en dag som ikke er omme (`frameDay`), og samme
løsning som `buildDailyBalances`, der dager uten forbrukstall droppes framfor å
telle som 0.

### Fase 2: avviket trenger en referanse

To ting manglet, og de er ulike.

**Baselinen navngis nå også på radene som bare viser avvik.** «17 ms under de
14 dagene før (61).» Mot 61 er 17 en fjerdedel; mot 28 er det mer enn
halvparten. Det er *hvor mye* spørsmålet handler om.

**Y-spennet står på kurven**, øverst og nederst til høyre. En linje som dupper
halve rammen sier ingenting om rammen er ti eller hundre enheter høy. Labelene
er HTML, ikke SVG-tekst: `preserveAspectRatio="none"` strekker alt inni svg-en
vannrett.

### Fase 3: fargen sier hva den er

Én setning under tegnforklaringen: «Uthevet tall = flyttet seg den veien et
forløp pleier å flytte den. Det er en observasjon, ikke en vurdering.»

## Beslutninger

**Å navngi baselinen BRYTER ikke «absoluttverdien vises aldri alene» — det er
den regelen innfridd.** Regelen finnes fordi SDNN 44 lest mot en tenkt
normtabell er meningsløst; det finnes ingen slik tabell. Brukerens egen
baseline er den eneste ærlige referansen, og uten den er «−17» ikke et tall,
bare et fortegn. Forløpets EGEN verdi står fortsatt ikke — det er den som ville
blitt lest som en måling med betydning i seg selv, og en test vokter det.

**Vi sier fortsatt ikke hva som er bra eller bekymringsfullt, og det er ikke en
forglemmelse.** Vi måler skjermen, ikke brukeren — akutt/kronisk er det eneste
signalet i hele produktet som får uttale seg om kroppen. Det flaten manglet var
ikke en dom, men en forklaring på hvorfor den trakk oppmerksomhet et sted. Nå
står den.

**Dagen droppes, den merkes ikke som delvis.** En hul prikk eller en stiplet
hale ble vurdert: det er tre nye tilstander i en 44 piksler høy kurve for å
vise et tall som uansett ikke kan leses. Nevneren og fotnoten bærer det i
stedet.

**Nevneren følger med.** «10 av 11 målt» der den ellevte er i dag ville sagt at
en måling mangler. Den gjør ikke det; døgnet er bare ikke ferdig.

## Verifisering

- `npm run check` — 0 feil
- `npx vitest run` — 4726 tester i 322 filer, grønt
- Fem nye tester på `accumulates` (overskrift, median, kurvepunkt, nevner, og
  at en ikke-akkumulerende rad står urørt)
- To eksisterende tester skjerpet: de sa «viser aldri råtallet», og sier nå at
  baselinen navngis mens forløpets egen verdi ikke gjør det

Kjent rest: flaten sier fortsatt ikke om noe er på vei tilbake — en
gjenopprettingssetning («tilbake på nivået fra før») krever etterdager, og en
åpen periode har ingen.
