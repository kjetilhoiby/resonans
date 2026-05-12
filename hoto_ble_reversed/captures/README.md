# Reference captures and test vectors

## Files

| File                      | Purpose                                                        |
|---------------------------|----------------------------------------------------------------|
| `test_vectors.json`       | Numerical test vectors for offline crypto validation           |
| `ios_full_session.txt`    | Parsed ATT trace from a complete iOS Mi Home bind+login+weight |
| `parse_packetlogger.py`   | Parser for Apple PacketLogger `.pklg` → readable ATT trace     |

## ios_full_session.txt

A line-by-line dump of every ATT operation between the iPhone (running Mi
Home/Xiaomi Home app) and the Hoto scale during a successful session that
went through:

1. Connect (conn handle 0x0043) — bind handshake → 11000000
2. Disconnect briefly
3. Connect again (conn handle 0x004C) — login → 21000000
4. Subscribe to weight notify
5. ~50 encrypted weight frames

Use this as the canonical reference for what the wire-level protocol should
look like. Compare your client's traffic against this if something is off.

## parse_packetlogger.py

If you capture your own iOS BLE traffic using Apple's PacketLogger (from
Xcode's Additional Tools), this script extracts a clean ATT-level trace
filtered for the scale's connection.

```bash
python3 parse_packetlogger.py your-capture.pklg
# writes your-capture.extracted.txt
```

## How to capture iOS BLE traffic

If you want to compare your iOS app's behavior against the official Mi
Home app:

1. Install the "Bluetooth Logging" provisioning profile on your iPhone:
   - Open https://developer.apple.com/bug-reporting/profiles-and-logs/
   - Download the Bluetooth profile
   - Install via Settings → General → VPN & Device Management
2. Open PacketLogger on Mac (download Xcode Additional Tools from
   https://developer.apple.com/download/all/?q=additional%20tools)
3. Connect iPhone via USB, select it as input source in PacketLogger
4. Reproduce the BLE flow on your phone (open Mi Home, etc.)
5. Save the `.pklg` file
6. Run `python3 parse_packetlogger.py the-file.pklg` to get a readable
   trace

This is invaluable for debugging — you can A/B compare what the official
app does vs. what your implementation does and find the mismatch instantly.

## Test vectors

The `test_vectors.json` file contains:

- **`frame_parser`**: 7 frame samples with expected parse results. Test
  your `parseM365Frame` (or equivalent) against all of these.
- **`checksum_examples`**: Hand-computed checksum values you can verify.
- **`bind_example_session`**: A complete bind handshake with all
  intermediate ECDH/HKDF/AES-CCM values. Tests your bind crypto path
  end-to-end.
- **`login_example_session`**: A complete login handshake. Tests login
  HKDF + HMAC.
- **`decrypt_examples`**: A frame decryption walk-through.

The bind/login vectors are from a single real session; the ephemeral
public/private keys are no longer reusable (the scale generates new ones
every connection), but the derivation values are deterministic given the
inputs, so they validate your math.
