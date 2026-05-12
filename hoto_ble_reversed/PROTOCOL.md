# Protocol specification

Wire-level description of the Hoto Smart Kitchen Scale BLE protocol, every
byte explained. Use alongside [CRYPTO.md](CRYPTO.md) for the math and
[PLAINTEXT.md](PLAINTEXT.md) for what's inside the encrypted notifications.

## GATT services

The scale exposes two relevant services:

### Xiaomi service (`fe95`)

`0000fe95-0000-1000-8000-00805f9b34fb`

| Characteristic UUID (short) | Properties        | Role                                  |
|-----------------------------|-------------------|---------------------------------------|
| `0x0004`                    | read              | Firmware version (`1.1.3_0010`)       |
| `0x0010` (CHAR_CONTROL)     | notify + WnR      | **Control channel** — magic 4-byte codes |
| `0x0019` (CHAR_DATA)        | notify + WnR      | **Data channel** — fragmented payloads |
| `0x0017`                    | notify + write    | **UBUSED by app** — do not touch       |
| `0x0018`                    | notify + WnR      | Unused                                |

Full UUIDs follow the standard Bluetooth base:
`0000XXXX-0000-1000-8000-00805f9b34fb` where XXXX is the short.

### Mi MIoT BLE service (post-login only)

`mi.miot.ble` — full UUID base `00000XXX-0065-6c62-2e74-6f696d2e696d`

| UUID (short) | Properties | Role                                     |
|--------------|------------|------------------------------------------|
| `0x0101`     | WnR        | Encrypted command channel (tare etc.)    |
| `0x0102`     | notify     | **Weight stream** (encrypted M365 frames) |

These characteristics may need to be re-discovered after login (scale exposes
them only after authentication). On macOS bleak this works transparently.

## Magic codes on control (`0x0010`)

The scale's protocol uses 4-byte sentinels on the control channel to drive
the state machine.

| Code         | Direction       | Meaning                                  |
|--------------|-----------------|------------------------------------------|
| `a2 00 00 00`| → scale         | Start REGISTER (bind)                    |
| `15 00 00 00`| → scale         | REGISTER phase-2 trigger                 |
| `13 00 00 00`| → scale         | REGISTER finalize                        |
| `11 00 00 00`| ← scale         | REGISTER ok ✅                           |
| `12 00 00 00`| ← scale         | REGISTER failed (bad proof)              |
| `24 00 00 00`| → scale         | Start LOGIN (after bound)                |
| `21 00 00 00`| ← scale         | LOGIN ok ✅                              |
| `23 00 00 00`| ← scale         | LOGIN failed (unknown token)             |
| `e0..e3`     | ← scale         | Auth errors (unrecoverable)              |

## Fragment protocol on data channel (`0x0019`)

The data channel uses a small length-prefixed protocol for arbitrary-size
payloads (the GATT MTU is too small for the 64-byte pubkeys).

### Frame types and message kinds

A payload-bearing burst starts with a 6-byte **announce** frame:

```
00 00 00 [type:1] [nfrags_le16:2]
```

Where `type` identifies the message kind and `nfrags` is the count of data
fragments to follow:

| Type | Used during | Meaning                                        | Total payload |
|------|-------------|------------------------------------------------|---------------|
| 0x00 | bind        | DID (scale→phone) / register proof (phone→scale) | 24 B / 24 B |
| 0x03 | bind        | 64-byte P-256 pubkey                             | 64 B        |
| 0x0a | login       | phone's 32-byte ephemeral pubkey (unused: not needed for proven flow) | — |
| 0x0b | login       | phone's 16-byte rand_key                         | 16 B        |
| 0x0c | login       | scale's 32-byte ephemeral pubkey (unused)        | —           |
| 0x0d | login       | scale's 16-byte remote_key                       | 16 B        |

(Types `0x0a` / `0x0c` are defined by the spec but not used by the simple
register/login flow; the scale uses HMAC for login proof rather than another
ECDH.)

### Send sequence (sender perspective)

```
sender    →  receiver    announce  (00 00 00 type nfrags_le16)
sender    ←  receiver    RCV_RDY   (00 00 01 01)
sender    →  receiver    frag 1    (01 00 [up to 18 bytes])
sender    →  receiver    frag 2    (02 00 [up to 18 bytes])
            ...
sender    →  receiver    frag N    (N_le16 [remainder])
sender    ←  receiver    RCV_OK    (00 00 01 00)
```

Fragment chunks are 18 bytes. The fragment index is a 1-based LE16 counter
followed by the data bytes.

### Receive sequence (receiver perspective)

```
receiver  ←  sender      announce
receiver  →  sender      RCV_RDY
receiver  ←  sender      frag 1
            ...
receiver  ←  sender      frag N
receiver  →  sender      RCV_OK
```

### Error codes

| Code              | Meaning             |
|-------------------|---------------------|
| `00 00 01 05 01 00` | RCV_TOUT (timeout) |
| `00 00 01 05 03 00` | RCV_ERR            |

## State machines

### REGISTER (bind) — one-time per device

```
PHONE                                    SCALE
  │                                        │
  │  enable notify on 0x0010 (CCCD 0x0013) │
  │  enable notify on 0x0019 (CCCD 0x0016) │
  │                                        │
  │  → 0x0010: a2 00 00 00                 │
  │                                        │
  │  ← 0x0019: announce type=0x00, 2 frags │
  │  → 0x0019: 00 00 01 01 (RCV_RDY)       │
  │  ← 0x0019: frag 1 [18 B]               │
  │  ← 0x0019: frag 2 [6 B]                │
  │  → 0x0019: 00 00 01 00 (RCV_OK)        │
  │                                        │
  │       received_data = 24 B raw         │
  │       remote_info = received_data[4:]  │  ← 20 bytes; first byte 0x00, then ASCII DID
  │                                        │
  │  → 0x0010: 15 00 00 00                 │
  │                                        │
  │  → 0x0019: announce type=0x03, 4 frags │
  │  ← 0x0019: RCV_RDY                     │
  │  → 0x0019: frag 1 [18 B]               │
  │  → 0x0019: frag 2 [18 B]               │
  │  → 0x0019: frag 3 [18 B]               │
  │  → 0x0019: frag 4 [10 B]               │
  │  ← 0x0019: RCV_OK                      │
  │                                        │
  │     phone_pub = raw P-256 X||Y, 64 B   │
  │                                        │
  │  ← 0x0019: announce type=0x03, 4 frags │
  │  → 0x0019: RCV_RDY                     │
  │  ← 0x0019: 4 frags totalling 64 B      │
  │  → 0x0019: RCV_OK                      │
  │                                        │
  │     scale_pub = raw P-256 X||Y, 64 B   │
  │     shared = ECDH(phone_priv, scale_pub)
  │     proof = AES-CCM-encrypt(remote_info)  ← see CRYPTO.md
  │                                        │
  │  → 0x0019: announce type=0x00, 2 frags │
  │  ← 0x0019: RCV_RDY                     │
  │  → 0x0019: frag 1 [18 B]               │
  │  → 0x0019: frag 2 [6 B]                │
  │  ← 0x0019: RCV_OK                      │
  │                                        │
  │  → 0x0010: 13 00 00 00                 │
  │                                        │
  │  ← 0x0010: 11 00 00 00     ✅ BOUND    │
  │                                        │
  │  → save 12-byte token to disk          │
```

**After bind:** save the **12-byte token** (= `derived_key[0:12]` after the
HKDF — see CRYPTO.md). This single value is what proves identity in every
future login.

### LOGIN — every reconnection

```
PHONE                                    SCALE
  │                                        │
  │  enable notify on 0x0010 + 0x0019      │
  │                                        │
  │  generate rand_key = secrets.token_bytes(16)
  │                                        │
  │  → 0x0010: 24 00 00 00                 │
  │                                        │
  │  → 0x0019: announce type=0x0b, 1 frag  │
  │  ← 0x0019: RCV_RDY                     │
  │  → 0x0019: frag 1 [16 B rand_key]      │
  │  ← 0x0019: RCV_OK                      │
  │                                        │
  │  ← 0x0019: announce type=0x0d, 1 frag  │
  │  → 0x0019: RCV_RDY                     │
  │  ← 0x0019: frag 1 [16 B remote_key]    │
  │  → 0x0019: RCV_OK                      │
  │                                        │
  │  ← 0x0019: announce type=0x0c, 2 frags │
  │  → 0x0019: RCV_RDY                     │
  │  ← 0x0019: 2 frags totalling 32 B      │
  │  → 0x0019: RCV_OK                      │
  │                                        │
  │     remote_info = 32 B (HMAC from scale)
  │     derived = HKDF(token, salt, "mible-login-info")  ← see CRYPTO.md
  │     verify remote_info == HMAC(dev_key, remote_key+rand_key)
  │     info = HMAC(app_key, rand_key+remote_key)
  │                                        │
  │  → 0x0019: announce type=0x0a, 2 frags │
  │  ← 0x0019: RCV_RDY                     │
  │  → 0x0019: 2 frags totalling 32 B info │
  │  ← 0x0019: RCV_OK                      │
  │                                        │
  │  ← 0x0010: 21 00 00 00   ✅ AUTHED    │
  │                                        │
  │  → discover MiBle service (UUID 0x0101/0x0102)
  │  → enable notify on UUID 0x0102 (CCCD)
  │                                        │
  │  ← UUID 0x0102: [idx LE16][cipher+tag] │ ← encrypted weight frames
```

### Weight stream

After LOGIN, the scale streams weight events on `mi.miot.ble` notify
characteristic (short UUID `0x0102`).

Each notification:

```
[idx_le16:2][encrypted_payload:N B + 4 B AES-CCM tag]
```

Decrypt with AES-CCM using session keys (see CRYPTO.md). Plaintext is a
**M365 UART frame**:

```
55 aa 01 [cmd:1] [data:0..5 B] [chk:1] fe
```

See [PLAINTEXT.md](PLAINTEXT.md) for parsing.

The `idx` counter starts at 1 on each fresh notify subscription and
increments per frame. **Each frame is sent twice on consecutive idx values**
— the receiver should deduplicate identical decrypted plaintexts.

## Pitfalls

### macOS does not expose BLE MAC address
Core Bluetooth (on macOS and iOS) presents devices by an opaque UUID that
changes per session. You cannot get the scale's real MAC `DC:ED:83:84:2E:9D`.
**This protocol does not need the MAC at all.** Other Xiaomi MiBeacon
decoders use MAC for nonce derivation, but Hoto's GATT-based protocol does
not.

### `start_notify` order matters
On some BLE stacks, subscribing to `0x0010` before `0x0019` matters. The
reference Python code subscribes to both before sending any control command.

### Don't write to characteristic `0x0017`
The original BLE spec (Mi BLE v1) used `0x0017` as the auth channel,
requiring link-layer bonding. The current Hoto scale firmware does NOT use
`0x0017` at all. Early attempts to write to it cause 38-second hangs or
ATT error 0x0F.

### Bonding is not used
The scale never requests pairing/bonding from the central. All security is
at the application layer (AES-CCM). On macOS this means you cannot fall
back to "let the OS handle it" — you must implement the full protocol.

### Connection limits
We observed connection drops around the 255th bind attempt (likely an
8-bit counter in the BLE stack or scale firmware). For long-running brute
force or stress tests, plan to reconnect every ~200 attempts. For normal
operation (one connect, login, weight stream) this is not a concern.

### Power button to wake
The scale only advertises after the physical power button is pressed
(approximately 30-second advertise window). For unattended operation you'd
need to find another wake mechanism or keep the scale connected.

## Reference

GATT services and key handles, summary table:

```
Service fe95:
  0x0010  control  WnR + notify   "magic codes"
  0x0019  data     WnR + notify   fragmented payloads (bind/login)

Service mi.miot.ble (post-login):
  0x0101  command  WnR            (encrypted commands to scale)
  0x0102  notify   notify         (encrypted weight stream)
```
