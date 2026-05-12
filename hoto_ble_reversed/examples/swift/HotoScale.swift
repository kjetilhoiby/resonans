import CoreBluetooth
import CryptoKit
import Foundation
import Security

/// Hoto Smart Kitchen Scale BLE client.
///
/// Lifecycle:
///   let scale = HotoScale()
///   try await scale.scanAndConnect()
///   try await scale.bindIfNeeded()        // saves token to Keychain
///   for await frame in scale.weightStream() { … }
///
/// This is a skeleton. The Core Bluetooth state machine here is simplified;
/// for production add proper error recovery, reconnection handling, and a
/// real concurrency model (Combine, Observation, or an actor pattern).
@MainActor
public final class HotoScale: NSObject {

    public enum HotoError: Error {
        case notConnected
        case scanFailed
        case bindRejected
        case loginRejected
        case loginVerificationFailed
        case unexpectedResponse(Data)
        case timeout
    }

    private let centralQueue = DispatchQueue(label: "hoto.ble", qos: .userInitiated)
    private var central: CBCentralManager!
    private var peripheral: CBPeripheral?

    private var controlChar: CBCharacteristic?
    private var dataChar: CBCharacteristic?
    private var notifyChar: CBCharacteristic?

    // Notification inbox streams
    private var controlInbox = AsyncStream<Data>.makeStream()
    private var dataInbox = AsyncStream<Data>.makeStream()
    private var weightInbox = AsyncStream<Data>.makeStream()

    public override init() {
        super.init()
        central = CBCentralManager(delegate: self, queue: centralQueue)
    }

    // MARK: - Public API

    public func scanAndConnect() async throws {
        // Wait for state .poweredOn, scan for HotoConstants.serviceFE95
        // Connect when found, then discoverServices
        // …
    }

    public func bindIfNeeded() async throws -> Data {
        if let token = loadToken() { return token }

        guard let pr = peripheral, let control = controlChar, let data = dataChar
        else { throw HotoError.notConnected }

        // Subscribe to notifications
        pr.setNotifyValue(true, for: control)
        pr.setNotifyValue(true, for: data)

        // 1. → CMD_GET_INFO
        pr.writeValue(HotoConstants.CMD_GET_INFO, for: control, type: .withoutResponse)

        // 2. ← remote_info (24 B raw, take last 20)
        let (_, raw) = try await receiveFragmented()
        let remoteInfo = raw.suffix(from: 4)
        guard remoteInfo.count == 20 else {
            throw HotoError.unexpectedResponse(raw)
        }

        // 3. → CMD_SET_KEY
        pr.writeValue(HotoConstants.CMD_SET_KEY, for: control, type: .withoutResponse)

        // 4. → phone P-256 pubkey (64 B)
        let phonePriv = P256.KeyAgreement.PrivateKey()
        let phonePubXY = phonePriv.publicKey.rawRepresentation
        try await sendFragmented(announce: HotoConstants.CMD_SEND_DATA,
                                  payload: phonePubXY)

        // 5. ← scale pubkey (64 B)
        let (_, scalePubXY) = try await receiveFragmented()
        let scalePub = try P256.KeyAgreement.PublicKey(rawRepresentation: scalePubXY)

        // 6. ECDH + HKDF
        let shared = try phonePriv.sharedSecretFromKeyAgreement(with: scalePub)
        let sharedData = shared.withUnsafeBytes { Data($0) }
        let derived = HKDF<SHA256>.deriveKey(
            inputKeyMaterial: SymmetricKey(data: sharedData),
            salt: Data(),
            info: HotoConstants.infoBindSetup,
            outputByteCount: 64
        ).withUnsafeBytes { Data($0) }

        let token  = derived.subdata(in: 0..<12)
        let aesKey = derived.subdata(in: 28..<44)

        // 7. AES-CCM encrypt remote_info as proof
        let proof = try AESCCM(key: aesKey).encrypt(
            nonce: HotoConstants.aesRegisterNonce,
            plaintext: Data(remoteInfo),
            aad: HotoConstants.aesRegisterAAD
        )

        // 8. → proof
        try await sendFragmented(announce: HotoConstants.CMD_SEND_DID,
                                  payload: proof)

        // 9. → CMD_AUTH
        pr.writeValue(HotoConstants.CMD_AUTH, for: control, type: .withoutResponse)

        // 10. ← REGISTER_OK
        let response = try await receiveControlNotification(timeout: 5.0)
        guard response == HotoConstants.REGISTER_OK else {
            throw HotoError.bindRejected
        }

        try saveToken(token)
        return token
    }

    /// Performs login, subscribes to weight notify, yields parsed frames.
    public func weightStream() -> AsyncStream<WeightFrame> {
        AsyncStream { continuation in
            Task {
                do {
                    let token = try await bindIfNeeded()
                    let keys = try await loginWith(token: token)
                    try await subscribeToWeight()

                    var lastPlain: Data?
                    for await notif in weightInbox.stream {
                        guard notif.count >= 6 else { continue }
                        let idx = notif.prefix(2)
                        let payload = notif.suffix(from: 2)

                        var nonce = Data()
                        nonce.append(keys.devIv)
                        nonce.append(Data(repeating: 0, count: 4))
                        nonce.append(idx)
                        nonce.append(Data(repeating: 0, count: 2))

                        do {
                            let plain = try AESCCM(key: keys.devKey).decrypt(
                                nonce: nonce,
                                ciphertextAndTag: payload,
                                aad: Data()
                            )
                            if plain == lastPlain { continue }
                            lastPlain = plain
                            if let frame = parseM365Frame(plain) {
                                continuation.yield(frame)
                            }
                        } catch {
                            // skip undecryptable frames silently
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish()
                }
            }
        }
    }

    // MARK: - Login internals

    private struct SessionKeys {
        let devKey: Data
        let appKey: Data
        let devIv: Data
        let appIv: Data
    }

    private func loginWith(token: Data) async throws -> SessionKeys {
        guard let pr = peripheral, let control = controlChar else {
            throw HotoError.notConnected
        }

        // Generate rand_key (16 B)
        var randKey = Data(count: 16)
        _ = randKey.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, 16, $0.baseAddress!) }

        // → CMD_LOGIN
        pr.writeValue(HotoConstants.CMD_LOGIN, for: control, type: .withoutResponse)
        // → rand_key
        try await sendFragmented(announce: HotoConstants.CMD_SEND_KEY, payload: randKey)

        // ← remote_key (16 B)
        let (_, remoteKey) = try await receiveFragmented()
        guard remoteKey.count == 16 else { throw HotoError.unexpectedResponse(remoteKey) }

        // ← remote_info (32 B)
        let (_, remoteInfo) = try await receiveFragmented()
        guard remoteInfo.count == 32 else { throw HotoError.unexpectedResponse(remoteInfo) }

        // Derive
        let salt = randKey + remoteKey
        let derived = HKDF<SHA256>.deriveKey(
            inputKeyMaterial: SymmetricKey(data: token),
            salt: salt,
            info: HotoConstants.infoLogin,
            outputByteCount: 64
        ).withUnsafeBytes { Data($0) }

        let devKey = derived.subdata(in: 0..<16)
        let appKey = derived.subdata(in: 16..<32)
        let devIv  = derived.subdata(in: 32..<36)
        let appIv  = derived.subdata(in: 36..<40)

        // Verify scale
        let saltInv = remoteKey + randKey
        let expected = Data(HMAC<SHA256>.authenticationCode(
            for: saltInv, using: SymmetricKey(data: devKey)
        ))
        guard expected == remoteInfo else {
            throw HotoError.loginVerificationFailed
        }

        // Send our info
        let phoneInfo = Data(HMAC<SHA256>.authenticationCode(
            for: salt, using: SymmetricKey(data: appKey)
        ))
        try await sendFragmented(announce: HotoConstants.CMD_SEND_INFO,
                                  payload: phoneInfo)

        // Read LOGIN_OK
        let response = try await receiveControlNotification(timeout: 5.0)
        guard response == HotoConstants.LOGIN_OK else {
            throw HotoError.loginRejected
        }

        return SessionKeys(devKey: devKey, appKey: appKey, devIv: devIv, appIv: appIv)
    }

    private func subscribeToWeight() async throws {
        guard let pr = peripheral, let notif = notifyChar else {
            throw HotoError.notConnected
        }
        pr.setNotifyValue(true, for: notif)
        // The CBPeripheralDelegate callback feeds weightInbox
    }

    // MARK: - Fragmented protocol helpers

    private func sendFragmented(announce: Data, payload: Data,
                                  chunk: Int = 18) async throws {
        guard let pr = peripheral, let data = dataChar else {
            throw HotoError.notConnected
        }
        pr.writeValue(announce, for: data, type: .withoutResponse)
        let ready = try await receiveDataNotification(timeout: 5.0)
        guard ready == HotoConstants.RCV_RDY else {
            throw HotoError.unexpectedResponse(ready)
        }
        let nfrags = (payload.count + chunk - 1) / chunk
        for i in 0..<nfrags {
            let start = i * chunk
            let end = min(start + chunk, payload.count)
            var frag = Data()
            let idx = UInt16(i + 1).littleEndian
            withUnsafeBytes(of: idx) { frag.append(contentsOf: $0) }
            frag.append(payload[start..<end])
            pr.writeValue(frag, for: data, type: .withoutResponse)
            try await Task.sleep(nanoseconds: 5_000_000)
        }
        let ack = try await receiveDataNotification(timeout: 5.0)
        guard ack == HotoConstants.RCV_OK else {
            throw HotoError.unexpectedResponse(ack)
        }
    }

    private func receiveFragmented() async throws -> (Data, Data) {
        guard let pr = peripheral, let data = dataChar else {
            throw HotoError.notConnected
        }
        let announce = try await receiveDataNotification(timeout: 10.0)
        guard announce.count == 6,
              announce[0] == 0, announce[1] == 0, announce[2] == 0 else {
            throw HotoError.unexpectedResponse(announce)
        }
        let nfrags = Int(UInt16(announce[4]) | (UInt16(announce[5]) << 8))
        pr.writeValue(HotoConstants.RCV_RDY, for: data, type: .withoutResponse)
        var parts: [Int: Data] = [:]
        for _ in 0..<nfrags {
            let d = try await receiveDataNotification(timeout: 5.0)
            let idx = Int(UInt16(d[0]) | (UInt16(d[1]) << 8))
            parts[idx] = d.dropFirst(2)
        }
        pr.writeValue(HotoConstants.RCV_OK, for: data, type: .withoutResponse)
        var assembled = Data()
        for i in 1...nfrags {
            assembled.append(parts[i] ?? Data())
        }
        return (announce, assembled)
    }

    // MARK: - Inbox await helpers

    private func receiveControlNotification(timeout: TimeInterval) async throws -> Data {
        try await receive(stream: controlInbox.stream, timeout: timeout)
    }
    private func receiveDataNotification(timeout: TimeInterval) async throws -> Data {
        try await receive(stream: dataInbox.stream, timeout: timeout)
    }
    private func receive(stream: AsyncStream<Data>, timeout: TimeInterval) async throws -> Data {
        try await withThrowingTaskGroup(of: Data?.self) { group in
            group.addTask {
                for await d in stream { return d }
                return nil
            }
            group.addTask {
                try await Task.sleep(nanoseconds: UInt64(timeout * 1e9))
                return nil
            }
            for try await r in group {
                group.cancelAll()
                if let r = r { return r }
                throw HotoError.timeout
            }
            throw HotoError.timeout
        }
    }

    // MARK: - Keychain

    private func saveToken(_ token: Data) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: HotoConstants.keychainService,
            kSecAttrAccount as String: HotoConstants.keychainAccount,
        ]
        SecItemDelete(query as CFDictionary)
        var add = query
        add[kSecValueData as String] = token
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        let status = SecItemAdd(add as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw HotoError.unexpectedResponse(Data([UInt8(status & 0xff)]))
        }
    }

    private func loadToken() -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: HotoConstants.keychainService,
            kSecAttrAccount as String: HotoConstants.keychainAccount,
            kSecReturnData as String: true,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        return status == errSecSuccess ? (item as? Data) : nil
    }
}

// MARK: - CBCentralManagerDelegate / CBPeripheralDelegate

extension HotoScale: CBCentralManagerDelegate, CBPeripheralDelegate {
    public func centralManagerDidUpdateState(_ central: CBCentralManager) {
        // Used by scanAndConnect to know when to start scanning
    }

    public func centralManager(_ central: CBCentralManager,
                               didDiscover peripheral: CBPeripheral,
                               advertisementData: [String: Any],
                               rssi RSSI: NSNumber) {
        // Validate fe95 + device type 0x1180, then connect
    }

    public func centralManager(_ central: CBCentralManager,
                               didConnect peripheral: CBPeripheral) {
        peripheral.delegate = self
        peripheral.discoverServices([
            HotoConstants.serviceFE95,
            HotoConstants.serviceMiBLE,
        ])
    }

    public func peripheral(_ peripheral: CBPeripheral,
                           didDiscoverServices error: Error?) {
        for svc in peripheral.services ?? [] {
            peripheral.discoverCharacteristics(nil, for: svc)
        }
    }

    public func peripheral(_ peripheral: CBPeripheral,
                           didDiscoverCharacteristicsFor service: CBService,
                           error: Error?) {
        for ch in service.characteristics ?? [] {
            switch ch.uuid {
            case HotoConstants.charControl:     controlChar = ch
            case HotoConstants.charData:        dataChar = ch
            case HotoConstants.charMiBLENotify: notifyChar = ch
            default: break
            }
        }
    }

    public func peripheral(_ peripheral: CBPeripheral,
                           didUpdateValueFor characteristic: CBCharacteristic,
                           error: Error?) {
        guard let data = characteristic.value else { return }
        switch characteristic.uuid {
        case HotoConstants.charControl:     controlInbox.continuation.yield(data)
        case HotoConstants.charData:        dataInbox.continuation.yield(data)
        case HotoConstants.charMiBLENotify: weightInbox.continuation.yield(data)
        default: break
        }
    }
}
