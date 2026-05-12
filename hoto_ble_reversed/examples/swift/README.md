# Swift starter code for iOS

Sketch implementation for an iOS app reading from the Hoto scale.

**Status:** Skeleton code. Compiles in concept; needs your project's
concurrency model (async/await, Combine, or callbacks) plugged in. Verify
against `../../captures/test_vectors.json` before trusting on a real
device.

## Files

| File             | Purpose                                                 |
|------------------|---------------------------------------------------------|
| `HotoScale.swift`| Main class: scan, connect, bind, login, stream weight   |
| `AESCCM.swift`   | AES-CCM-128 with 4-byte MAC via CommonCrypto            |
| `M365Frame.swift`| Plaintext M365 UART frame parser                        |
| `Constants.swift`| GATT UUIDs, magic codes, AES-CCM parameters             |

## Quick integration

```swift
let scale = HotoScale()
try await scale.scanAndConnect()
try await scale.bindIfNeeded()   // no-op after first run; saves to Keychain

for await frame in scale.weightStream() {
    print("\(frame.kind): \(frame.grams ?? 0) g")
}
```

## Notes

- Add `NSBluetoothAlwaysUsageDescription` to your Info.plist.
- Token is stored in Keychain under service `"com.yourapp.hoto"`.
  Customize the service name in `Constants.swift`.
- Generate the AES-CCM wrapper carefully. The CryptoKit team has been
  promising AES-CCM for years; if you target iOS 18+ you may be able to
  use a future native API.

See `../../SWIFT.md` for the full implementation guide and
`../../CRYPTO.md` for the cryptographic details.
