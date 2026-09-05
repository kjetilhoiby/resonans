# Vi målte ingenting om verten, og det kostet tre dager

Dato: 2026-09-04
Status: ferdig

## Kontekst

3. september sto VPS-en stum i drøyt førti minutter. Tre uavhengige apper var
nede, Coolifys eget API svarte ikke, TCP på 80/443 ble akseptert mens ingen
HTTP-respons fullførte.

Det tok tre dager å forklare, og forklaringen ble til slutt lest ut av `dmesg`
i en webterminal på en telefon:

```
Thu Sep 3 12:54:22  oom-killer → drepte systemd
Thu Sep 3 12:56:07  oom-killer → drepte node
Thu Sep 3 13:20:33  oom-killer → drepte node
```

`constraint=CONSTRAINT_NONE`, `global_oom`: hele maskinen gikk tom, ikke en
container som traff sin cgroup-grense. Hetzner vServer, 3,9 GiB, **null swap**.

Ved OOM-tidspunktet:

| | |
|---|---|
| Anonymt minne | 3,36 GiB |
| **Page cache** | **1 388 kB** |
| Ledig | ~87 MB |

Page cachen er tallet som forklarer frysen. Kjernen hadde kastet ut alt som
kunne kastes ut, og call-tracen viser `apport` som page-faulter på **sin egen
programkode** (`filemap_fault`, «Unable to access opcode bytes»). Hver prosess
leste instruksjonene sine fra disk. Det var «CPU-toppen» — ikke arbeid.

## Hvorfor det tok tre dager

**Vi målte ingenting.** Null treff på `loadavg`, `/proc/stat` eller minnebruk i
hele kodebasen. Diagnosen ble derfor en diskusjon i stedet for et oppslag, og
den gikk gjennom tre forkastede hypoteser:

1. **Full disk** — avkreftet, 32 % brukt.
2. **Vår egen jobbkø** — avkreftet: 20 sekunder cron-arbeid på tretti minutter,
   identisk med en normal halvtime.
3. **CPU steal** — plausibel og feil.

Verst: **minne ble AVSKREVET to ganger** fordi Coolifys graf viste 78 %. Den
samplet bort toppen. OOM-killeren var det eneste vitnet som hadde vært til
stede, og den ble ikke spurt før på dag tre.

## Hva

Cron-dispatcheren tikker hvert minutt uansett. Den leser nå `/proc/meminfo` og
`os.loadavg()` og skriver en rad i `host_samples`. Vinduet eksponeres på det
åpne `/api/diagnostikk`, ved siden av cron og jobbkøen.

## Beslutninger

**En TABELL, ikke en ringbuffer i minnet.** Hendelsen dette finnes for er
nettopp den der prosessen blir OOM-drept — en minnebuffer ville mistet akkurat
det beviset. Sju dagers oppbevaring, ryddet probabilistisk som
`pruneOldClaims`.

**`cached` er feltet som avslører kollapsen.** `available` alene ville ikke
vist det like tydelig, siden den teller page cache som tilgjengelig — og det er
nettopp når cachen ER borte at det er alvor. `CACHE_COLLAPSE_KB` (50 MB) er
romslig: vi leter etter fritt fall, ikke etter travelhet. Målt ved OOM: 1 388 kB,
mot ~1,4 GiB i normal drift.

**`worst` er den laveste tilgjengelige, aldri et snitt.** Et snitt ville
glattet bort toppen på nøyaktig samme måte som Coolifys graf gjorde. «Hvor nære
var vi» er spørsmålet, og det besvares av minimum.

**Samplingen skjer FØR lederlås-sjekken i dispatcheren**, med vilje:
øyeblikkene vi bryr oss om er de der lederskapet kan være i ferd med å ryke. En
standby-instans som måler er mer verdt enn en tapt måling. To rader samme minutt
under rullende oppdatering er forventet — `instance` skiller dem.

**Domenelaget sier MEKANISMEN, ikke bare tallet.** `describeHost` skriver «page
cache nede i 1 MB — kjernen har ingenting igjen å frigjøre, og prosesser leser
egen kode fra disk». Et tall alene ville krevd den samme tre dager lange
tolkningen på nytt.

**En delvis måling gir `null`.** Mangler et felt i `/proc/meminfo`, returnerer
parseren ingenting framfor et halvt objekt — et hull i en graf er ærlig, en
plausibel feil verdi er ikke.

**`Cached` må matches med ordgrense.** `SwapCached` står rett etter i fila og
ville truffet en løs prefikssjekk. Feilen ville vært stum: et plausibelt tall av
feil størrelse. Egen test.

**Sampling feiler stille.** En manglende måling skal aldri kunne stoppe cron.

## Verifisering

| Sjekk | Resultat |
|---|---|
| `npm test` | 4438 tester i 307 filer, grønt (13 nye) |
| `npm run check` | 0 feil, 0 advarsler |
| `readHostSample()` mot ekte `/proc/meminfo` | leste maskinens virkelige tall |
| Lagring → lesing mot ekte PostgreSQL | rad skrevet og lest tilbake |
| `worst` mot en plantet krise (cache 1 388 kB, swap 0) | valgte krisa, ikke snittet |
| Dommens tekst | «2 % av minnet tilgjengelig; page cache nede i 1 MB — … leser egen kode fra disk; ingen swap: maskinen går fra trangt rett i OOM» |
| `latest` med krisa ti minutter tilbake | ferskeste måling, ikke krisa |
| Feltet i `/api/diagnostikk`-svaret | til stede |

## Gjort på verten samme dag

- `apport` skrudd av. Den fyrte OOM-killeren tre ganger 3. september: Ubuntus
  krasjrapportør våknet for å samle core dump av en drept Node-prosess **under**
  minnepresset, og ble dermed en tilbakekoblingssløyfe.
- **4 GB swapfil lagt til**, permanent i `/etc/fstab`. Fjerner ikke årsaken, men
  gjør spiken ufarlig: forskjellen mellom «treg i et minutt» og «førti minutter
  nede med drepte prosesser».

## Fase 2: ett navn på tidspunktet (5. september 2026)

`latest` og `worst` la tidspunktet på **`at`**, mens radene i `samples` la det
på **`sampledAt`**. To navn på samme sak i én payload.

Feilen er stum til noen leser feltet. Den ble funnet ved at et leseskript,
skrevet mot `samples` og deretter pekt på `worst`, kastet
`KeyError: 'sampledAt'` — altså ikke av en test, men av bruk.

- Begge bygges nå av **`toHostHighlight`** i domenelaget. Formen ligger ett
  sted framfor i to objekt-literaler, og har en test på seg: at feltet heter
  `sampledAt`, at `at` IKKE finnes, at dommen er `describeHost`' egen, og at de
  to har identisk feltsett uansett hvilken rad de får.
- `latest` og `worst` peker inn i `samples`, så de bærer `memAvailableKb` og
  `cachedKb` med seg. Dommen kan da veies uten et oppslag i radlista. `latest`
  gjorde det ikke før — nok en asymmetri mellom to felt som skal leses likt.
- Regresjonen er verifisert: med `at` tilbake feiler testen.

Ingen konsument utenfor `/api/diagnostikk` leste feltene, så navnebyttet
brekker ingenting.

## Målt: 07:00-hypotesen holdt ikke (5. september 2026)

Første døgn med data. **Timen gikk uten en skramme.**

- **Ingen hull.** 0 av 17 minutter manglet i 06:50–07:06, og cron gikk 06:50,
  06:55, 07:00, 07:05 på sekundet. Sammenlign med 3. september, der begge
  OOM-ene etterlot 10–11 minutters hull i nøyaktig de samme tidsstemplene.
- **Ett minutt med press, absorbert av swap.** 06:50: page cache falt 0,96 →
  0,68 GiB og 150 MB gikk ut i swap på ett minutt, load1 1,69. Minuttet etter
  var swapen tilbake til 567 MB og cachen på 0,79 GiB. Det er mekanismen som
  forrige uke ikke hadde noe sted å gå.
- **Lavest tilgjengelig i vinduet var 06:36: 1,77 GiB (47 %)**, med cache på
  1,35 GiB — altså trangt, ikke kollaps.
- **Registeret har ingenting på 07:00 UTC** utover de vanlige `0 * * * *` og
  `*/5`. Peker det seg ut noe der, er det utenfor appen: verts-cron,
  `unattended-upgrades`, eller Coolifys egne oppgaver.

**Klokkeslettene i `dmesg` er UTC, og det er nå bevist framfor antatt.**
Cron-tidsstemplene 3. september har hull 12:45→12:56 og 13:10→13:20; dmesg
melder OOM-drap 12:54:22, 12:56:07 og 13:20:33. De faller sammen på minuttet.
Konsekvensen er at drapene 4. september kl. 07:00:49 og 07:01:50 var
**07:00 UTC = 09:00 Oslo** — ikke 07:00 Oslo, som en tidligere lesning her
kunne invitert til.

Sidefunn i samme vindu, ikke fulgt opp: `/api/cron/background-jobs` brukte
**327 sekunder** kl. 06:00 og kom tilbake som `partial`. Resten av 06:00-klasen
lå på 5–13 sekunder.

## Kjent rest

- **Hva som spiser ~2 GiB forbigående er fortsatt ikke funnet.** I normal drift
  bruker containerne 1,2 GiB av 3,7. 07:00-hypotesen er svekket (se over), så
  rullende oppdatering — to containere à 2 GiB kortvarig — står igjen som
  hovedkandidat. Med swap på plass er spiken uansett ufarlig, så dette er nå et
  spørsmål om forståelse framfor om drift.
- Over halvparten av containerne har ingen minnegrense (`coolify`,
  `pdpykw3rc…`, sentinel, realtime, db, redis, proxy).
- Vi sampler ikke CPU (`/proc/stat`), så steal og iowait er fortsatt ukjent.
