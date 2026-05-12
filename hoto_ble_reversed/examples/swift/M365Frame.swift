import Foundation

/// Parsed plaintext frame from the scale.
public struct WeightFrame: Equatable {
    public enum Kind: String {
        case active     // weight changing
        case stable     // weight settled
        case idle       // no significant weight
        case event      // button or other event
        case unknown
    }
    public let kind: Kind
    public let grams: Double?       // present for active/stable
    public let raw_value: UInt32?   // present for active/stable
    public let statusByte: UInt8?   // present for idle/event
}

/// Parse a decrypted M365 UART frame: `55 aa 01 [cmd] [data] [chk] fe`.
/// Returns nil if structurally invalid; returns a frame with kind=.unknown
/// for unrecognized cmd codes.
public func parseM365Frame(_ plain: Data) -> WeightFrame? {
    guard plain.count >= 5,
          plain[0] == 0x55, plain[1] == 0xAA,
          plain[2] == 0x01,
          plain[plain.count - 1] == 0xFE else {
        return nil
    }

    // Verify checksum: sum of plain[3 ..< count-2] mod 256
    let sumStart = plain.index(plain.startIndex, offsetBy: 3)
    let sumEnd = plain.index(plain.endIndex, offsetBy: -2)
    let sum = plain[sumStart..<sumEnd].reduce(0) { (acc: Int, b: UInt8) in acc + Int(b) }
    let expected = UInt8(sum % 256)
    let actual = plain[plain.index(plain.endIndex, offsetBy: -2)]
    guard expected == actual else { return nil }

    let cmd = plain[3]

    if cmd == 0x02, plain.count == 7 {
        return WeightFrame(kind: .idle, grams: nil, raw_value: nil,
                           statusByte: plain[5])
    }
    if cmd == 0x05, plain.count == 7 {
        return WeightFrame(kind: .event, grams: nil, raw_value: nil,
                           statusByte: plain[5])
    }
    if (cmd == 0x07 || cmd == 0x08), plain.count == 10, plain[4] == 0x03 {
        let raw = UInt32(plain[5])
                | (UInt32(plain[6]) << 8)
                | (UInt32(plain[7]) << 16)
        return WeightFrame(
            kind: cmd == 0x08 ? .stable : .active,
            grams: Double(raw) / 10.0,
            raw_value: raw,
            statusByte: nil
        )
    }
    return WeightFrame(kind: .unknown, grams: nil, raw_value: nil, statusByte: nil)
}
