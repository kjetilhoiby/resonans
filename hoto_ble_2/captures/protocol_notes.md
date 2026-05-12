# Hoto BLE binding-protokoll — referansematerial

## Hovedfunn fra Yeelight-gist (kabbi/32658d7d3a086cd47d877882933a9908)

Yeelight Smart Bulb (MJDP09UL) bruker en nesten identisk protokoll som vår Hoto-vekt.
Yeelight er bedre dokumentert, og avslører kryptografien.

### Felles med Hoto

| Felt              | Yeelight        | Hoto             |
|-------------------|-----------------|------------------|
| Service           | `fe95`          | `fe95` ✓         |
| Control char      | `[0010]`        | `[0010]` ✓       |
| Data char         | `[0016]`        | `[0019]`         |
| Frame format      | idx LE16 + data | idx LE16 + data ✓|
| Pubkey size       | 64 B            | 64 B ✓           |
| Kurve             | SECP256R1       | sannsynlig samme |
| Krypto            | AES-CCM         | sannsynlig samme |

### Magiske kontrollkoder

| Yeelight     | Hoto bind    | Hoto auth    | Tolkning            |
|--------------|--------------|--------------|---------------------|
| `50000000`   | `a2000000`   | `24000000`   | Start handshake     |
| `51000000`   | `11000000`   | `21000000`   | Suksess             |
| —            | `12000000`   | `23000000`   | Feil (proof / nøkkel) |
| —            | `15000000`   | —            | Bind-fase 2 trigger |
| —            | `13000000`   | —            | Bind finalize       |

### Kryptografisk derivering (Yeelight)

```
sessionKey = HKDF(
    blob   = ECDH_shared_secret(32B) || cloud_LTMK(32B),  # 64 B input
    salt   = b"miot-mesh-login-salt",
    info   = b"miot-mesh-login-info",
    length = 64
)

# Pakker krypteres med:
AES-CCM(
    key    = sessionKey[32:48],   # andre halvdel (16 B = AES-128)
    nonce  = bytes.fromhex("101112131415161718191a1b"),  # STATISK
    aad    = ...,
    plain  = CRC32(device_pubkey)  # for proof-pakka
)
```

**For Hoto:** strengene er sannsynligvis ikke `"miot-mesh-..."` (vi er ikke i mesh-modus)
men `"miot-bind-..."` / `"miot-stand-..."` / `"miot-pair-..."`. Må prøves.

**LTMK (cloud key):** Yeelight bruker 32 B. Vår beaconkey er 16 B
(`8094bbd44bf1a5b9d400e147b2c5e221`). Hypoteser:
1. beaconkey blir paddet/repetert til 32 B
2. blob = ECDH(32 B) || beaconkey(16 B) || token(12 B) || padding(4 B) = 64 B
3. blob er bare 32 B for Hoto (ikke 64 B)

### Sannsynlig struktur for vår 24-byte "proof"

Mest sannsynlig: 4 B AES-CCM tag + 20 B encrypted-plaintext. Eller 8 B nonce + 12 B
encrypted + 4 B tag. Plaintext kandidater (alle 20 B):

- `CRC32(scale_pub) || CRC32(phone_pub) || DID(12 B)`  → 4+4+12 = 20 B ✓
- `CRC32(phone_pub) || DID(12 B) || timestamp(4 B)`    → 4+12+4 = 20 B
- `nonce_phone || nonce_scale (begge fra auth-fase)`    → 8+8 = 16 B (passer ikke)

## Hva vi nå kan bygge

Med Yeelight-malen kan vi skrive et komplett bind-skript:

```python
from cryptography.hazmat.primitives.asymmetric.ec import generate_private_key, SECP256R1, ECDH
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives import hashes
from Cryptodome.Cipher import AES
import zlib, asyncio
from bleak import BleakClient

BEACONKEY = bytes.fromhex("8094bbd44bf1a5b9d400e147b2c5e221")  # 16 B
TOKEN     = bytes.fromhex("e77246463e2eca3d1fdf0a0d")          # 12 B
DID       = b"blt.4.1h37o9hp0gg00"                              # 19 B ASCII

# 1. Generer P-256 keypair
priv = generate_private_key(SECP256R1())
pub = priv.public_key()
pub_raw = pub.public_bytes_raw()[1:]  # strip 0x04 prefix → 64 B (X||Y)

# 2. Send a200 → DID → 15000000 → 64B pubkey
# (per fanget protokoll)

# 3. Motta scale's 64 B pubkey, deriv shared secret
scale_pub_raw = ...  # fra notify
scale_pub = SECP256R1.from_uncompressed(b"\x04" + scale_pub_raw)
shared = priv.exchange(ECDH(), scale_pub)  # 32 B

# 4. HKDF — prøv ulike salt/info kombinasjoner
for salt in [b"miot-mesh-login-salt", b"miot-bind-salt", b"miot-pair-salt"]:
    for info in [b"miot-mesh-login-info", b"miot-bind-info", b"miot-pair-info"]:
        for ltmk in [BEACONKEY * 2, BEACONKEY + TOKEN + b"\x00" * 4, BEACONKEY + b"\x00" * 16]:
            blob = shared + ltmk
            session_key = HKDF(hashes.SHA256(), 64, salt, info).derive(blob)
            # 5. Forsøk å lage 24 B proof
            for plain in [
                CRC32(scale_pub_raw) + CRC32(pub_raw) + DID[:12],
                CRC32(pub_raw) + DID[:12] + b"\x00\x00\x00\x00",
            ]:
                cipher = AES.new(session_key[32:48], AES.MODE_CCM,
                                 nonce=bytes.fromhex("101112131415161718191a1b"),
                                 mac_len=4)
                ct, tag = cipher.encrypt_and_digest(plain)
                proof_24b = ct + tag
                # Send → hvis scale svarer 11000000 har vi knust koden
```

## Validering uten å skrive til vekta

Vi har FULLSTENDIG fanget en vellykket iOS-binding. Det betyr:
- iOS' 64 B første payload (= iOS' P-256 pubkey)
- Scale's 64 B respons (= scale's ephemeral P-256 pubkey)
- iOS' 24 B proof

Vi kjenner IKKE iOS' private nøkkel. Men vi kan likevel teste HKDF + AES-CCM-formler
ved å sjekke at AES-CCM-tag-verifisering bekrefter tag → invalid. Det er bare tag-
verifisering som krever shared secret. Uten det kan vi ikke validere oppskriften
ren-offline.

**Konkret neste steg:** Skriv `ble_bind3.py` som gjør stegene over og prøver alle
3 × 3 × 3 = 27 HKDF-varianter mot vekta. Hver runde tar ~3 sek. Hvis ingen virker,
prøv nye plaintext-strukturer eller endre KDF-blob-lengde til 32 B.

Når bind lykkes (← `11 00 00 00`):
- Disconnect, reconnect, kjør auth (samme protokoll med ephemeral 32 B pubkeys på
  type=0x0a/0x0b/0x0c/0x0d frames og `24 00 00 00` init)
- Etter `21 00 00 00`: discover MiBle-service (handles 0x001E-0x0021)
- Subscribe på 0x0022 (CCCD for 0x0021)
- Motta encrypted weight-notifikasjoner med sekvensnummer
- Dekryptér med AES-CCM, nonce = `MAC[::-1] || seq_LE16 || ???`

## Encrypted weight stream (channel 0x0021)

Fra fanget capture: notifikasjoner kommer på handle 0x0021, hver med 2 B seq + payload.
Antagelig:
```
plaintext = AES-CCM-decrypt(
    key    = sessionKey[0:16] eller [32:48],
    nonce  = constant || seq_LE16 || pad,  # eller MAC-basert
    cipher = payload[2:-4],
    tag    = payload[-4:],
)
```

Vektmåling forventet plaintext-format (Xiaomi standard):
```
struct mass_packet {
    uint8_t  status;     // bit0=stable, bit1=removed, bit2=lb, bit3=catty, ...
    uint16_t mass_le;    // i 1/200 kg → kg = mass / 200
    uint16_t impedance_le; // valgfri, 0 hvis ikke kroppvekt
};
```

For 7B plaintext: `status(1) + mass(2) + extra(4)`
For 10B plaintext: `status(1) + mass(2) + impedance(2) + timestamp(5)` el. lign.
