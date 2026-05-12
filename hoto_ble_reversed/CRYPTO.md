# Cryptography

All cryptographic operations needed to talk to the scale, with exact
parameters and worked examples. Use this together with
[PROTOCOL.md](PROTOCOL.md) for the wire framing.

## Primitives used

| Primitive | Purpose                              |
|-----------|--------------------------------------|
| **P-256** (secp256r1, NIST P-256, prime256v1) | Ephemeral ECDH for bind |
| **HKDF-SHA256** | Key derivation in bind and login |
| **AES-CCM-128** (4-byte MAC) | Bind proof and stream encryption |
| **HMAC-SHA256** | Login mutual authentication |

**iOS note:** `CryptoKit` covers P-256, HKDF, and HMAC. AES-CCM is **not in
CryptoKit** but is available via CommonCrypto (`CCCryptorCreateWithMode` +
`kCCModeCCM`, iOS 13+) or via a Swift implementation. See SWIFT.md for the
CommonCrypto wrapper.

## Bind (register)

### Step 1: Receive scale's remote_info

The scale sends 24 bytes via the data channel (announce type=0x00,
2 fragments). Strip the first 4 bytes to get `remote_info` (20 bytes):

```
raw_received = b"\x01\x00\x00\x00\x00" + b"<19-byte ASCII DID>" + b"\0..."  (24 B)
remote_info  = raw_received[4:]                                              (20 B)
             = b"\x00" + b"blt.4.1h37o9hp0gg00"                              (1 + 19 = 20)
```

The leading 0x00 byte and trailing position are part of the value — keep
remote_info exactly as the 20-byte slice.

### Step 2: Generate P-256 keypair, exchange pubkeys

```python
# Phone side
phone_priv = ec.generate_private_key(ec.SECP256R1())
phone_pub_xy = phone_pub.public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)[1:]
# phone_pub_xy is 64 bytes = X (32) || Y (32), uncompressed, NO 0x04 prefix
```

Send `phone_pub_xy` as 64-byte payload (announce type=0x03, 4 fragments
of 18+18+18+10).

Receive scale's 64-byte pubkey the same way:

```python
scale_pub_xy = <received from scale, 64 B>
scale_pub = ec.EllipticCurvePublicKey.from_encoded_point(
    ec.SECP256R1(), b"\x04" + scale_pub_xy
)
```

### Step 3: ECDH and HKDF

```python
shared = phone_priv.exchange(ec.ECDH(), scale_pub)   # 32 B

derived = HKDF(
    algorithm = SHA256,
    length    = 64,
    salt      = None,                  # NB: salt is None, not empty bytes
    info      = b"mible-setup-info",
).derive(shared)
```

Slice the 64-byte `derived` into named keys:

| Slice | Name      | Size | Use                                          |
|-------|-----------|------|----------------------------------------------|
| [0:12] | **token** | 12 B | Long-term identity. Save to disk.            |
| [12:28]| bind_key  | 16 B | Probably reserved for MiBeacon ADV decrypt   |
| [28:44]| **aes_key**| 16 B| AES-128 key for register-proof encryption    |
| [44:64]| (unused)  | 20 B | —                                            |

### Step 4: Construct register proof

The proof is AES-CCM encryption of `remote_info` (20 B) with the following
parameters:

```python
nonce = bytes([16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27])  # 0x10..0x1b
aad   = b"devID"
ct    = AES_CCM(aes_key, nonce, aad, tag_length=4).encrypt(remote_info)
# ct is 24 bytes: 20 bytes of ciphertext + 4 bytes MAC
```

Send `ct` as 24-byte payload (announce type=0x00, 2 frags).

### Step 5: Finalize

```
phone → control: 13 00 00 00
phone ← control: 11 00 00 00       ← ✅ bound
                  (or 12 00 00 00  ← bad proof; restart)
```

Save `token` to disk. Forget the ephemeral `phone_priv`, `aes_key`, etc.

## Login (auth)

Performed once per reconnection, after the scale has previously been bound.

### Step 1: Generate rand_key, send to scale

```python
rand_key = os.urandom(16)
```

Send via data channel with announce type=0x0b.

### Step 2: Receive scale's remote_key and remote_info

```
remote_key  = 16 B random from scale, via announce type=0x0d
remote_info = 32 B HMAC value from scale, via announce type=0x0c (2 frags)
```

### Step 3: Derive session keys

```python
derived = HKDF(
    algorithm = SHA256,
    length    = 64,
    salt      = rand_key + remote_key,           # 32 B salt
    info      = b"mible-login-info",
).derive(token)                                  # token from previous bind
```

Slice:

| Slice  | Name      | Size | Use                                  |
|--------|-----------|------|--------------------------------------|
| [0:16] | dev_key   | 16 B | AES key for **decrypting** scale → phone notifications |
| [16:32]| app_key   | 16 B | AES key for **encrypting** phone → scale commands       |
| [32:36]| dev_iv    | 4 B  | IV prefix for scale → phone direction|
| [36:40]| app_iv    | 4 B  | IV prefix for phone → scale direction|

### Step 4: Verify scale and prove yourself

```python
salt     = rand_key + remote_key
salt_inv = remote_key + rand_key

# Scale's HMAC must match this:
expected = HMAC_SHA256(dev_key, salt_inv)
assert remote_info == expected, "Scale identity verification failed"

# Phone sends its own HMAC:
info = HMAC_SHA256(app_key, salt)
```

Send `info` (32 B) via data channel, announce type=0x0a (2 frags).

### Step 5: Finalize

```
phone ← control: 21 00 00 00       ← ✅ logged in
                  (or 23 00 00 00  ← scale doesn't know this token; need to rebind)
```

Now `dev_key`, `dev_iv` decrypt the weight stream.

## Weight stream decryption

Each notification on UUID 0x0102 is:

```
[idx_le16:2][cipher+tag:N]
```

Where N is variable (depends on payload size); typical values 11 or 14 B.

Decrypt with AES-CCM-128, MAC length 4, using:

```python
nonce = dev_iv + b"\x00\x00\x00\x00" + idx_le2 + b"\x00\x00"   # 12 B total
                # 4 B    + 4 zero bytes + 2 B counter + 2 zero bytes

plaintext = AES_CCM(dev_key, nonce, aad=None, tag_length=4).decrypt(cipher+tag)
```

Each successful decryption yields the M365 UART plaintext frame. See
[PLAINTEXT.md](PLAINTEXT.md) for parsing.

**Duplicate detection:** every frame is sent twice (consecutive idx values
have identical plaintexts). Compare consecutive plaintexts and skip
duplicates if you want unique events.

## Sending commands to the scale (untested)

Encrypted writes to UUID 0x0101 likely use `app_key` and `app_iv`. The
nonce structure mirrors decryption but with iteration counter on the phone
side:

```python
it = phone_iteration_counter  # increments per command
nonce = app_iv + b"\x00\x00\x00\x00" + it.to_bytes(2, "little") + b"\x00\x00"
cipher = AES_CCM(app_key, nonce, aad=None, tag_length=4).encrypt(plaintext)
```

This path is untested with the kitchen scale; the structure is based on the
miauth M365 scooter implementation.

## Worked example with reference vectors

A complete numerical walk-through with one captured session, useful for
validating your implementation byte-for-byte:

```
BIND
====
remote_info (20 B):                  0062 6c74 2e34 2e31 6833 376f 3968 7030 6767 3030
                                     ("\x00blt.4.1h37o9hp0gg00")

phone_priv (P-256 scalar, 32 B):     <ephemeral; generated by client>
phone_pub_xy (64 B):                 <ephemeral; sent to scale>
scale_pub_xy (64 B):                 <ephemeral; received from scale>

shared = ECDH(phone_priv, scale_pub_xy):
                                     <32 B; common to both parties>

derived = HKDF-SHA256(shared, salt=None, info="mible-setup-info", length=64):
  token     [0:12]                   bf a3 62 35 d9 e4 56 af 8d 28 e3 3f
  bind_key  [12:28]                  05 16 51 68 6c e0 09 00 fc f9 46 0a fb 61 9f cc
  aes_key   [28:44]                  26 7a 19 88 d2 ce 05 24 40 13 67 ae 80 08 12 36
  unused    [44:64]                  ...

proof = AES-CCM(aes_key, nonce=0x10..0x1b, aad="devID", tag=4).encrypt(remote_info):
                                     a6 e9 9c a5 da 62 c7 63 13 2a c8 27 69 41 cb 62
                                     a5 4b 0d bb 14 f0 7d b7    (24 B = 20 ct + 4 tag)

(Sent to scale, response: 11 00 00 00 ✅)

LOGIN
=====
rand_key:    15 d5 6e db 3e 97 6b 07 fa 0f cb e9 9c 9f a6 d2
remote_key:  4b 34 bf 47 b5 08 ac 4c 6b 10 26 0b a2 4a 51 1b
remote_info: 3e b1 ff 3a f5 8c 0e a1 87 f6 6f 26 12 ec 36 81
             44 f3 12 6b eb e7 73 79 76 2a 1a f8 d9 b4 00 40

salt = rand_key || remote_key (32 B)

derived = HKDF-SHA256(token, salt=salt, info="mible-login-info", length=64):
  dev_key  [0:16]    b6 7f 32 ea 7d 2e e8 8d ad 04 c5 62 ac 83 30 9b
  app_key  [16:32]   e5 d7 3d 9c 85 ca d1 31 2d 2d 66 d2 95 c4 ad 37
  dev_iv   [32:36]   01 c1 d4 6b
  app_iv   [36:40]   c6 15 b1 2f

Verify: HMAC-SHA256(dev_key, remote_key || rand_key) == remote_info ✓

phone_info = HMAC-SHA256(app_key, rand_key || remote_key):
             b9 9b 5b ac 1e 5f 34 b1 8a 44 62 9d 72 aa 40 a0
             13 be d4 ee 8b 17 84 00 6a d9 54 17 2c 8d b7 66

(Sent to scale, response: 21 00 00 00 ✅)

DECRYPT FIRST FRAME
===================
notify[0x0021] payload:    0001 (idx LE16) | 88 5a 09 b6 99 41 7c 0e 4d ab 31  (11 B encrypted)
nonce = dev_iv + 4*0x00 + 0x0001(LE) + 2*0x00:
                           01 c1 d4 6b 00 00 00 00 01 00 00 00

plaintext = AES-CCM(dev_key, nonce, None, tag=4).decrypt(<11 B>):
                           55 aa 01 02 00 02 fe                  (7 B)

Parse: cmd=0x02 → "idle" status frame (no significant weight)
```

(Frame data redacted in places; full traces in `captures/`.)

## Salt is None, not empty bytes

A subtle but critical point: the bind HKDF uses `salt=None`. In RFC 5869
HKDF, `salt=None` means "use HashLen zero bytes" while `salt=b""` means
"use an empty string". Most libraries normalize these to the same thing,
but some don't. The Python `cryptography` library treats them identically;
verify with your iOS crypto library. If in doubt, pass `salt=bytes(32)`
(32 zero bytes) — this matches the RFC default.

## AES-CCM in CryptoKit (iOS)

`CryptoKit` does not expose AES-CCM. Three options:

1. **CommonCrypto** (recommended for iOS 13+): low-level C API, but
   stable. See SWIFT.md for the wrapper.
2. **Pure Swift implementation**: ~150 lines, manageable. The CCM mode
   is just AES-CBC-MAC + AES-CTR.
3. **Third-party**: `CryptoSwift` package, or SwiftCrypto with BoringSSL.

The reference Python implementation uses `pycryptodomex` because the
standard `cryptography` library's AES-CCM requires plaintext ≥ 4 bytes
(unsuitable for our 7-byte plaintexts in `cipher.decrypt_and_verify`,
which decrypts 7-3=4 byte data... actually fine, but pycryptodomex is
more permissive on min sizes).
