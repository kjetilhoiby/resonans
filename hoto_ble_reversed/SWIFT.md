# iOS implementation guide (Swift + Core Bluetooth)

How to port the Hoto scale BLE protocol to an iOS app. Assumes familiarity
with Swift, Core Bluetooth, and CryptoKit basics.

## Architecture

```
┌──────────────────────┐
│   Your SwiftUI view  │     observes
├──────────────────────┤◄──────────────┐
│   HotoScale (Combine │               │
│   publisher of       │               │
│   WeightFrame)       │               │
└──────────┬───────────┘               │
           │                            │
           ▼                            │
┌──────────────────────┐                │
│  Fragmenter (frame   │                │
│   protocol helper)   │                │
├──────────────────────┤                │
│  CCMCrypto (CCM via  │                │
│   CommonCrypto)      │                │
├──────────────────────┤                │
│  CBPeripheralDelegate│                │
└──────────────────────┘                │
           │                            │
           │ delivers WeightFrame       │
           ▼                            │
       (publish)  ─────────────────────►┘
```

## Project setup

### Info.plist permissions

```xml
<key>NSBluetoothAlwaysUsageDescription</key>
<string>This app reads weight measurements from your Hoto kitchen scale.</string>
```

For iOS 13+, no separate "peripheral" permission key is needed.

### Background mode (optional)

If you want to keep BLE alive when the app is backgrounded:

```xml
<key>UIBackgroundModes</key>
<array>
    <string>bluetooth-central</string>
</array>
```

### Swift package dependencies

You'll need AES-CCM. Easiest options:

```swift
// Package.swift
.package(url: "https://github.com/krzyzanowskim/CryptoSwift.git", from: "1.8.0")
// for AES.CCM
```

Or wrap CommonCrypto in Swift (no dependency, ~50 lines, see below).

## Core Bluetooth primer

iOS reaches BLE devices via `CBCentralManager`. Devices are presented as
`CBPeripheral` instances identified by an **opaque iOS-side UUID**, not
their real MAC. **You will never see the scale's MAC `DC:ED:83:84:2E:9D`.**
Fortunately, the Hoto protocol does not need it.

### Scanning

```swift
import CoreBluetooth

let HotoServiceUUID = CBUUID(string: "FE95")  // 16-bit form

class ScaleScanner: NSObject, CBCentralManagerDelegate {
    var manager: CBCentralManager!
    var onFound: ((CBPeripheral, [String: Any]) -> Void)?

    override init() {
        super.init()
        manager = CBCentralManager(delegate: self, queue: nil)
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        if central.state == .poweredOn {
            central.scanForPeripherals(
                withServices: [HotoServiceUUID],
                options: [CBCentralManagerScanOptionAllowDuplicatesKey: false]
            )
        }
    }

    func centralManager(_ central: CBCentralManager,
                        didDiscover peripheral: CBPeripheral,
                        advertisementData: [String: Any],
                        rssi RSSI: NSNumber) {
        // Optionally filter further by service data (device type 0x1180)
        if let serviceData = advertisementData[CBAdvertisementDataServiceDataKey]
                            as? [CBUUID: Data],
           let sd = serviceData[HotoServiceUUID],
           sd.count >= 4,
           sd[2] == 0x80, sd[3] == 0x11 {
            central.stopScan()
            onFound?(peripheral, advertisementData)
        }
    }
}
```

### Connecting and service discovery

```swift
class HotoScale: NSObject, CBPeripheralDelegate {
    let peripheral: CBPeripheral
    var controlChar: CBCharacteristic?
    var dataChar: CBCharacteristic?
    var mibleNotifyChar: CBCharacteristic?

    let serviceUUID  = CBUUID(string: "FE95")
    let controlUUID  = CBUUID(string: "00000010-0000-1000-8000-00805f9b34fb")
    let dataUUID     = CBUUID(string: "00000019-0000-1000-8000-00805f9b34fb")
    let mibleSvcUUID = CBUUID(string: "00000100-0065-6c62-2e74-6f696d2e696d")  // mi.miot.ble
    let mibleNotifyUUID = CBUUID(string: "00000102-0065-6c62-2e74-6f696d2e696d")

    func peripheral(_ peripheral: CBPeripheral,
                    didDiscoverServices error: Error?) {
        for svc in peripheral.services ?? [] {
            peripheral.discoverCharacteristics(nil, for: svc)
        }
    }

    func peripheral(_ peripheral: CBPeripheral,
                    didDiscoverCharacteristicsFor service: CBService,
                    error: Error?) {
        for ch in service.characteristics ?? [] {
            if ch.uuid == controlUUID { controlChar = ch }
            if ch.uuid == dataUUID    { dataChar = ch }
            if ch.uuid == mibleNotifyUUID { mibleNotifyChar = ch }
        }
        // After both fe95 chars found, enable notifications
        if controlChar != nil, dataChar != nil {
            peripheral.setNotifyValue(true, for: controlChar!)
            peripheral.setNotifyValue(true, for: dataChar!)
            // continue with bind or login...
        }
    }
}
```

## Crypto with CryptoKit + CommonCrypto

### P-256 ECDH

```swift
import CryptoKit

// Generate ephemeral keypair
let phonePriv = P256.KeyAgreement.PrivateKey()
let phonePub  = phonePriv.publicKey

// Raw X||Y for sending to scale (strip leading 0x04)
let phonePubRaw = phonePub.rawRepresentation   // 64 bytes, no prefix ✓

// Receive scale_pub_raw (64 bytes), prepend 0x04 for parsing
let scalePub = try P256.KeyAgreement.PublicKey(rawRepresentation: scalePubRaw)

// ECDH
let shared = try phonePriv.sharedSecretFromKeyAgreement(with: scalePub)
let sharedBytes = shared.withUnsafeBytes { Data($0) }   // 32 bytes
```

**Note:** `P256.KeyAgreement.PublicKey.rawRepresentation` in CryptoKit
matches the bare X||Y format (no 0x04 prefix), so you can use it directly
in both directions.

### HKDF-SHA256

```swift
import CryptoKit

let sharedKM = SymmetricKey(data: sharedBytes)

let derived = HKDF<SHA256>.deriveKey(
    inputKeyMaterial: sharedKM,
    salt: Data(),                       // NB: empty Data, treated as "no salt"
    info: "mible-setup-info".data(using: .utf8)!,
    outputByteCount: 64
)
let derivedBytes = derived.withUnsafeBytes { Data($0) }

let token   = derivedBytes[0..<12]
let bindKey = derivedBytes[12..<28]
let aesKey  = derivedBytes[28..<44]
```

For login HKDF:

```swift
let saltBytes = randKey + remoteKey          // 32 B salt
let derived = HKDF<SHA256>.deriveKey(
    inputKeyMaterial: SymmetricKey(data: token),
    salt: saltBytes,
    info: "mible-login-info".data(using: .utf8)!,
    outputByteCount: 64
)
```

### HMAC-SHA256

```swift
let key = SymmetricKey(data: dev_key)
let mac = HMAC<SHA256>.authenticationCode(for: remoteKey + randKey, using: key)
let macBytes = Data(mac)   // 32 bytes
```

### AES-CCM via CommonCrypto

CryptoKit does not expose CCM. Wrap CommonCrypto:

```swift
import CommonCrypto

enum AESCCMError: Error { case decryptFailed(Int32), encryptFailed(Int32), invalidKey }

/// AES-CCM with 4-byte MAC.
/// On encrypt: returns ciphertext + 4-byte tag concatenated.
/// On decrypt: input is ciphertext + 4-byte tag; returns plaintext (no tag).
struct AESCCM {
    let key: Data
    let tagLength: Int = 4

    init(key: Data) throws {
        guard key.count == 16 else { throw AESCCMError.invalidKey }
        self.key = key
    }

    func encrypt(nonce: Data, plaintext: Data, aad: Data) throws -> Data {
        var cryptor: CCCryptorRef?
        var status = CCCryptorCreateWithMode(
            CCOperation(kCCEncrypt),
            CCMode(kCCModeCCM),
            CCAlgorithm(kCCAlgorithmAES),
            CCPadding(ccNoPadding),
            nil,
            (key as NSData).bytes, key.count,
            nil, 0, 0, 0,
            &cryptor)
        guard status == 0, let cr = cryptor else { throw AESCCMError.encryptFailed(status) }
        defer { CCCryptorRelease(cr) }

        // Set CCM parameters
        var nonceLen = nonce.count
        var tagLen   = tagLength
        var ptLen    = plaintext.count
        var aadLen   = aad.count

        _ = withUnsafePointer(to: &nonceLen) {
            CCCryptorAddParameter(cr, kCCParameterIV, (nonce as NSData).bytes, $0.pointee)
        }
        _ = withUnsafePointer(to: &ptLen) {
            CCCryptorAddParameter(cr, kCCParameterDataSize, nil, $0.pointee)
        }
        _ = withUnsafePointer(to: &aadLen) {
            CCCryptorAddParameter(cr, kCCParameterAuthDataSize, nil, $0.pointee)
        }
        _ = withUnsafePointer(to: &tagLen) {
            CCCryptorAddParameter(cr, kCCParameterAuthTagLength, nil, $0.pointee)
        }
        if aad.count > 0 {
            CCCryptorAddParameter(cr, kCCParameterAuthData,
                                  (aad as NSData).bytes, aad.count)
        }

        var ciphertext = Data(count: plaintext.count)
        var dataOutMoved = 0
        status = ciphertext.withUnsafeMutableBytes { ctBuf in
            plaintext.withUnsafeBytes { ptBuf in
                CCCryptorUpdate(cr,
                                ptBuf.baseAddress, plaintext.count,
                                ctBuf.baseAddress, plaintext.count,
                                &dataOutMoved)
            }
        }
        guard status == 0 else { throw AESCCMError.encryptFailed(status) }

        var tag = Data(count: tagLength)
        var tagLenOut = tagLength
        _ = tag.withUnsafeMutableBytes { tBuf in
            CCCryptorGetParameter(cr, kCCParameterAuthTag, tBuf.baseAddress, &tagLenOut)
        }

        return ciphertext + tag
    }

    func decrypt(nonce: Data, ciphertextAndTag: Data, aad: Data) throws -> Data {
        let ctLen = ciphertextAndTag.count - tagLength
        guard ctLen >= 0 else { throw AESCCMError.decryptFailed(-1) }
        let ciphertext = ciphertextAndTag.prefix(ctLen)
        let tag        = ciphertextAndTag.suffix(tagLength)

        var cryptor: CCCryptorRef?
        var status = CCCryptorCreateWithMode(
            CCOperation(kCCDecrypt),
            CCMode(kCCModeCCM),
            CCAlgorithm(kCCAlgorithmAES),
            CCPadding(ccNoPadding),
            nil,
            (key as NSData).bytes, key.count,
            nil, 0, 0, 0,
            &cryptor)
        guard status == 0, let cr = cryptor else { throw AESCCMError.decryptFailed(status) }
        defer { CCCryptorRelease(cr) }

        var nonceLen = nonce.count
        var tagLen   = tagLength
        var ctLenVar = ctLen
        var aadLen   = aad.count

        _ = withUnsafePointer(to: &nonceLen) {
            CCCryptorAddParameter(cr, kCCParameterIV, (nonce as NSData).bytes, $0.pointee)
        }
        _ = withUnsafePointer(to: &ctLenVar) {
            CCCryptorAddParameter(cr, kCCParameterDataSize, nil, $0.pointee)
        }
        _ = withUnsafePointer(to: &aadLen) {
            CCCryptorAddParameter(cr, kCCParameterAuthDataSize, nil, $0.pointee)
        }
        _ = withUnsafePointer(to: &tagLen) {
            CCCryptorAddParameter(cr, kCCParameterAuthTagLength, nil, $0.pointee)
        }
        if aad.count > 0 {
            CCCryptorAddParameter(cr, kCCParameterAuthData,
                                  (aad as NSData).bytes, aad.count)
        }

        var plaintext = Data(count: ctLen)
        var dataOutMoved = 0
        status = plaintext.withUnsafeMutableBytes { ptBuf in
            ciphertext.withUnsafeBytes { ctBuf in
                CCCryptorUpdate(cr,
                                ctBuf.baseAddress, ctLen,
                                ptBuf.baseAddress, ctLen,
                                &dataOutMoved)
            }
        }
        guard status == 0 else { throw AESCCMError.decryptFailed(status) }

        // Verify tag
        var computedTag = Data(count: tagLength)
        var computedLen = tagLength
        _ = computedTag.withUnsafeMutableBytes { ctBuf in
            CCCryptorGetParameter(cr, kCCParameterAuthTag, ctBuf.baseAddress, &computedLen)
        }
        guard computedTag == tag else { throw AESCCMError.decryptFailed(-1) }

        return plaintext
    }
}
```

(This is a sketch; you may want to refine error handling and bounds checks
for production. Test against the reference vectors in `captures/`.)

### Using AES-CCM in the bind proof

```swift
let nonce = Data([0x10, 0x11, 0x12, 0x13, 0x14, 0x15,
                  0x16, 0x17, 0x18, 0x19, 0x1A, 0x1B])
let aad   = "devID".data(using: .utf8)!
let proof = try AESCCM(key: aesKey).encrypt(nonce: nonce,
                                             plaintext: remoteInfo,
                                             aad: aad)
// proof is 24 bytes: 20 byte ciphertext + 4 byte tag
```

## Fragment protocol helper

A reusable utility for the announce/ready/fragment/ack dance:

```swift
class Fragmenter {
    let peripheral: CBPeripheral
    let dataChar: CBCharacteristic
    var inbox: AsyncStream<Data>.Continuation?
    let stream: AsyncStream<Data>

    init(peripheral: CBPeripheral, dataChar: CBCharacteristic) {
        self.peripheral = peripheral
        self.dataChar = dataChar
        var cont: AsyncStream<Data>.Continuation?
        self.stream = AsyncStream { c in cont = c }
        self.inbox = cont
    }

    /// Call this from your CBPeripheralDelegate when notifications arrive on data char.
    func ingest(_ data: Data) {
        inbox?.yield(data)
    }

    private func readNext(timeout: TimeInterval = 5.0) async throws -> Data {
        return try await withThrowingTaskGroup(of: Data?.self) { group in
            group.addTask {
                for await frame in self.stream { return frame }
                return nil
            }
            group.addTask {
                try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
                return nil
            }
            for try await result in group {
                group.cancelAll()
                if let r = result { return r }
                throw NSError(domain: "Fragmenter", code: 1)
            }
            throw NSError(domain: "Fragmenter", code: 1)
        }
    }

    func send(announce: Data, payload: Data, chunk: Int = 18) async throws {
        peripheral.writeValue(announce, for: dataChar, type: .withoutResponse)
        let ready = try await readNext()
        guard ready == Data([0x00, 0x00, 0x01, 0x01]) else {
            throw NSError(domain: "Fragmenter", code: 2)
        }
        let nfrags = (payload.count + chunk - 1) / chunk
        for i in 0..<nfrags {
            let start = i * chunk
            let end = min(start + chunk, payload.count)
            var frag = Data()
            let idx = UInt16(i + 1).littleEndian
            withUnsafeBytes(of: idx) { frag.append(contentsOf: $0) }
            frag.append(payload[start..<end])
            peripheral.writeValue(frag, for: dataChar, type: .withoutResponse)
            try await Task.sleep(nanoseconds: 5_000_000)  // 5 ms pacing
        }
        let ack = try await readNext()
        guard ack == Data([0x00, 0x00, 0x01, 0x00]) else {
            throw NSError(domain: "Fragmenter", code: 3)
        }
    }

    func receive() async throws -> (Data, Data) {
        let announce = try await readNext()
        guard announce.count == 6,
              announce[0] == 0x00, announce[1] == 0x00, announce[2] == 0x00 else {
            throw NSError(domain: "Fragmenter", code: 4)
        }
        let nfrags = Int(UInt16(announce[4]) | (UInt16(announce[5]) << 8))
        peripheral.writeValue(Data([0x00, 0x00, 0x01, 0x01]),
                              for: dataChar, type: .withoutResponse)
        var parts: [Int: Data] = [:]
        for _ in 0..<nfrags {
            let d = try await readNext()
            let idx = Int(UInt16(d[0]) | (UInt16(d[1]) << 8))
            parts[idx] = d.dropFirst(2)
        }
        peripheral.writeValue(Data([0x00, 0x00, 0x01, 0x00]),
                              for: dataChar, type: .withoutResponse)
        let payload = (1...nfrags).reduce(Data()) { $0 + (parts[$1] ?? Data()) }
        return (announce, payload)
    }
}
```

(Adjust the async/AsyncStream plumbing to fit your project's concurrency
model; this is a sketch.)

## Putting it together — bind sketch

```swift
func bind() async throws -> Data {  // returns 12-byte token
    let frag = self.fragmenter
    let control = self.controlChar!

    // 1. Send a2 00 00 00
    peripheral.writeValue(Data([0xa2, 0x00, 0x00, 0x00]),
                          for: control, type: .withoutResponse)

    // 2. Receive scale's DID payload (24 B raw, 20 B remote_info)
    let (_, raw) = try await frag.receive()
    let remoteInfo = raw.suffix(from: 4)  // 20 bytes

    // 3. Send 15 00 00 00
    peripheral.writeValue(Data([0x15, 0x00, 0x00, 0x00]),
                          for: control, type: .withoutResponse)

    // 4. Generate keypair, send pubkey
    let phonePriv = P256.KeyAgreement.PrivateKey()
    let phonePubXY = phonePriv.publicKey.rawRepresentation
    try await frag.send(announce: Data([0x00, 0x00, 0x00, 0x03, 0x04, 0x00]),
                        payload: phonePubXY)

    // 5. Receive scale pubkey
    let (_, scalePubXY) = try await frag.receive()
    let scalePub = try P256.KeyAgreement.PublicKey(rawRepresentation: scalePubXY)

    // 6. ECDH + HKDF
    let shared = try phonePriv.sharedSecretFromKeyAgreement(with: scalePub)
    let derived = HKDF<SHA256>.deriveKey(
        inputKeyMaterial: SymmetricKey(data: shared.withUnsafeBytes { Data($0) }),
        salt: Data(),
        info: "mible-setup-info".data(using: .utf8)!,
        outputByteCount: 64
    ).withUnsafeBytes { Data($0) }

    let token  = derived[0..<12]
    let aesKey = derived[28..<44]

    // 7. AES-CCM encrypt remote_info as proof
    let proof = try AESCCM(key: aesKey).encrypt(
        nonce: Data(0x10...0x1B),
        plaintext: remoteInfo,
        aad: "devID".data(using: .utf8)!
    )
    try await frag.send(announce: Data([0x00, 0x00, 0x00, 0x00, 0x02, 0x00]),
                        payload: proof)

    // 8. Finalize and read response
    peripheral.writeValue(Data([0x13, 0x00, 0x00, 0x00]),
                          for: control, type: .withoutResponse)
    let response = try await waitForControlNotification(timeout: 5.0)
    guard response == Data([0x11, 0x00, 0x00, 0x00]) else {
        throw HotoError.bindRejected
    }
    return token
}
```

## Weight notification handling

```swift
func handleWeightNotification(_ data: Data,
                              dev_key: Data, dev_iv: Data) {
    guard data.count >= 6 else { return }
    let idx = data.prefix(2)
    let payload = data.suffix(from: 2)

    var nonce = Data()
    nonce.append(dev_iv)                                // 4 B
    nonce.append(Data(repeating: 0, count: 4))          // 4 zero bytes
    nonce.append(idx)                                   // 2 B counter
    nonce.append(Data(repeating: 0, count: 2))          // 2 zero bytes

    do {
        let plain = try AESCCM(key: dev_key).decrypt(
            nonce: nonce, ciphertextAndTag: payload, aad: Data()
        )
        if let frame = parseM365Frame(plain) {
            publishWeight(frame)
        }
    } catch {
        // decrypt failed — skip silently
    }
}

struct WeightFrame {
    enum Kind { case active, stable, idle, unknown }
    let kind: Kind
    let grams: Double?
}

func parseM365Frame(_ plain: Data) -> WeightFrame? {
    guard plain.count >= 5,
          plain[0] == 0x55, plain[1] == 0xAA,
          plain[2] == 0x01, plain[plain.count - 1] == 0xFE else {
        return nil
    }
    // Checksum verification
    let chkExpected = plain[3..<(plain.count - 2)].reduce(0, { $0 + Int($1) }) % 256
    guard Int(plain[plain.count - 2]) == chkExpected else {
        return nil
    }

    let cmd = plain[3]
    switch cmd {
    case 0x02 where plain.count == 7:
        return WeightFrame(kind: .idle, grams: nil)
    case 0x07, 0x08 where plain.count == 10 && plain[4] == 0x03:
        let raw = UInt32(plain[5]) |
                  (UInt32(plain[6]) << 8) |
                  (UInt32(plain[7]) << 16)
        return WeightFrame(kind: cmd == 0x08 ? .stable : .active,
                           grams: Double(raw) / 10.0)
    default:
        return WeightFrame(kind: .unknown, grams: nil)
    }
}
```

## Persistence

Save the bind token to the iOS Keychain (not UserDefaults — it's a long-term
credential):

```swift
import Security

let tokenAccount = "com.yourapp.hoto.token"
let tokenService = "com.yourapp.hoto"

func saveToken(_ token: Data) {
    let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrAccount as String: tokenAccount,
        kSecAttrService as String: tokenService,
    ]
    SecItemDelete(query as CFDictionary)
    var add = query
    add[kSecValueData as String] = token
    add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
    SecItemAdd(add as CFDictionary, nil)
}

func loadToken() -> Data? {
    let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrAccount as String: tokenAccount,
        kSecAttrService as String: tokenService,
        kSecReturnData as String: true,
    ]
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    return status == errSecSuccess ? (item as? Data) : nil
}
```

## Testing without the physical scale

Use the reference test vectors in `captures/test_vectors.json` to validate
your crypto offline. Each vector has:

- Bind: phone_priv, scale_pub, expected derived, expected proof
- Login: token, rand_key, remote_key, expected derived, expected info
- Decrypt: dev_key, dev_iv, idx, ciphertext, expected plaintext

If your Swift implementation produces the same bytes for the same inputs,
the over-the-wire integration is just plumbing.

## Common pitfalls in iOS Core Bluetooth

### Notify subscriptions need willWriteValue completion
On iOS, `writeValue(..., type: .withoutResponse)` is fire-and-forget but
queued; reading from the same characteristic immediately may miss the
write. Use `peripheralIsReady(toSendWriteWithoutResponse:)` to gate
high-rate writes.

### Reading from MiBle service may require GATT re-discovery
Some Mi devices only "publish" the `mi.miot.ble` service after auth. iOS
caches the GATT database aggressively; you may need to invalidate the
cache between connects. Call `discoverServices(nil)` after login completes.

### MTU
iOS negotiates a default MTU of 185 bytes ATT (so ~182 useful). Fragment
size 18 bytes per chunk leaves comfortable headroom.

### Disconnection during scan
If the app is backgrounded or the user navigates away, BLE may pause. Use
state restoration (`CBCentralManagerOptionRestoreIdentifierKey`) if you
need resilience.

## Architecture suggestion for a clean iOS module

```
Sources/
└── HotoScale/
    ├── HotoScale.swift          // Main public class (async API)
    ├── HotoScaleDelegate.swift  // CBPeripheralDelegate impl
    ├── Fragmenter.swift
    ├── AESCCM.swift
    ├── M365Frame.swift
    ├── Constants.swift          // UUIDs, magic codes
    └── KeychainStore.swift
Tests/
└── HotoScaleTests/
    ├── CryptoVectorTests.swift  // tests against captures/test_vectors.json
    └── FrameParseTests.swift
```

Public API sketch:

```swift
public actor HotoScale {
    public enum State { case idle, scanning, connecting, binding, loggingIn, streaming, error(Error) }

    public var state: State { get async }
    public var weights: AsyncStream<WeightFrame> { get async }

    public func scanAndConnect() async throws
    public func bindIfNeeded() async throws        // no-op if token exists
    public func startStreaming() async throws
    public func disconnect() async
}
```

## What you DON'T need

- A Mi / Xiaomi cloud account
- Network access (after first install)
- Any decryption of MiBeacon advertisements (the scale doesn't broadcast weight in ADV)
- The scale's real MAC address
- Bonding / pairing / Pin entry

The whole thing runs offline once you've bound the scale once.
