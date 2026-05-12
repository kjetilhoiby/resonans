# iOS-binding payloads (vellykket session 2026-05-11 19:15:08)

Conn handle 0x005B mellom iPhone14,2 (`F4:BE:EC:F0:D2:87`) og Hoto-vekt (`DC:ED:83:84:2E:9D`).
Vekt-navn: `HOTO-dced83842e9d` (advertisement), `stand demo` (GATT Device Name char).
MTU: forhandlet 247 bytes (iOS ba om 527).

## GATT-handle-mapping (fra Read By Type Response)

| ATT handle | Char UUID (short) | Egenskaper | Rolle               |
|-----------:|------------------:|-----------:|---------------------|
| 0x0010     | 0x0004            | read       | Firmware version    |
| 0x0012     | 0x0010            | notify+wnr | **Control channel** |
| 0x0013     | (CCCD for 0x0012) | write      | Notify-toggle 0x0010 |
| 0x0015     | 0x0019            | notify+wnr | **Data channel**    |
| 0x0016     | (CCCD for 0x0015) | write      | Notify-toggle 0x0019 |
| 0x0018     | 0x0017            | notify+w   | (ubrukt av iOS)     |
| 0x001B     | 0x0018            | notify+wnr | (ubrukt av iOS)     |

Konklusjon: char 0x0017 brukes ikke av appen i det hele tatt. Vi skal heller ikke bruke den.

## Komplett sekvens

```
# 1. Setup
→ 0x0013 (CCCD 0x0010): 0100              # enable notify på control
→ 0x0016 (CCCD 0x0019): 0100              # enable notify på data
→ 0x0012 (0x0010): A2000000               # init binding

# 2. DID-utveksling (scale → phone, 19 bytes payload)
← 0x0015 (0x0019): 00 00 00 00 02 00      # announce: type=0x00, 2 frags
→ 0x0015: 00 00 01 01                     # ready
← 0x0015: 0100 [01 00 00 00 00 00] 62 6c 74 2e 34 2e 31 68 33 37 6f 39 68
← 0x0015: 0200 70 30 67 67 30 30
→ 0x0015: 00 00 01 00                     # ack

# Frag 1 har et 6-byte prefix [01 00 00 00 00 00] før selve ASCII-strengen
# Strengen = "blt.4.1h37o9hp0gg00" = DID ✓

# 3. Phone signaliserer "klar for fase 2"
→ 0x0012 (0x0010): 15000000

# 4. Phone sender 64-byte first payload (type=0x03)
→ 0x0015: 00 00 00 03 04 00               # announce: type=0x03, 4 frags
← 0x0015: 00 00 01 01                     # scale ready
→ 0x0015: 0100 9714 56b2 5e94 0f1e 43c7 54ec 6683 e75b 88fe
→ 0x0015: 0200 499a 5eb9 d1c5 bf61 db8f 94ff 6568 7d38 f499
→ 0x0015: 0300 0ad7 6710 abb2 dd04 8b87 3000 dce0 68a0 75d3
→ 0x0015: 0400 ca13 798b ebce 48d9 c1ea
← 0x0015: 00 00 01 00                     # scale ack

# Phone first payload (64 bytes), konkatenert:
#   971456b25e940f1e43c754ec6683e75b88fe   (18B frag 1, fra idx 0x0001)
#   499a5eb9d1c5bf61db8f94ff65687d38f499   (18B frag 2)
#   0ad76710abb2dd048b873000dce068a075d3   (18B frag 3)
#   ca13798bebce48d9c1ea                   (10B frag 4)
#
# Hel: 971456b25e940f1e43c754ec6683e75b88fe499a5eb9d1c5bf61db8f94ff65687d38f4990ad76710abb2dd048b873000dce068a075d3ca13798bebce48d9c1ea

# 5. Scale svarer med 64-byte response (type=0x03)
← 0x0015: 00 00 00 03 04 00               # scale announce: type=0x03, 4 frags
→ 0x0015: 00 00 01 01                     # phone ready
← 0x0015: 0100 2d99 f6c4 94b6 4cc6 5fcb f761 33c1 7b3c 91d2
← 0x0015: 0200 a899 985b 2b93 89a7 947d fcf9 0280 9d56 1ce5
← 0x0015: 0300 cdbc df94 65ce da7b ba4f 1d62 ae09 81e7 1929
← 0x0015: 0400 064a 6ae5 e3f7 12d9 a81f
→ 0x0015: 00 00 01 00                     # phone ack

# Scale response (64 bytes):
#   2d99f6c494b64cc65fcbf76133c17b3c91d2a899985b2b9389a7947dfcf902809d561ce5cdbcdf9465ceda7bba4f1d62ae0981e71929064a6ae5e3f712d9a81f

# 6. Phone re-skriver CCCDs (uklart hvorfor — kanskje for å holde notify aktiv)
→ 0x0016: 0100                            # CCCD 0x0019 re-enable
→ 0x0013: 0100                            # CCCD 0x0010 re-enable

# 7. Phone sender 24-byte "proof" (type=0x00)
→ 0x0015: 00 00 00 00 02 00               # announce: type=0x00, 2 frags
← 0x0015: 00 00 01 01                     # scale ready
→ 0x0015: 0100 eda3 3bfe f90e a86f fc09 1d65 f47e e9fb 9c99
→ 0x0015: 0200 7445 6933 2d19
← 0x0015: 00 00 01 00                     # scale ack

# 24-byte proof:
#   eda33bfef90ea86ffc091d65f47ee9fb9c99744569332d19

# 8. Finalize → success
→ 0x0012 (0x0010): 13000000
← 0x0012:           11000000              # ✅ BINDING SUCCESS

# 9. Phone leser firmware-string (cosmetic)
→ Read 0x0010 → "1.1.3_0010"
```

## Sammenligning med tidligere iOS-fanget payload

| Felt                    | Sesjon A (gammel)                                                  | Sesjon B (ny, 2026-05-11)                                          |
|-------------------------|---------------------------------------------------------------------|---------------------------------------------------------------------|
| Phone payload byte 0-31 | `1cef4a3aa5f6f5ec9a7de5f26c5c33d1c110e2f84d0cb880c9b5be726ddb6c6c`  | `971456b25e940f1e43c754ec6683e75b88fe499a5eb9d1c5bf61db8f94ff6568` |
| Phone payload byte 32-63| `51640a5ac3ea2309a7f898d6d7254dac6a8958b100bd7a1d39368ab15d6616d9`  | `7d38f4990ad76710abb2dd048b873000dce068a075d3ca13798bebce48d9c1ea` |
| Scale response          | (varierte mellom A og A')                                           | `2d99...a81f`                                                       |
| 24-byte proof           | ukjent                                                              | `eda33bfef90ea86ffc091d65f47ee9fb9c99744569332d19`                  |

**Begge halvdeler av phone payload er ephemeral.** Det stenger ut den enkleste hypotesen
om at byte 32-63 = ECDH(phone_priv_static, scale_pub_static). Hvis så hadde minst byte
32-63 vært stabil mellom sesjoner for samme telefon.

## Hypoteser å teste videre

1. **Begge halvdeler ephemeral → vanlig ephemeral X25519 + signatur/MAC:**
   - byte 0-31 = phone ephemeral X25519 pubkey
   - byte 32-63 = HMAC eller AES-GCM-tag av byte 0-31, nøkkel = noe avledet av DID + en delt hemmelighet
   - 24-byte proof = AES-GCM-tag (12B nonce + 12B tag? eller 24B tag?) av en KDF over shared secret + transcript

2. **Hele 64-byte = AES-GCM-encrypt(plaintext_pubkey, key=KDF(scale_static_pub, DID))**:
   - byte 0-15 = ciphertext av delvis pubkey
   - byte 16-47 = ciphertext av resten
   - byte 48-63 = GCM-tag
   - Krever at vi kjenner scale_static_pub eller en factory-key

3. **MiBeacon v5 ECC-protokoll** (auth_mode=2):
   - Konkrete steg dokumentert i `passive_ble_monitor` og `python-miio`
   - Trolig: phone_pub + AES-CCM-tag(phone_pub, key=K_factory)
   - K_factory kan være avledet av PIN-kode trykket på vekta, eller QR-kode

## Neste steg

1. **Sjekk om vekta har et PIN på baksiden** — Xiaomi/MiBeacon v5 bruker ofte
   et 6-sifret PIN trykket på enheten som inngang til KDF. Den kalles "bind key"
   eller "pairing pin".

2. **Slå opp full MiBeacon v5 binding-spec** i `passive_ble_monitor` repo —
   søk på `auth_mode == 2`, `MISERVICE_AUTH`, eller `BinaryAuth`.

3. **Forsøk å erstatte iOS-payloaden direkte** for å bekrefte at den ikke er
   bundet til iPhone-MAC eller iPhone-id (replay). Hvis scale godtar (svarer
   med en 64-byte respons), kan vi gjøre flere captures og kanskje finne ut
   om phone_pub er en kjent funksjon av en faktor vi kontrollerer.

4. **Capture en til binding-sesjon** for å bekrefte at både byte 0-31 og byte
   32-63 endrer seg hver gang, og at scale-response varierer.
