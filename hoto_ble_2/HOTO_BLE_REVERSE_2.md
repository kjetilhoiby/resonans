# Hoto BLE Reverse Engineering — Sesjon 2

## Status (oppdatert 2026-05-11)

Komplett iOS-binding + auth + veiing fanget med PacketLogger. Hele protokollen er
kartlagt ende-til-ende. Krypto-familien identifisert som Xiaomi MiBLE/Mi Standalone
SDK (samme som Yeelight smart bulb).

**To kjente blokkeringer for vår egen implementasjon:**
1. Eksakte HKDF salt/info-strenger ukjent (sannsynligvis `"miot-bind-…"` el. lign.)
2. Plaintext-struktur for 24 B proof ukjent (3 sannsynlige kandidater)

Alt rundt er kartlagt.

---

## Vekta er ute av demo-modus

Vekta heter nå **`HOTO-dced83842e9d`** i BLE-advertisement (tidligere "stand demo").
GATT Device Name-karakteristikken returnerer fortsatt "stand demo" — det er en
firmware-bug og er irrelevant.

iOS-appen fullfører nå binding suksessfullt og kommuniserer normalt.

---

## GATT-mapping (denne vekta, fra Read By Type Response)

| Char UUID (kort) | ATT handle | Egenskaper       | Rolle                              |
|------------------|------------|------------------|------------------------------------|
| `0x0004`         | 0x0010     | read             | Firmware version (`1.1.3_0010`)    |
| `0x0010`         | 0x0012     | notify+wnr       | **Control channel**                |
| (CCCD 0x0012)    | 0x0013     | write            | Notify-toggle for control          |
| `0x0019`         | 0x0015     | notify+wnr       | **Data channel** (bind/auth-fragmenter) |
| (CCCD 0x0015)    | 0x0016     | write            | Notify-toggle for data             |
| `0x0017`         | 0x0018     | notify+w         | **UBRUKT** av iOS – glem den       |
| `0x0018`         | 0x001B     | notify+wnr       | (ubrukt)                           |
| `0x0101` (MiBle) | 0x001F     | write-no-resp    | Encrypted command (post-auth)      |
| `0x0102` (MiBle) | 0x0021     | notify           | **Encrypted weight stream** (post-auth) |
| (CCCD 0x0021)    | 0x0022     | write            | Notify-toggle for weight stream    |

Den tidligere antagelsen om at char 0x0017 var "hovednøkkelen" var feil. iOS rører
den aldri. Vi skal heller ikke.

---

## Ingen link-layer pairing nødvendig

PacketLogger-fangsten viser **null HCI-encryption/pairing/bonding-events** mellom
iPhone og vekta. Hele protokollen kjører på rene ATT-writes/notifies. Glem alt om
`client.pair()`, BlueZ-bonding og GATT error 0x0F — det var blindspor.

---

## Protokollfamilien er Xiaomi MiBLE / Mi Standalone SDK

Vi har funnet referansedokumentasjon for en nesten identisk protokoll i en gist
fra Yeelight smart bulb (MJDP09UL):
[kabbi/32658d7d3a086cd47d877882933a9908](https://gist.github.com/kabbi/32658d7d3a086cd47d877882933a9908).

| Felt              | Yeelight (kjent) | Hoto vekt        |
|-------------------|------------------|------------------|
| Service           | `fe95`           | `fe95` ✓         |
| Control char      | `0x0010`         | `0x0010` ✓       |
| Data char         | `0x0016`         | `0x0019`         |
| Frame format      | idx LE16 + data  | idx LE16 + data ✓|
| Pubkey-størrelse  | 64 B             | 64 B ✓           |
| Kurve             | **SECP256R1**    | sannsynlig samme |
| Krypto            | AES-CCM, tag 4 B | sannsynlig samme |
| KDF               | HKDF-SHA256, 64 B output | sannsynlig samme |

### Magic-koder på control-kanalen

| Yeelight   | Hoto (bind) | Hoto (auth) | Betydning            |
|------------|-------------|-------------|----------------------|
| `50000000` | `a2000000`  | `24000000`  | Start handshake      |
| `51000000` | `11000000`  | `21000000`  | Suksess              |
| —          | `12000000`  | `23000000`  | Feil (proof / nøkkel ukjent) |
| —          | `15000000`  | —           | Bind fase-2 trigger  |
| —          | `13000000`  | —           | Bind finalize        |

### Fragment-type-koder på data-kanal

| Type | Retning   | Innhold                                       |
|------|-----------|-----------------------------------------------|
| 0x00 | begge     | Generisk fragment (DID, 24 B proof, …)        |
| 0x03 | begge     | 64 B P-256 public key                         |
| 0x0a | phone → scale | 32 B ephemeral pubkey (auth-fase)         |
| 0x0b | phone → scale | 16 B nonce (auth-fase)                    |
| 0x0c | scale → phone | 32 B ephemeral pubkey (auth-fase)         |
| 0x0d | scale → phone | 16 B nonce (auth-fase)                    |

---

## Komplett protokollflyt

### Fase A: BIND (én gang, eller når enhet skiftes)

```
# Setup
→ 0x0013 (CCCD): 0100                            # enable notify på control
→ 0x0016 (CCCD): 0100                            # enable notify på data
→ 0x0012 (control): a2000000                     # bind init

# DID-utveksling: scale identifiserer seg
← 0x0015 (data): 00 00 00 00 02 00               # announce: type=0x00, 2 frags
→ 0x0015:        00 00 01 01                     # phone ready
← 0x0015:        0100 [01 00 00 00 00 00] "blt.4.1h37o9h"  # frag 1 (18 B m/6 B prefix)
← 0x0015:        0200 "p0gg00"                   # frag 2 (8 B)
→ 0x0015:        00 00 01 00                     # phone ack

# Phone trigger fase-2
→ 0x0012: 15000000

# Phone sender 64 B SECP256R1 pubkey
→ 0x0015: 00 00 00 03 04 00                      # announce: type=0x03, 4 frags
← 0x0015: 00 00 01 01                            # scale ready
→ 0x0015: 0100 [18 B X-koord, del 1]
→ 0x0015: 0200 [18 B X-koord/Y-koord overgang]
→ 0x0015: 0300 [18 B Y-koord, del 2]
→ 0x0015: 0400 [10 B Y-koord, slutt]             # total 64 B = 32 B X || 32 B Y
← 0x0015: 00 00 01 00                            # scale ack

# Scale svarer med sin egen 64 B P-256 pubkey
← 0x0015: 00 00 00 03 04 00
→ 0x0015: 00 00 01 01
← 0x0015: [4 frags, total 64 B = scale_pub X||Y]
→ 0x0015: 00 00 01 00

# Phone re-skriver CCCDs (uklart hvorfor, kanskje for å holde notify aktiv)
→ 0x0016: 0100
→ 0x0013: 0100

# Phone sender 24 B "proof" (krypto-bevis at det kjenner cloud-key)
→ 0x0015: 00 00 00 00 02 00                      # announce: type=0x00, 2 frags
← 0x0015: 00 00 01 01
→ 0x0015: 0100 [18 B encrypted]
→ 0x0015: 0200 [6 B encrypted + tag]
← 0x0015: 00 00 01 00

# Finalize
→ 0x0012: 13000000
← 0x0012: 11000000                               # ✅ BIND SUKSESS
                  (12000000 = feil 24 B proof)
```

### Fase B: AUTH (hver re-tilkobling, etter at bind er gjort én gang)

```
# Samme CCCD-setup som over
→ 0x0013/0x0016: 0100

# Auth init
→ 0x0012: 24000000

# Phone sender 16 B nonce
→ 0x0015: 00 00 00 0b 01 00                      # announce: type=0x0b, 1 frag
← 0x0015: 00 00 01 01
→ 0x0015: 0100 [16 B random nonce]
← 0x0015: 00 00 01 00

# Scale sender 16 B nonce
← 0x0015: 00 00 00 0d 01 00                      # type=0x0d
→ 0x0015: 00 00 01 01
← 0x0015: 0100 [16 B nonce]
→ 0x0015: 00 00 01 00

# Scale sender 32 B ephemeral pubkey (2 frags: 18+14 = 32)
← 0x0015: 00 00 00 0c 02 00                      # type=0x0c
→ 0x0015: 00 00 01 01
← 0x0015: 0100 [18 B]
← 0x0015: 0200 [14 B]
→ 0x0015: 00 00 01 00

# Phone sender 32 B ephemeral pubkey
→ 0x0015: 00 00 00 0a 02 00                      # type=0x0a
← 0x0015: 00 00 01 01
→ 0x0015: 0100 [18 B]
→ 0x0015: 0200 [14 B]
← 0x0015: 00 00 01 00

# Scale signaliserer suksess
← 0x0012: 21000000                               # ✅ AUTH SUKSESS
                  (23000000 = ukjent nøkkel, ikke bundet)
```

**MERK:** Auth bruker 32 B pubkeys, ikke 64 B. Dette ER P-256 i komprimert form
(kun X-koord + paritet i overskriftsbyten? eller bare X-koord = "Mi Compact" format?).
Avklares ved test.

### Fase C: Encrypted weight stream (etter auth)

```
# GATT-discovery av MiBle-tjeneste 0x001D-0xFFFF
→ Read By Type 0x001D-0xFFFF UUID=0x2803
← Response: handles 0x001F (UUID 0x0101 write-no-resp), 0x0021 (UUID 0x0102 notify)

# Subscribe på vekt-notifikasjoner
→ 0x0022 (CCCD 0x0021): 0100

# Vekta sender encrypted frames med sekvensnummer
← 0x0021: 0100 [9–14 B encrypted payload + 4 B tag]
← 0x0021: 0200 [...]
← 0x0021: 0300 [...]
   ...
```

Hver frame er antagelig:
```
plaintext = AES-CCM-decrypt(
    key   = session_key[0:16] eller [32:48],
    nonce = MAC[::-1] || seq_LE16 || pad     # 12 B nonce
    cipher = frame[2:-4],
    tag    = frame[-4:],
)
```

Vekt-plaintext (Xiaomi MIoT standard):
```c
struct {
    uint8_t  status;       // bit0=stable, bit1=removed, bit2=lb, bit3=catty
    uint16_t mass_le;      // mass = value / 200 [kg]
    // valgfritt:
    uint16_t impedance_le; // 0 hvis ikke kroppsvekt
    ...
};
```

Lengden varierer (11 B vs 14 B etter 2 B sekv) → status + mass alene vs. + impedance/timestamp.

---

## Kryptografi-detaljer (fra Yeelight-mal)

```python
from cryptography.hazmat.primitives.asymmetric.ec import (
    generate_private_key, SECP256R1, ECDH, EllipticCurvePublicKey
)
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives import hashes
from Cryptodome.Cipher import AES

# 1. Generer P-256 keypair (phone-side)
priv = generate_private_key(SECP256R1())
pub_pt = priv.public_key().public_numbers()
pub_raw_64 = pub_pt.x.to_bytes(32, "big") + pub_pt.y.to_bytes(32, "big")

# 2. Send pub_raw_64 til scale i bind/auth
# 3. Motta scale_pub_raw_64 fra scale-fragmenter

# 4. Beregn shared secret
scale_pub = EllipticCurvePublicKey.from_encoded_point(
    SECP256R1(), b"\x04" + scale_pub_raw_64
)
shared = priv.exchange(ECDH(), scale_pub)   # 32 B

# 5. Bygg KDF input — UKJENT for Hoto. Kandidater:
ltmk_candidates = [
    BEACONKEY * 2,                       # 16 B repetert = 32 B
    BEACONKEY + TOKEN + b"\x00" * 4,     # 16+12+4 = 32 B
    BEACONKEY + b"\x00" * 16,            # 16 + null-pad = 32 B
]
salt_candidates = [
    b"miot-mesh-login-salt",   # Yeelight-original
    b"miot-bind-login-salt",
    b"miot-pair-salt",
]
info_candidates = [
    b"miot-mesh-login-info",
    b"miot-bind-login-info",
    b"miot-pair-info",
]

for ltmk in ltmk_candidates:
    for salt in salt_candidates:
        for info in info_candidates:
            blob = shared + ltmk
            session_key = HKDF(hashes.SHA256(), 64, salt, info).derive(blob)

            # 6. Bygg 24 B proof — UKJENT plaintext-struktur. Kandidater:
            import zlib
            CRC = lambda b: zlib.crc32(b).to_bytes(4, "little")
            DID = b"blt.4.1h37o9hp0gg00"
            plain_candidates = [
                CRC(scale_pub_raw_64) + CRC(pub_raw_64) + DID[:12],     # 4+4+12=20
                CRC(pub_raw_64) + DID[:16],                              # 4+16=20
                DID[:12] + CRC(scale_pub_raw_64) + CRC(pub_raw_64),     # 12+4+4
            ]
            for plain in plain_candidates:
                cipher = AES.new(
                    session_key[32:48], AES.MODE_CCM,
                    nonce=bytes.fromhex("101112131415161718191a1b"),
                    mac_len=4
                )
                ct, tag = cipher.encrypt_and_digest(plain)
                proof_24b = ct + tag

                # Send → hvis ← 11000000 har vi knust koden
```

**Hovedkonklusjon:** Vi har 3 × 3 × 3 = 27 kombinasjoner å brute-force, hver ~3s
mot vekta. Skal være håndterbart på <90 sekunder.

---

## Hva som er fanget (referansedata)

`captures/hoto-binding-2026-05-11.{pklg,extracted.txt}`
- Komplett bind-sesjon (conn 0x005B, 4s)
- Phone payload A: `971456b2…c1ea`
- Scale response A: `2d99f6c4…a81f`
- Phone 24 B proof A: `eda33bfef90ea86ffc091d65f47ee9fb9c99744569332d19`

`captures/hoto-binding-2026-05-11-2.{pklg,extracted.txt}`
- Bind-sesjon (conn 0x0043) + auth-sesjon + veiing (conn 0x004C)
- Phone payload B: `826e9052…a3ab`
- Scale response B: `bfea2b97…57e5`
- Phone 24 B proof B: `64bba61ebe4370d33a02c03868adb978e9c701e41cde89bc`
- Auth: phone_nonce `3a2308d8…48a`, scale_nonce `22b5320e…51`,
  scale_pub `9ce7cef0…e86c`, phone_pub `55ffc223…6fae`
- 70+ encrypted weight frames på 0x0021

`captures/parse_pklg.py` — parser for Apple PacketLogger .pklg → leselig ATT-trace.

`captures/protocol_notes.md` — utvidet teknisk notat.

`captures/payloads.md` — strukturert dump av første capture.

---

## Tidligere blindspor (ikke gjenta)

1. **`ble_auth2.py` bruker X25519** — feil kurve. Må byttes til SECP256R1.
2. **`ble_miauth.py` antar AES-CBC challenge på 0x0017** — feil kanal, feil mekanisme.
3. **macOS-bonding** — protokollen krever ingen bonding overhodet.
4. **Char 0x0017** — iOS rører den aldri. Skriving til den henger ATT-trafikk.
5. **`fe95` advertisement-decode** — inneholder kun device type, ingen vektdata.

---

## Neste konkrete steg

1. **Skriv `ble_bind3.py`** som:
   - Genererer P-256 keypair
   - Følger bind-protokollen presist (CCCD → a2 → DID-receive → 15 → 64B pub send → 64B scale receive → 24B proof send → 13 → vent på 11)
   - Brute-forcer 27 HKDF + plaintext-kombinasjoner inntil scale svarer `11000000`
   - Lagrer ECDH-input + session_key til disk når vellykket

2. **Etter vellykket bind: skriv `ble_auth3.py`** som:
   - Reconnect
   - Følger auth-protokollen (24 → nonces → pubkeys → 21)
   - Bruker samme session-key-formel for å dekryptere 0x0021-strømmen
   - Verifiserer ved å dekryptere fanget weight-frames fra capture-2.pklg offline

3. **Hvis brute-force feiler:** dump Hoto-appen fra iOS via frida/ipa-decrypt
   og søk binæren for `miot-…-salt`-strenger og `aes_ccm`-kall.

---

## Referanser

- [Yeelight BLE auth gist (kabbi)](https://gist.github.com/kabbi/32658d7d3a086cd47d877882933a9908) — definitiv referanse for krypto-familien
- [BreakMi paper (CHES 2022)](https://hexhive.epfl.ch/publications/files/22CHES.pdf) — Mi Band-protokoller (relatert, annen variant)
- [xiaomi-ble (Bluetooth-Devices)](https://github.com/Bluetooth-Devices/xiaomi-ble) — ADV-decoder med beaconkey-bruk
- [ble-in-xiaomi (freenetwork)](https://github.com/freenetwork/ble-in-xiaomi) — eldre RC4-protokoll (ikke vår)
- [bleak](https://bleak.readthedocs.io/) — Python BLE-bibliotek
- [cryptography (pyca)](https://cryptography.io/) — for SECP256R1 og HKDF
- [pycryptodome](https://pycryptodome.readthedocs.io/) — for AES-CCM med mac_len=4
