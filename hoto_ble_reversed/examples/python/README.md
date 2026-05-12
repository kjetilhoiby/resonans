# Python reference implementation

Working Python 3 implementation of the Hoto scale BLE protocol.

## Requirements

```bash
pip install bleak cryptography pycryptodomex
```

`bleak` for BLE, `cryptography` for P-256/HKDF/HMAC, `pycryptodomex` for
AES-CCM (the standard library doesn't expose CCM; `cryptography`'s AES-CCM
has stricter minimum-length requirements that don't fit our 7-byte
plaintexts).

## Files

| File         | Purpose                                                   |
|--------------|-----------------------------------------------------------|
| `bind.py`    | One-time bind/register handshake. Saves token to disk.    |
| `read.py`    | Login + subscribe + stream weight readings to stdout.     |
| `protocol.py`| Shared crypto + framing helpers (imported by both)        |

## Usage

```bash
# 1. Power on the scale (press the button)
# 2. One-time bind:
python3 bind.py
# Writes mi_token.bin (12 bytes).

# 3. Stream weight (rerun whenever you want a session):
python3 read.py
```

Output of `read.py`:

```
✅ LOGIN SUCCESS
   active   91.0 g
   active  251.0 g
   active 2650.0 g
★  stable 2655.0 g
   idle
★  stable    0.0 g
```

## Embedding in your own code

```python
import asyncio
from protocol import find_scale, bind, stream_weights

async def main():
    addr = await find_scale()

    # First time only
    token = await bind(addr)  # also saves to mi_token.bin

    # Or load previously-saved token
    with open("mi_token.bin", "rb") as f:
        token = f.read()

    async for frame in stream_weights(addr, token):
        if frame.type == "stable":
            print(f"Stable weight: {frame.grams} g")

asyncio.run(main())
```

## Notes

- The scale only advertises for ~30 s after power-on. Press the button
  shortly before running these scripts.
- macOS may take longer to discover BLE devices on first run; subsequent
  scans are faster.
- If `bind.py` fails with `12000000`, your `protocol.py` likely has a bug —
  re-check against `CRYPTO.md`.
