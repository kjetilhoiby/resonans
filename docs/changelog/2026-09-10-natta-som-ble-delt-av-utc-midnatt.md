# Natta som ble delt av UTC-midnatt

Dato: 2026-09-10
Status: ferdig

## Kontekst

Sykdomsforløpet sa **4,5 t** søvn siste natt. Health Mate sa **8t00** for den
samme natta (23:34 → 07:41), **13t13** for natta før (20:31 → 12:46) og 6t19 /
6t49 for de to friske nettene foran.

Baselinen vår sa 6,8 t, som stemmer godt med Health Mates 6t19 og 6t49. Det var
altså ikke en systematisk skjevhet i nivået — det var de LANGE, oppstykkede
nettene som forsvant, og de er nøyaktig nettene et sykdomsforløp finnes for.

Skjermbildene forklarer hvorfor: de to sykenettene er fulle av grå
«Våken»-blokker. Withings deler natta i flere `sleep`-events når man er ute av
senga.

## Årsaken

`buildSleepNightSeries` nøklet hvert segment på `end.toISOString()` — altså
UTC-datoen for da segmentet sluttet. To feil i samme linje:

1. **UTC-midnatt ligger kl. 02 om natta i Oslo om sommeren.** Deler Withings
   natta ved en oppvåkning rundt da, får første halvdel gårsdagens dato og andre
   halvdel dagens. Én natt på åtte timer leses som to på fire.
2. **`end ?? start` faller tilbake på LEGGETIDA** når `metadata.enddate`
   mangler, og da havner hele natta et døgn for tidlig.

Feilen er verst nettopp der den gjør mest skade: en natt uten oppvåkninger har
ingenting å dele på og kommer riktig ut. Baselinen så derfor sunn ut mens
sykedagene kollapset.

CLAUDE.md har sagt siden august at nettene skal grupperes på `nightKeyForTime`,
ikke på UTC-datoen. Kommentaren over `nightKeyForTime` påsto til og med at
`buildSleepNightSeries` alt fulgte konvensjonen. Den gjorde ikke det.

## Faser

### Fase 1: én nattnøkkel for alle radene

`segmentKey` i `sleep-overview.ts`:

- **natt** → `nightKeyForTime(start)` — morgenen du våkner, Oslo-tid, grense
  18:00. Samme nøkkel som sovepuls og HRV, som begge går gjennom
  `readNightlyPhysiology`.
- **dupp** → `osloDayKey(start)` — dagen du tok den.

Skillet er ikke pynt. 18:00-grensa er det som gjør natta riktig, og den ville
flyttet en ettermiddagsdupp kl. 18 over til morgendagen. En natt hører til
morgenen du våkner; en dupp hører til dagen.

## Beslutninger

**Fikset i den DELTE leseren, ikke i forløpet.** `buildSleepNightSeries` mater
også Søvn-flaten, og den hadde samme feil: en oppstykket natt sto der som to
korte. Å legge en egen nøkling i forløpet ville gitt to svar på «hvor lenge sov
jeg» — og det er den klassen feil resten av helsedomenet er ryddet for.

**Startet, ikke sluttet.** `nightKeyForTime` tar starttidspunktet, som er det
`readNightlyPhysiology` bruker. Det er den avgjørende grunnen: søvnraden og
pulsraden deler x-akse i forløpet, og to ulike nøkler ville lagt samme natt på
ulike piksler i to rader som ligger rett over hverandre.

**Ingen ny nap-inferens.** `isNap` er urørt. Et sammenhengende segment på fire
timer som starter kl. 08 er ikke en dupp (≥ 3 t) og smelter derfor sammen med
natta — som er nøyaktig det som skal skje med 20:31 → 12:46.

## Verifisering

- `npm run check` — 0 feil
- `npx vitest run` — 4717 tester i 322 filer, grønt
- Tre nye tester: natta delt ved 02-tida i Oslo (2,2 t + 5,5 t → én natt på
  7,7 t datert 10. september), natt uten `enddate`, og dupp kl. 20 som blir
  liggende på sin egen dag
- De sytten eksisterende testene i fila står urørt og passerer

Ikke målt herfra: hvor nær Health Mates tall forløpet lander etter dette. Det
krever DB-tilgang. Baselinen (6,8 t) lå alt nær Health Mate, så det er
sykedagene som skal flytte seg.
