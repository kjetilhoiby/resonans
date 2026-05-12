import CommonCrypto
import Foundation

/// AES-CCM-128 wrapper using CommonCrypto.
///
/// The Hoto protocol uses 4-byte MAC throughout. CCM is the *authenticated*
/// mode of AES used by both the bind-proof and the stream encryption.
///
/// CryptoKit does not expose CCM (only GCM); CommonCrypto has it via
/// CCCryptorCreateWithMode(kCCModeCCM) since iOS 13. The API is fiddly:
/// every parameter (nonce, plaintext length, AAD length, tag length, AAD
/// itself) is set via CCCryptorAddParameter() in a specific order, then
/// CCCryptorUpdate() does the encryption/decryption, then
/// CCCryptorGetParameter(kCCParameterAuthTag) extracts the tag.
public enum AESCCMError: Error {
    case invalidKey
    case encryptFailed(Int32)
    case decryptFailed(Int32)
    case authenticationFailed
}

public struct AESCCM {
    public let key: Data
    public let tagLength: Int

    public init(key: Data, tagLength: Int = 4) throws {
        guard key.count == 16 else { throw AESCCMError.invalidKey }
        self.key = key
        self.tagLength = tagLength
    }

    public func encrypt(nonce: Data, plaintext: Data, aad: Data) throws -> Data {
        var ref: CCCryptorRef?
        var status = key.withUnsafeBytes { keyBuf in
            CCCryptorCreateWithMode(
                CCOperation(kCCEncrypt),
                CCMode(kCCModeCCM),
                CCAlgorithm(kCCAlgorithmAES),
                CCPadding(ccNoPadding),
                nil, keyBuf.baseAddress, key.count,
                nil, 0, 0, 0, &ref
            )
        }
        guard status == kCCSuccess, let cr = ref else {
            throw AESCCMError.encryptFailed(status)
        }
        defer { CCCryptorRelease(cr) }

        var nonceLen = nonce.count
        var ptLen = plaintext.count
        var aadLen = aad.count
        var tagLen = tagLength

        _ = nonce.withUnsafeBytes { CCCryptorAddParameter(cr, kCCParameterIV,
                                    $0.baseAddress, nonceLen) }
        _ = CCCryptorAddParameter(cr, kCCParameterDataSize, nil, ptLen)
        _ = CCCryptorAddParameter(cr, kCCParameterAuthDataSize, nil, aadLen)
        _ = CCCryptorAddParameter(cr, kCCParameterAuthTagLength, nil, tagLen)
        if aadLen > 0 {
            _ = aad.withUnsafeBytes { CCCryptorAddParameter(cr, kCCParameterAuthData,
                                      $0.baseAddress, aadLen) }
        }

        var ciphertext = Data(count: ptLen)
        var outMoved = 0
        status = plaintext.withUnsafeBytes { ptBuf in
            ciphertext.withUnsafeMutableBytes { ctBuf in
                CCCryptorUpdate(cr,
                                ptBuf.baseAddress, ptLen,
                                ctBuf.baseAddress, ptLen,
                                &outMoved)
            }
        }
        guard status == kCCSuccess else { throw AESCCMError.encryptFailed(status) }

        var tag = Data(count: tagLength)
        var tagLenOut = tagLength
        _ = tag.withUnsafeMutableBytes { tBuf in
            CCCryptorGetParameter(cr, kCCParameterAuthTag, tBuf.baseAddress, &tagLenOut)
        }
        return ciphertext + tag
    }

    public func decrypt(nonce: Data, ciphertextAndTag: Data, aad: Data) throws -> Data {
        guard ciphertextAndTag.count >= tagLength else {
            throw AESCCMError.decryptFailed(-1)
        }
        let ctLen = ciphertextAndTag.count - tagLength
        let ciphertext = ciphertextAndTag.prefix(ctLen)
        let tag        = ciphertextAndTag.suffix(tagLength)

        var ref: CCCryptorRef?
        var status = key.withUnsafeBytes { keyBuf in
            CCCryptorCreateWithMode(
                CCOperation(kCCDecrypt),
                CCMode(kCCModeCCM),
                CCAlgorithm(kCCAlgorithmAES),
                CCPadding(ccNoPadding),
                nil, keyBuf.baseAddress, key.count,
                nil, 0, 0, 0, &ref
            )
        }
        guard status == kCCSuccess, let cr = ref else {
            throw AESCCMError.decryptFailed(status)
        }
        defer { CCCryptorRelease(cr) }

        var nonceLen = nonce.count
        var ctLenVar = ctLen
        var aadLen = aad.count
        var tagLen = tagLength

        _ = nonce.withUnsafeBytes { CCCryptorAddParameter(cr, kCCParameterIV,
                                    $0.baseAddress, nonceLen) }
        _ = CCCryptorAddParameter(cr, kCCParameterDataSize, nil, ctLenVar)
        _ = CCCryptorAddParameter(cr, kCCParameterAuthDataSize, nil, aadLen)
        _ = CCCryptorAddParameter(cr, kCCParameterAuthTagLength, nil, tagLen)
        if aadLen > 0 {
            _ = aad.withUnsafeBytes { CCCryptorAddParameter(cr, kCCParameterAuthData,
                                      $0.baseAddress, aadLen) }
        }

        var plaintext = Data(count: ctLen)
        var outMoved = 0
        status = ciphertext.withUnsafeBytes { ctBuf in
            plaintext.withUnsafeMutableBytes { ptBuf in
                CCCryptorUpdate(cr,
                                ctBuf.baseAddress, ctLen,
                                ptBuf.baseAddress, ctLen,
                                &outMoved)
            }
        }
        guard status == kCCSuccess else { throw AESCCMError.decryptFailed(status) }

        var computedTag = Data(count: tagLength)
        var computedLen = tagLength
        _ = computedTag.withUnsafeMutableBytes { tBuf in
            CCCryptorGetParameter(cr, kCCParameterAuthTag, tBuf.baseAddress, &computedLen)
        }
        guard computedTag == tag else {
            throw AESCCMError.authenticationFailed
        }
        return plaintext
    }
}
