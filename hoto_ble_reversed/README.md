# Hoto Smart Kitchen Scale — Reverse-Engineered BLE Protocol

Standalone documentation and reference implementations for talking directly
to the Hoto Smart Kitchen Scale (Xiaomi/Hoto, model HOTO-…) over Bluetooth
Low Energy, without the Mi Home / Xiaomi Home app.

The scale uses the **Xiaomi Mi Standard Authentication v2** protocol for BLE
binding, identical in shape to the Mi Yeelight smart bulb, Mi Standalone
sensors, and other Mi Standard-SDK products. Once bound, weight is streamed
on a private characteristic encrypted with a session key derived from
P-256 ECDH.

The plaintext beneath the encryption is a **Mi M365 scooter UART frame**
(`55 aa 01 [cmd] [data] [chk] fe`). Xiaomi reused their electric-scooter
wire protocol for kitchen-scale telemetry.

## Status

| Phase            | Status        | Notes                                                  |
|------------------|---------------|--------------------------------------------------------|
| Scan / discovery | ✅ Working    | Service `fe95`, device type `0x1180`                   |
| Bind (register)  | ✅ Working    | P-256 ECDH + HKDF + AES-CCM. One-time. No cloud needed |
| Login            | ✅ Working    | HKDF + HMAC verification, derives session keys         |
| Weight stream    | ✅ Working    | AES-CCM with session keys, M365 plaintext              |
| Tare / commands  | ❌ Not tested | Likely on MiBle write char with `app_key` encryption   |

Tested against firmware `1.1.3_0010`. Other firmware versions likely use the
same protocol family.

## Quick start (Python)

```bash
pip install bleak cryptography pycryptodomex
cd examples/python

# One-time bind. Press scale button to power on, then:
python3 bind.py

# Stream weight readings:
python3 read.py
```

You'll see output like:

```
✅ LOGIN SUCCESS
★  265.4 g   seq=0x0004      ← stable reading
   active     seq=0x0007
★    0.0 g   seq=0x000b
```

## What you need (no cloud account required!)

This is a key result of the reverse engineering: **you do NOT need a Mi
account, Mi Cloud token, or beaconkey**. The bind handshake derives all
required keys peer-to-peer over BLE using ECDH. Old Mi sensors (LYWSD03MMC
etc.) require a cloud-fetched `bindkey` to decrypt their advertisements;
this scale operates entirely off-grid.

What you DO need:

- BLE radio (any phone/laptop/Pi)
- Physical button press to wake the scale into advertising
- One-time bind (saves a 12-byte token to disk)

After binding, you can reconnect and read weight forever.

## Architecture overview

```
┌─────────────────┐                       ┌─────────────────────────┐
│  Your iOS app   │                       │ Hoto Smart Scale        │
│  or Python tool │                       │ (BLE peripheral)        │
└────────┬────────┘                       └────────────┬────────────┘
         │                                             │
         │  BLE scan, find by service UUID fe95        │
         │ ◀──────────────────────────────────────────▶│
         │                                             │
         │  GATT connect (no pairing!)                 │
         │ ────────────────────────────────────────▶  │
         │                                             │
         │  ── BIND PHASE (one-time per device) ──     │
         │  P-256 ECDH key exchange (64-byte pubkeys)  │
         │  HKDF "mible-setup-info" → AES key          │
         │  Encrypt DID as proof                       │
         │  Receive 11000000 = bound ✅                │
         │  → save 12-byte token to disk               │
         │                                             │
         │  ── LOGIN PHASE (every reconnection) ──     │
         │  Exchange 16-byte random nonces             │
         │  Receive scale's HMAC, verify, send ours    │
         │  Receive 21000000 = authenticated ✅        │
         │  → derive dev_key, app_key, dev_iv, app_iv  │
         │                                             │
         │  ── WEIGHT STREAM (continuous) ──            │
         │  Subscribe to MiBle notify (UUID 0x0102)    │
         │  Receive encrypted [idx LE16][cipher+tag]   │
         │  Decrypt with AES-CCM(dev_key, dev_iv+idx)  │
         │  Plaintext = "55 aa 01 cmd … chk fe"        │
         │  Parse weight value as LE24                 │
         │ ◀──────────────────────────────────────────│
```

## Documentation map

| File                         | Contents                                            |
|------------------------------|-----------------------------------------------------|
| [PROTOCOL.md](PROTOCOL.md)   | Wire-level GATT protocol, every byte explained      |
| [CRYPTO.md](CRYPTO.md)       | Cryptographic primitives, key derivation, AES-CCM   |
| [PLAINTEXT.md](PLAINTEXT.md) | M365 UART frame format, weight value encoding       |
| [SWIFT.md](SWIFT.md)         | iOS-specific implementation guide (Core Bluetooth)  |
| [examples/python/](examples/python/) | Working Python reference (~400 lines)       |
| [examples/swift/](examples/swift/)   | Swift starter code for iOS apps             |
| [captures/](captures/)       | Reference packet traces and test vectors            |

## Hardware tested

- Device: Hoto Smart Kitchen Scale (Norwegian retail name)
- Model: `1.1.3_0010` firmware
- Xiaomi device type: `0x1180`
- Mi Cloud DID format: `blt.4.<base36_id>`

## Acknowledgements

This work would not have been possible without:

- **[dnandha/miauth](https://github.com/dnandha/miauth)** — definitive Python
  implementation of Mi Standard Auth, source of the canonical crypto recipe.
  Apache 2.0 licensed.
- **[atc1441/ATC_MiThermometer](https://github.com/atc1441/ATC_MiThermometer)**
  — early Mi BLE reverse engineering (TelinkFlasher.html JS port).
- **[danielkucera/mi-standardauth](https://github.com/danielkucera/mi-standardauth)**
  — original Python `provision.py`, the seed for miauth.

## License

This documentation and code is released under the same Apache 2.0 license as
miauth. See LICENSE in this directory.

This is independent research. The authors are not affiliated with Xiaomi,
Hoto, or any of their subsidiaries. Do not use this work to compromise
devices you do not own.
