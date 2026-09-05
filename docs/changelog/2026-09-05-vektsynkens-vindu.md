# Vektsynkens vindu spurte på feil tidspunkt

Dato: 2026-09-05
Status: ferdig

## Kontekst

Brukeren veide seg på vekta OG registrerte vekta manuelt i Health Mate. Ingen
push kom, og tallet på Vekt-flaten sto stille resten av dagen.

Alt så friskt ut: `/api/diagnostikk` viste 280 cron-kjøringer i vinduet, alle
`success`, med `/api/cron/withings-sync` hvert femte minutt på 2–3 sekunder.
Ingen `lastError`, ingen feilet jobb, ingen 500.

## Feilen

`getmeas` sine `startdate`/`enddate` filtrerer på **målingens dato**
(`grp.date`) — ikke på når Withings fikk den. `syncWeightData` satte
`startdate = sensor.lastSync`, og `lastSync` stemples `new Date()` på slutten av
hver kjøring, altså hvert femte minutt.

Vinduet dekket dermed bare målinger **datert de siste fem minuttene**. Alt som
når Withings med en eldre dato faller utenfor hvert eneste framtidige vindu og
hentes aldri:

- En **manuell registrering** i Health Mate, der man selv velger tidspunkt.
  Legger du inn morgenens veiing ved lunsj, er den datert fem timer tilbake.
- En **veiing som lastes opp forsinket** — vekta sto uten nett. Withings beholder
  tidspunktet man sto på vekta, ikke tidspunktet den kom fram.

Begge deler skjedde her, og det er derfor begge forsøkene forsvant.

**Aktivitet og økter hadde overlappsvinduet fra før** (`overlapDate.setDate(-7)`,
med kommentaren «to catch retroactive updates»). Vekt, VO2max og temperatur
hadde det aldri — de tre yngste `getmeas`-kallerne arvet aldri lærdommen.

Pushen er et offer, ikke en årsak: `notifyWithingsSyncResults` spør etter rader
med `createdAt >= syncStartTime`. Ingen ny rad, ingen push. Krydderet fra i går
var aldri i nærheten av å kjøre.

## Faser

### Fase 1: `measureSyncWindow` i domenelaget

Ren funksjon i `$lib/domain/health/withings-sync-window.ts`, der gulvlogikken alt
bodde. Tre stier:

- `fullSync` → `startdate` fra gulvet (gulvet er en påstand om målingens dato).
- `toDate` satt (backfill dag for dag) → bundet `startdate`/`enddate`.
- ellers → `lastupdate = min(lastSync, nå − 7 døgn)`.

### Fase 2: De tre `getmeas`-kallerne

`syncWeightData`, `syncVo2maxData` og `syncTemperatureData` spreder vinduet inn i
kallet. `describeMeasureWindow` skriver hvilken av de to spørsmålsformene som
gjaldt i logglinja.

## Beslutninger

**`lastupdate` framfor et `startdate`-overlapp.** Withings' egen dokumentasjon
peker på `lastupdate` for synkronisering: den filtrerer på når målingen ble
opprettet eller endret. Et overlapp på sju dager ville fanget dagens tilfelle,
men fortsatt bommet på en registrering tilbakedatert lenger enn sju dager — og
en manuell registrering er nettopp det som kan være det.

**Gulvet på sju dager gjør fiksen umulig å tape på.** En måling kan ikke være
opprettet før den er datert, så alt et `startdate = nå − 7d` ville gitt oss er
også med i `lastupdate = nå − 7d`. Den nye stien kan derfor ikke hente MINDRE
enn overlappsvarianten, bare mer. Det var avgjørende her: `lastupdate` kunne
ikke prøvekjøres mot den ekte kontoen fra utviklingsmiljøet, og en synk som
stille slutter å hente er verre enn den feilen vi retter.

**Gulvet lukker også et lite, permanent hull.** Hentingen skjer i starten av
kjøringen, `lastSync` stemples på slutten — de 2–3 sekundene kjøringen varer var
et gap hver eneste runde.

**Ingen ny markørkolonne.** Det fristende er et eget «sist hentet»-felt per
datatype. `lastSync` finnes, og med gulvet er presisjonen dens uten betydning.

**Loggen sier hvilken spørsmålsform som gjaldt.** «endret siden» og «datert fra»
er ulike spørsmål, og en logglinje som ikke skiller dem kan ikke brukes til å
avgjøre hvorfor en måling uteble — som er nøyaktig det som manglet i dag.

**VO2max og temperatur ble med.** Samme kall, samme vindu, samme feil. Å rette
vekt alene ville etterlatt to kopier av den rettede feilen i samme fil.

Sleep bruker datostrenger (`toISOString().split('T')[0]`) og har dermed opptil et
døgns implisitt slakk. Ikke rørt her.

## Verifisering

- Åtte nye tester i `withings-sync-window.test.ts`, blant dem at
  `lastupdate` aldri havner over et `startdate`-overlapp på sju dager (fiksen kan
  ikke hente mindre enn alternativet), og at full sync og backfill beholder
  `startdate`.
- `npm test`: 4584 tester i 315 filer, grønt. `npm run check`: 0 feil.

**Dagens manglende veiing henter seg selv inn.** Målingen ble opprettet hos
Withings i dag, altså innenfor `nå − 7 døgn`: første synk etter deploy tar den,
skriver raden, og pushen fyrer fordi raden er ny.

## Kjent rest

- **Ingen vakt mot at det skjer igjen.** En ny `getmeas`-kaller kan fortsatt
  skrive sitt eget `startdate = lastSync`. En test som ser etter det mønsteret i
  synkfila ville vært `sensor-event-access.ts`-vakta i en annen forkledning.
- Søvnsynken har fortsatt dagsoppløsning på vinduet.
- En manuell veiing registrert i Resonans selv gir fortsatt ingen push —
  varslingen henger på Withings-synken.
