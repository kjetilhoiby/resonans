import CoreBluetooth
import Foundation

enum HotoConstants {
    // ----- GATT UUIDs -----
    static let serviceFE95     = CBUUID(string: "FE95")
    static let charControl     = CBUUID(string: "00000010-0000-1000-8000-00805f9b34fb")
    static let charData        = CBUUID(string: "00000019-0000-1000-8000-00805f9b34fb")
    static let serviceMiBLE    = CBUUID(string: "00000100-0065-6c62-2e74-6f696d2e696d")
    static let charMiBLECmd    = CBUUID(string: "00000101-0065-6c62-2e74-6f696d2e696d")
    static let charMiBLENotify = CBUUID(string: "00000102-0065-6c62-2e74-6f696d2e696d")

    // ----- Control magic codes -----
    static let CMD_GET_INFO    = Data([0xa2, 0x00, 0x00, 0x00])  // start bind
    static let CMD_SET_KEY     = Data([0x15, 0x00, 0x00, 0x00])  // bind phase-2
    static let CMD_AUTH        = Data([0x13, 0x00, 0x00, 0x00])  // bind finalize
    static let CMD_LOGIN       = Data([0x24, 0x00, 0x00, 0x00])  // start login

    static let REGISTER_OK     = Data([0x11, 0x00, 0x00, 0x00])
    static let REGISTER_ERR    = Data([0x12, 0x00, 0x00, 0x00])
    static let LOGIN_OK        = Data([0x21, 0x00, 0x00, 0x00])
    static let LOGIN_ERR       = Data([0x23, 0x00, 0x00, 0x00])

    // ----- Data channel announces -----
    static let CMD_SEND_DATA   = Data([0x00, 0x00, 0x00, 0x03, 0x04, 0x00])  // 64 B pubkey
    static let CMD_SEND_DID    = Data([0x00, 0x00, 0x00, 0x00, 0x02, 0x00])  // 24 B proof
    static let CMD_SEND_KEY    = Data([0x00, 0x00, 0x00, 0x0b, 0x01, 0x00])  // 16 B rand
    static let CMD_SEND_INFO   = Data([0x00, 0x00, 0x00, 0x0a, 0x02, 0x00])  // 32 B info

    static let RCV_RDY         = Data([0x00, 0x00, 0x01, 0x01])
    static let RCV_OK          = Data([0x00, 0x00, 0x01, 0x00])

    // ----- AES-CCM register parameters -----
    static let aesRegisterNonce = Data((0x10...0x1B).map { UInt8($0) })  // 12 B
    static let aesRegisterAAD   = "devID".data(using: .utf8)!

    // ----- HKDF parameters -----
    static let infoBindSetup = "mible-setup-info".data(using: .utf8)!
    static let infoLogin     = "mible-login-info".data(using: .utf8)!

    // ----- Keychain identifiers -----
    static let keychainService = "com.yourapp.hoto"
    static let keychainAccount = "com.yourapp.hoto.token"

    // ----- Device discovery -----
    static let hotoDeviceTypeBE: [UInt8] = [0x80, 0x11]  // 0x1180 at offset 2..3 of service_data
}
