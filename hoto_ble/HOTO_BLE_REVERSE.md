# Hoto Smart Kitchen Scale – BLE Reverse Engineering

## Mål

Lese vektdata direkte fra Hoto Smart Kitchen Scale (Xiaomi-økosystem) via BLE,
uten Hoto-appen, for integrasjon med Resonans-appen.

---

## Enhetsinformasjon

| Felt | Verdi |
|------|-------|
| Produktnavn | Hoto Smart Kitchen Scale |
| Produsent | Xiaomi / Hoto |
| MAC | `DC:ED:83:84:2E:9D` |
| Firmware | `1.1.3_0010` |
| BLE-protokoll | Xiaomi MiBeacon v3 / MiBle |
| Device type | `0x1180` |
| Capability byte | `0x08` (bond_auth required) |
| auth_mode | `2` (ECC – elliptic curve key exchange) |
| Xiaomi DID | `blt.4.1h37o9hp0gg00` |
| Mi Cloud userId | `6355414136` |
| Mi Cloud server | `de` (Europa / EU-region) |

**MERK:** macOS UUID endres per BLE-session. Finn alltid enheten via scan på
`fe95`-service-UUID – aldri hardkod UUID.

---

## Nøkler (hentet fra Xiaomi Mi Cloud)

Disse er personlige nøkler knyttet til Kjetils Mi-konto. Ikke del.

| Nøkkel | Verdi |
|--------|-------|
| `token` | `e77246463e2eca3d1fdf0a0d` (12 bytes = 24 hex) |
| `beaconkey` | `8094bbd44bf1a5b9d400e147b2c5e221` (16 bytes = 32 hex) |
| `did` | `blt.4.1h37o9hp0gg00` |

**Hvordan nøklene ble hentet:** Via Xiaomi Mi Cloud API (EU/de-server) med
RC4-krypterte API-kall. Se sesjonslogg nedenfor.

---

## GATT-tjenester og karakteristikker

### Tjeneste 1: `0000fe95-...` (Xiaomi Inc.)

| Char UUID (kort) | Egenskaper | Beskrivelse / funn |
|-----------------|-----------|---------------------|
| `00000004` | read | Firmware-versjon: `1.1.3_0010` |
| `00000010` | notify, write-without-response | Aksepterer skriving, ingen svar på noen kommando |
| **`00000017`** | notify, **write** | **Hovednøkkelen.** Krever BLE-bonding (error 0x0F uten). Auth-kanal. |
| `00000018` | notify, write-without-response | Ingen svar observert |
| `00000019` | notify, write-without-response | Ingen svar observert |

### Tjeneste 2: `00000100-0065-6c62-2e74-6f696d2e696d` (MiBle)

| Char UUID (kort) | Egenskaper | Beskrivelse / funn |
|-----------------|-----------|---------------------|
| `00000101` | write-without-response | Kommandokanal – ingen svar på noen kommando |
| `00000102` | notify | Svarkanal – aldri sendt noe |

---

## Nøkkelfunn (oppsummert)

1. **Advertisement-data er statisk.** Vekta sender MiBeacon v3 advertisement, men
   innholdet er konstant – ingen vektdata i advertisement. Data må hentes via GATT.

2. **Char 0x0017 er hovednøkkelen og krever BLE-bonding.** Uten bonding gir
   skriving error `0x0F` (Insufficient Encryption) – eller henger i ~38 sekunder
   til vekta kobler fra. Å abonnere på notify fungerer uten bonding, men vekta
   sender ingenting spontant.

3. **macOS CoreBluetooth støtter ikke eksplisitt pairing fra bleak.**
   `client.pair()` returnerer alltid "Pairing is not available in Core Bluetooth".
   macOS håndterer bonding kun via Systeminnstillinger → Bluetooth, ikke
   programmatisk.

4. **iPhone (via nRF Connect) bonder korrekt.** Writes til 0x0017 lykkes på
   iPhone. Men vekta forblir stille – ingen notify-data – uten rett auth-sekvens.

5. **Protokollen på 0x0017 er ukjent.** Forsøkte commands:
   - `A0 01 00 00` → Write OK (iPhone), ingen respons
   - `01 10 + TOKEN` → "unknown error + disconnected"
   - `01 10 + BEACONKEY` → henger / disconnect
   - `03 00`, `A2 01 00`, `01 00` → "N/A + Disabled" (vekta deaktiverer notify aktivt)
   - AES-CBC challenge-response med BEACONKEY → ingen challenge mottatt fra device

6. **MiBle-tjenesten (0x0101/0x0102) svarer ikke** på noen av de prøvde kommandoene.

7. **Vekta er helt stille uten vellykket auth.** Ingen data på noen kanal.
   Konklusjon: full auth på 0x0017 må fullføres FØR vekta sender noe.

---

## Skript-oversikt

Alle skript ligger i `hoto_ble/`. Kjøres med Python 3 + bleak + pycryptodome.

```
pip3 install bleak pycryptodome
```

### `ble_scan.py` — Første scan og full GATT-dump

**Formål:** Scanne etter alle BLE-enheter, finne Hoto-vekta, koble til og
dumpe ALLE GATT-tjenester, karakteristikker og lesbare verdier. Deretter
abonnere på alle notify-karakteristikker i 15 sekunder.

**Bruk:** `python3 ble_scan.py`

**Status:** Fungerer. Var første skript kjørt. Avdekket GATT-strukturen.

**Viktige funn fra dette skriptet:**
- Firmware `1.1.3_0010` leses fra char `00000004`
- Alle GATT-karakteristikker identifisert
- 0 notify-meldinger mottatt (vekta stille)

---

### `ble_live.py` — Live MiBeacon advertisement-monitor

**Formål:** Fanger BLE-advertisements kontinuerlig fra vekta og dekoder
MiBeacon v3-formatet byte for byte. Viser endringer i real-time og markerer
bytes som endrer seg mellom pakker.

**Bruk:** `python3 ble_live.py`

**Status:** Fungerer, men har én bug.

**Bug:** Linje 97 sammenligner `device.address.upper()` med hardkodet MAC-streng
fra `find_target()`, men macOS UUID-format matcher ikke MAC-format → callback
trigges aldri. Workaround: skriptet fungerer likevel fordi find_target() returnerer
macOS UUID og sammenligningen er mot samme UUID.

**Funn:** Advertisement-data er statisk – ingen vektdata. Capability byte `0x08`
= bond_auth required. Frame control indikerer ingen objekt-payload (bit 6 = 0).

---

### `ble_probe.py` — GATT-probe med kommandosweep (inkl. 0x0017)

**Formål:** Koble til vekta, abonnere på alle notify-chars (inkl. 0x0017),
og sende en bred samling kommandoer til alle skrivbare karakteristikker
(0x0017, 0x0010, 0x0101).

**Bruk:** `python3 ble_probe.py`

**Status:** Fungerer, men 0x0017-writes henger/feiler pga. manglende bonding.

**Viktig funn:** Uten bonding henger writes til 0x0017 i ~38 sekunder til
vekta kobler fra – det maskerer alt annet. Unngå å skrive til 0x0017 uten bonding.

---

### `ble_probe2.py` — GATT-probe uten 0x0017

**Formål:** Samme som ble_probe.py, men hopper over 0x0017. Fokuserer på
0x0010 og 0x0101 (MiBle). Passiv lytting i 8 sek, deretter kommandosweep.

**Bruk:** `python3 ble_probe2.py`

**Status:** Fungerer. Tryggere enn probe.py – unngår heng fra 0x0017.

**Funn:** Ingen respons på noen kommando til 0x0010 eller 0x0101.

---

### `ble_probe3.py` — Minimal probe med tilkoblingsstatus

**Formål:** Minimalt skript som eksplisitt sjekker tilkoblingsstatus hvert
sekund under passiv lytting. Kobler til via eksplisitt `client.connect()` +
`get_services()` (ikke `async with`). Disconnected-callback logger frakobling.

**Bruk:** `python3 ble_probe3.py`

**Status:** Fungerer. Bedre feilsøkingsinfo enn probe2.

**Hvorfor eksplisitt connect:** Oppdaget at `async with BleakClient` noen
ganger kansellerer tidlig på macOS. Eksplisitt connect + disconnect gir mer
kontroll.

---

### `ble_watch.py` — Watch advertisements OG GATT

**Formål:** To-stegsskript: (1) fanger advertisements i 20 sekunder,
(2) kobler til via GATT og lytter i 30 sekunder + sender noen init-kommandoer.

**Bruk:** `python3 ble_watch.py`

**Status:** DEFEKT. Hardkodet macOS UUID `D594DA38-3563-CAA8-B967-9988BEB19F58`
som endres mellom BLE-sessions. Advertisement-overvåkingen finner aldri enheten.
GATT-tilkoblingen feiler fordi UUID-en er utdatert.

**Bruk ikke dette skriptet** uten å erstatte UUID med aktuell verdi fra scan.

---

### `ble_auth.py` — To-delt auth-forsøk

**Formål:** (1) Prøver å trigge macOS-pairing dialog ved å skrive til 0x0017.
(2) Systematisk sweep av MiBle-tjenesten med Xiaomi init-sekvenser, Hoto-spesifikke
gjetninger og enkeltbyte-sweep (0x00–0xFF) til 0x0101.

**Bruk:** `python3 ble_auth.py`

**Status:** Kjørbar, men ineffektiv. 0x0017-writes henger uten bonding.
Sweep avdekket ingen gyldige kommandoer til 0x0101.

**Funn fra dette skriptet:** MiBle 0x0101 svarer ikke på noe.
macOS trigges ikke av 0x0017-writes – ingen pairing-dialog vises.

**Viktig oppdagelse i koden:** `async with BleakScanner(callback)` + 
`asyncio.wait_for(event.wait(), 180)` kansellerer scanning umiddelbart på macOS.
Løst i ble_fast.py og ble_miauth.py ved å bruke looping `BleakScanner.discover(timeout=3)`.

---

### `ble_fast.py` — Rask tilkobling (anbefalt for generell testing)

**Formål:** Kobler til øyeblikkelig når vekta oppdages (callback-basert scanning),
uten å vente på full scan-timeout. Viktig fordi vekta har et begrenset
tilkoblingsvindu (10–15 sek etter knapptrykk). Inkluderer notify-subscription,
0x0017-forsøk og kommandosweep til 0x0101.

**Bruk:** `python3 ble_fast.py` (trykk på vekta mens skriptet venter)

**Status:** Beste generelle tilkoblingsskript. Fungerer pålitelig.

**Teknisk detalj:** Bruker `asyncio.Event` + `detection_callback` for å stoppe
scanning øyeblikkelig. 0.3 sek pause etter scan for at macOS skal registrere
enheten før tilkobling forsøkes.

---

### `ble_miauth.py` — Xiaomi MiBeacon v3 auth-forsøk

**Formål:** Fullt auth-forsøk mot char 0x0017 med nøklene hentet fra Mi Cloud.
Implementerer AES-CBC challenge-response. Abonnerer på ALLE notify-chars inkl.
0x0017. Prøver ulike auth-init sekvenser. Inkluderer vekttolkning av notify-data.

**Bruk:** `python3 ble_miauth.py`

**Status:** Beste utgangspunkt for videre auth-arbeid. Inneholder BEACONKEY
og TOKEN som konstanter. Skriving til 0x0017 lykkes via iPhone (nRF Connect),
men kommandoene som sendes er gale – vekta svarer ikke.

**Nøkler hardkodet:**
```python
BEACONKEY = bytes.fromhex("8094bbd44bf1a5b9d400e147b2c5e221")
TOKEN     = bytes.fromhex("e77246463e2eca3d1fdf0a0d")
```

**Funn:** Ingen challenge sendes spontant fra vekta. AES-CBC med BEACONKEY
ikke bekreftet som riktig auth-mekanisme. Rett byte-sekvens for auth-init er ukjent.

---

## Sesjonslogg

### Session 1 (2026-05-10, tidlig)

**Mål:** Første kontakt med vekta.

- Installerte bleak, kjørte `ble_scan.py`
- Full GATT-dump fullført: to tjenester, 7 karakteristikker dokumentert
- Oppdaget krypteringskrav på 0x0017 (error 0x0F)
- 0 notify-meldinger etter 15 sek passiv lytting
- Batteriene døde under testing

**Konklusjon:** GATT-struktur kartlagt. 0x0017 krever bonding.

---

### Session 2 (2026-05-10, ettermiddag)

**Mål:** Hente Xiaomi-token og implementere auth.

#### Mi Cloud API-innlogging

Forsøkte først å hente token via Mi Cloud API:

1. Implementerte RC4-kryptert Xiaomi Mi Cloud API-klient
   - Autentiseringsprotokoll: nonce + `signed_nonce = SHA256(ssecurity + nonce)`,
     params kryptert med ARC4, SHA1-signatur
   - Første forsøk feilet: feil signing-algoritme
   - Fikset ved å implementere full RC4-flow korrekt

2. Fikk `securityStatus: 16` (2FA kreves for ny IP)
   - Implementerte full 2FA-flow: `authStart` → `sendEmailTicket` → e-postkode
   - Kode mottatt: `478833`
   - `verifyEmail` → serviceToken mottatt

3. Hentet enhetsliste:
   - Forsøkte `v2/home/home_device_list` → feilet (code=-1)
   - Byttet til `home/device_list` → suksess, fant vekta
   - Ekstraherte token: `e77246463e2eca3d1fdf0a0d` (12 bytes)
   - Ekstraherte beaconkey: `8094bbd44bf1a5b9d400e147b2c5e221` (16 bytes)

#### BLE-testing med iPhone og nRF Connect

Siden macOS ikke støtter programmatisk BLE-bonding, testet med iPhone:

- Installerte nRF Connect på iPhone
- Skannet, koblet til vekta, godkjente bonding-dialog
- Aktiverte notify på 0x0017 CCCD → OK
- Prøvde å skrive kommandoer:

| Kommando | Resultat |
|----------|---------|
| `A0 01 00 00` | Write OK, ingen respons |
| `01 00` | "N/A + Disabled" (vekta deaktiverer notify) |
| `03 00` | "N/A + Disabled" |
| `01 10 + TOKEN` | "unknown error + disconnected" |

**Konklusjon:** BLE-bonding fungerer på iPhone. Men rett auth-byte-sekvens
til 0x0017 er ukjent. Vekta sender absolutt ingenting uten korrekt auth.

---

## Auth-protokoll (LØST 2026-05-10)

Auth skjer på **char 0x0019** (`00000019-0000-1000-8000-00805f9b34fb`), ikke 0x0017.
Ingen BLE-bonding trengs. Fungerer direkte fra macOS via bleak.

Protokoll – X25519 ECDH nøkkelutveksling:

```
# Fase 1 – phone sender nonce
→ char0x0019: 00 00 00 0b 01 00
← char0x0019: 00 00 01 01              (scale: klar)
→ char0x0019: 01 00 [16 random bytes]  (phone nonce)
← char0x0019: 00 00 01 00              (scale: mottatt)

# Fase 2 – scale sender nonce
← char0x0019: 00 00 00 0d 01 00
→ char0x0019: 00 00 01 01
← char0x0019: 01 00 [16 bytes]         (scale nonce)
→ char0x0019: 00 00 01 00

# Fase 3 – scale sender pubkey (32 bytes i 2 fragmenter: 18+14)
← char0x0019: 00 00 00 0c 02 00
→ char0x0019: 00 00 01 01
← char0x0019: 01 00 [18 bytes]         (fragment 1)
← char0x0019: 02 00 [14 bytes]         (fragment 2)
→ char0x0019: 00 00 01 00

# Fase 4 – phone sender pubkey (32 bytes i 2 fragmenter: 18+14)
→ char0x0019: 00 00 00 0a 02 00
← char0x0019: 00 00 01 01
→ char0x0019: 01 00 [18 bytes]         (X25519 pubkey fragment 1)
→ char0x0019: 02 00 [14 bytes]         (fragment 2)
← char0x0019: 00 00 01 00              ← AUTH FERDIG

# Status på char 0x0010 etter auth:
← char0x0010: 21 00 00 00   → iOS Hoto-appen (vekta i demo-modus, OTA tilgjengelig)
← char0x0010: 23 00 00 00   → vår script (vekta i demo-modus, OTA ikke trigget)
```

**Skript:** `ble_auth2.py` implementerer dette og fungerer.

---

## Nåværende blokkering: Demo-modus

Vekta heter **"stand demo"** i BLE-advertisements – den er i factory demo-modus.

- iOS Hoto-appen får `21 00 00 00` → starter OTA-sekvens som konfigurerer vekta
- Vår script får `23 00 00 00` → ingen vektdata (demo-modus, begrenset funksjonalitet)

**Hva som må skje:** La iOS Hoto-appen fullføre alle OTA-sesjoner (kanskje 3–5 tilkoblinger).
Når vekta er ferdig konfigurert skal:
1. Bluetooth-navn endre seg fra "stand demo" til "HOTO-dced83842e9d"
2. iOS-appen vise vektdata
3. Vår script sannsynligvis få `21 00 00 00` eller annen data

---

## Neste steg (prioritert rekkefølge)

### 1. Fange iOS-trafikk fra Hoto-appen (anbefalt)

Dette er det sikreste steget for å finne eksakt byte-sekvens.

**Metode A: Apple Bluetooth logging-profil**
```
1. Last ned "Bluetooth Logging" profil fra developer.apple.com
   (krever Apple Developer-konto, gratis nivå OK)
2. Installer profil på iPhone via Settings → General → VPN & Device Management
3. Åpne Hoto-appen, koble til vekta, legg noe på
4. Hent loggfil: Settings → Privacy → Analytics → Analytics Data → sysdiagnose
5. Åpne .btsnoop fil i Wireshark → filter: bluetooth.dst == DC:ED:83:84:2E:9D
```

**Metode B: iPhone BLE-sniffing via Mac (PacketLogger)**
```
# Krever Xcode og iPhone tilkoblet via USB
# Åpne PacketLogger (ligger i /Applications/Xcode.app/Contents/SharedFrameworks/...)
# Alternativt last ned fra: developer.apple.com/download (søk "Additional Tools")
open /Applications/Utilities/PacketLogger.app  # hvis installert
```

**Hva du leter etter i Wireshark/PacketLogger:**
- GATT Write til handle for 0x0017
- De første bytes vekta sender på 0x0017 notify etter tilkobling
- Hele auth-handshake-sekvensen

---

### 2. Referanseimplementasjon: ble_monitor / passive_ble_monitor

Xiaomi MiBeacon v3 auth er dokumentert i open source:

- https://github.com/custom-components/ble_monitor (se `xiaomi.py`)
- https://github.com/Ernst79/bleparser (se xiaomi-seksjonen)
- Søk etter `mibeacon_auth`, `auth_mode 2`, `0x1180`

**Merk:** auth_mode=2 betyr ECC (Elliptic Curve) key exchange, ikke bare
AES-CBC. Det kan kreve at vi genererer et ECC-nøkkelpar og gjør en ECDH-utveksling
med vekta via 0x0017.

---

### 3. Alternativ: Linux-maskin for BLE-bonding

En Linux-maskin (eller Raspberry Pi) med BlueZ støtter full BLE-bonding
programmatisk:

```bash
# bluetoothctl på Linux:
bluetoothctl
  power on
  agent on
  default-agent
  scan on
  pair DC:ED:83:84:2E:9D
  # Godta pairing
  connect DC:ED:83:84:2E:9D
  trust DC:ED:83:84:2E:9D
```

Etter bonding på Linux kan bleak skrive til 0x0017 uten feil.
Kombiner med ble_miauth.py for auth-forsøk.

---

### 4. ECC auth-flow (ble_miauth.py utgangspunkt)

Basert på MiBeacon v3 auth_mode=2 (ECC):

```python
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
# eller ECDH P-256

# 1. Generer eget nøkkelpar
private_key = X25519PrivateKey.generate()
public_key = private_key.public_key()

# 2. Send public key til 0x0017 (auth init)
pub_bytes = public_key.public_bytes_raw()  # 32 bytes
await client.write_gatt_char(CHAR_0017, b'\x01\x10' + pub_bytes)

# 3. Les device's public key fra 0x0017 notify
# 4. ECDH: shared_secret = private_key.exchange(device_pub_key)
# 5. Avled session key fra shared_secret + BEACONKEY
# 6. Send auth-bekreftelse

# Viktig: token er 12 bytes, ikke standard 16 – kan bety annen nøkkelderivering
```

---

## Tekniske noter

### Kjent bug: macOS BLE-scanning

`async with BleakScanner(callback)` + `asyncio.wait_for(event.wait(), timeout)`
kansellerer scanning umiddelbart på macOS (callback kalles aldri).

**Løsning:** Bruk looping discover:
```python
for _ in range(60):  # prøv i maks 60 * 3 = 180 sekunder
    results = await BleakScanner.discover(timeout=3, return_adv=True)
    for addr, (d, adv) in results.items():
        if XIAOMI_SVC in (adv.service_data or {}):
            return addr
```

Alternativt: `async with BleakScanner(cb)` + `await found.wait()` (uten
`asyncio.wait_for`) fungerer noen ganger – usikkert på macOS.

### Token-lengde

Token fra Mi Cloud er 24 hex tegn = 12 bytes. Standard Xiaomi token er 16 bytes.
De 12 første bytene kan være bare den delen som er relevant for BLE-auth, eller
det kan bety at nøkkelderiveringen er annerledes enn vanlig.

### Vektas tilkoblingsvindu

Vekta advertiser i kun 10–15 sekunder etter knapptrykk, så gå raskt til
skanning. Etter tilkoblingen holder den seg tilkoblet inntil auth-timeout eller
frakobling.

### GATT error 0x0F

"Insufficient Encryption" (ATT error 0x0F) betyr link-layer kryptering kreves.
Dette er BLE bonding – ikke å forveksle med applikasjonsnivå-autentisering.
Begge lag kreves for å lese data fra 0x0017.

---

## Nyttige lenker

- [bleak docs](https://bleak.readthedocs.io/)
- [ble_monitor Xiaomi parser](https://github.com/custom-components/ble_monitor/blob/master/custom_components/ble_monitor/ble_parser/xiaomi.py)
- [MiBeacon v3 protocol](https://github.com/custom-components/ble_monitor/blob/master/documentation/passive_ble_monitor_support.md)
- [passive_ble_monitor](https://github.com/Ernst79/bleparser)
- [nRF Connect iOS](https://apps.apple.com/app/nrf-connect-for-mobile/id1054362403) – for manuell testing på iPhone
- [Wireshark BLE filter](https://wiki.wireshark.org/Bluetooth) – for trafikk-analyse
