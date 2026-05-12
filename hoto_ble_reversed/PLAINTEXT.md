# Plaintext format — M365 UART frames

After AES-CCM decryption of weight stream notifications, the plaintext is a
**Mi M365 electric scooter UART protocol** frame. Yes, the kitchen scale
internally speaks Xiaomi's e-scooter wire protocol. This is a deeply
satisfying piece of trivia.

## Frame structure

```
55 aa 01 [cmd:1] [data:0..N] [chk:1] fe
```

- **`55 aa`** — preamble (constant)
- **`01`** — direction / source byte (always 0x01 from device to host)
- **`cmd`** — command byte (semantics below)
- **`data`** — variable-length payload
- **`chk`** — checksum: `sum(plain[3:-2]) % 256` — sum of cmd + data bytes, mod 256
- **`fe`** — trailer (constant)

Total frame size = 5 + len(data).

## Known commands

| `cmd` | Frame size | Meaning            | Data layout                              |
|-------|-----------|--------------------|------------------------------------------|
| 0x02  | 7 B       | Idle / no weight   | `00 [status]`                            |
| 0x05  | 7 B       | Event (button?)    | `00 [status]`                            |
| 0x07  | 10 B      | Active weight      | `03 [val_lo val_mid val_hi]`              |
| 0x08  | 10 B      | Stable weight      | `03 [val_lo val_mid val_hi]`              |

The third byte in cmd 0x07 / 0x08 frames is always `0x03`, likely a
"weight value" subcommand or format selector.

## Weight value encoding

For cmd `0x07` (active) and `0x08` (stable):

```
plain[5] plain[6] plain[7]   = 24-bit little-endian raw value
grams = raw_value / 10.0     ← weight in grams (0.1 g resolution)
```

The scale has 0.1 g resolution and is reported as a 24-bit integer.
Maximum representable: 16777215 raw = 1,677,721.5 g = 1677 kg (clearly
the hardware caps far below this).

**Sanity check:** typical kitchen items
- empty: 0 raw
- coffee bean: ~150 raw (15.0 g)
- coffee cup: ~2650 raw (265.0 g)
- 1 kg bag of flour: ~10000 raw

## Active vs stable

- **`cmd=0x07` "active"**: weight is changing, scale is still settling.
  Use for live-update displays.
- **`cmd=0x08` "stable"**: weight has not changed for ~1 second. Use
  for "weighing complete" events, recording to history, etc.

Typical sequence when something is placed on the scale:

```
0x07 → 91 g       (object touching, scale beginning to respond)
0x07 → 251 g      (still settling)
0x07 → 1538 g     (rising fast)
0x07 → 2650 g     (almost there)
0x07 → 2655 g     (one final settle)
0x08 → 2655 g     ★ stable
```

When the user lifts the object:

```
0x07 → 22 g       (some weight remaining as object lifts)
0x07 → 0 g        (clear)
0x08 → 0 g        ★ stable (zero)
```

## Idle status frames

`cmd=0x02` is a periodic "idle" heartbeat sent between weight events. The
status byte appears to always be 0x02 in our captures. We didn't observe
state changes worth distinguishing — treat these as keep-alive and ignore
for weight-tracking purposes.

## Duplicate suppression

Every frame is sent **twice** by the scale, on two consecutive notify
sequence numbers. The plaintext bytes are byte-for-byte identical. Your
parser should deduplicate consecutive identical plaintexts.

```
seq=0x000a: 55 aa 01 07 03 5a 0a 00 6e fe    (active, 265.0 g)
seq=0x000b: 55 aa 01 07 03 5a 0a 00 6e fe    (active, 265.0 g)  ← skip
seq=0x000c: 55 aa 01 07 03 5b 0a 00 6f fe    (active, 265.1 g)  ← new
```

## Checksum verification

Always verify before parsing:

```python
def checksum_ok(plain: bytes) -> bool:
    if len(plain) < 5:
        return False
    return plain[-2] == sum(plain[3:-2]) % 256
```

Examples (all from real captures):

| Plain hex                       | Sum of plain[3:-2]      | Expected chk | Actual | OK |
|---------------------------------|-------------------------|--------------|--------|-----|
| `55aa01 02 00 02 fe`            | 0x02 + 0x00 = 0x02      | 0x02         | 0x02   | ✓  |
| `55aa01 07 03 5b 00 00 65 fe`   | 0x07+0x03+0x5b = 0x65   | 0x65         | 0x65   | ✓  |
| `55aa01 08 03 5e 0a 00 73 fe`   | 0x08+0x03+0x5e+0x0a = 0x73 | 0x73      | 0x73   | ✓  |
| `55aa01 08 03 00 00 00 0b fe`   | 0x08+0x03 = 0x0b        | 0x0b         | 0x0b   | ✓  |

## Other commands (untested)

The scale presumably accepts commands via encrypted writes to UUID 0x0101
(MiBle command char). Plausible operations not yet reverse-engineered:

- **Tare** — set current weight as zero
- **Unit toggle** — g / oz / ml (cooking modes)
- **Battery level** — query
- **Auto-off timeout** — configure
- **Calibration** — likely service-mode only

Educated guess for the wire format: same `55 aa 01 [cmd] [data] [chk] fe`
structure, sent encrypted with `app_key` + `app_iv` + ascending phone-side
iteration counter. Capturing the iOS app sending a tare command would
confirm this.

## Status code references

The Mi M365 scooter has a published [protocol document](https://github.com/scooterhacking/m365_protocol)
listing dozens of `cmd` codes (motor controller registers, BMS values,
firmware updates, etc.). Most are irrelevant for a kitchen scale but the
shared framing means the protocol parsers from those projects can be
adapted directly.

## Summary

After all the cryptographic complexity of bind and login, the actual
weight data is a 10-byte frame containing a 24-bit little-endian integer
representing weight in 0.1 grams. The hard parts are getting through the
two layers of crypto to receive the frame.
