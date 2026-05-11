# Hoto BLE Reverse Engineering — Sesjon 2

## Status

Binding-protokollen er kartlagt og fungerer delvis. Vi klarer å gjennomføre hele utvekslingen,
men den 24-byte "bevis"-pakken vi sender er feil, og scale svarer `12000000` i stedet for `11000000`.

---

## Hva vi vet

### Binding-sekvens (komplett)

```
Phone → Scale  WRITE 0x0010: a2000000          (init)
Scale → Phone  NOTIFY 0x0019: 000000000200     (kunngjør 2 DID-frag)
Phone → Scale  WRITE 0x0019: 00000101          (klar til å motta)
Scale → Phone  NOTIFY 0x0019: 0100 01000000 00 626c742e342e316833376f3968
Scale → Phone  NOTIFY 0x0019: 0200 703067673030
Phone → Scale  WRITE 0x0019: 00000100          (kvittert)
Phone → Scale  WRITE 0x0010: 15000000

Phone → Scale  WRITE 0x0019: 000000030400      (kunngjør 4 frags, 64-byte payload)
Scale → Phone  NOTIFY 0x0019: 00000101         (klar)
Phone → Scale  WRITE 0x0019: 0100 [18 bytes]
Phone → Scale  WRITE 0x0019: 0200 [18 bytes]
Phone → Scale  WRITE 0x0019: 0300 [18 bytes]
Phone → Scale  WRITE 0x0019: 0400 [10 bytes]
Scale → Phone  NOTIFY 0x0019: 00000100         (kvittert)

Scale → Phone  NOTIFY 0x0019: 000000030400     (scale kunngjør 4 frags svar)
Phone → Scale  WRITE 0x0019: 00000101          (klar)
Scale → Phone  NOTIFY 0x0019: 0100 [18 bytes]
Scale → Phone  NOTIFY 0x0019: 0200 [18 bytes]
Scale → Phone  NOTIFY 0x0019: 0300 [18 bytes]
Scale → Phone  NOTIFY 0x0019: 0400 [10 bytes]
Phone → Scale  WRITE 0x0019: 00000100          (kvittert)

Phone → Scale  WRITE 0x0019: 000000000200      (kunngjør 24-byte second payload)
Scale → Phone  NOTIFY 0x0019: 00000101         (klar)
Phone → Scale  WRITE 0x0019: 0100 [18 bytes]
Phone → Scale  WRITE 0x0019: 0200 [6 bytes]
Scale → Phone  NOTIFY 0x0019: 00000100         (kvittert)

Phone → Scale  WRITE 0x0010: 13000000          (finaliser)
Scale → Phone  NOTIFY 0x0010: 11000000         ✓ BINDING SUKSESS
                          (eller: 12000000)     ✗ Feil 24-byte bevis
```

### DID

Skalaen sender DID: `blt.4.1h37o9hp0gg00`  
Format: `blt.4.[device_identifier]` — standard Xiaomi device ID.

### Fragmentprotokoll

- Annonsering: `[00 00 00 type][n_frags LE16]`
  - `type=0x03` for phone→scale payload
  - `type=0x00` for second payload
- Fragmenter: `[idx LE16][data]` der idx starter på 1
- Scale signaliserer klar: `00000101`, ACK ferdig: `00000100`
- Chunk-størrelse: 18 bytes per fragment

### Resultatkoder på 0x0010

| Kode       | Betydning                        |
|------------|----------------------------------|
| `11000000` | Binding suksess                  |
| `12000000` | Feil 24-byte bevis               |
| `21000000` | Auth suksess (etter binding)     |
| `23000000` | Ukjent nøkkel (ikke bundet)      |

---

## Nøkkelfunn fra testing

### Payload-test 1: Hel iOS-payload → Scale svarer ✓

```
iOS payload (64 bytes):
  [0:32]  1cef4a3aa5f6f5ec9a7de5f26c5c33d1c110e2f84d0cb880c9b5be726ddb6c6c
  [32:64] 51640a5ac3ea2309a7f898d6d7254dac6a8958b100bd7a1d39368ab15d6616d9

Resultat: Scale svarer med 64-byte respons (ephemeral, ny hvert forsøk)
24-byte zeros → 12000000 (protokollen virker, men beviset er feil)
```

Scale sender 64-byte respons (eksempel fra to sesjoner — bekrefter ephemeral):
```
Sesjon A: edbfb6aa919df6883bdf4c31...b16596efd3e15cd52984
Sesjon B: 91c8070bdc44aa01eb498034...e97119e877c050ebb235
```

### Payload-test 2: Vår pubkey + zeros → Scale svarer IKKE

```
Vår pubkey: 7ab8e55e8f7f1f6c381e1a5e7e19ff7231e2c939afb4b78fafdfbd0cc9079a17
Payload: [vår pubkey][zeros(32)]
Resultat: Scale ignorerer fullstendig (ingen respons)
```

### Payload-test 3: Vår pubkey + iOS andre halvdel → Scale svarer IKKE

```
Payload: [vår pubkey][51640a5a...16d9]
Resultat: Scale ignorerer fullstendig
```

**Konklusjon: Den andre halvdelen (byte 32–63) er kryptografisk bundet til den første (byte 0–31).
Scale validerer hele 64-byte payload som en enhet.**

### Payload-test 4: Vår pubkey + ephemeral pubkey → Scale svarer IKKE

```
Payload: [vår pubkey][generert ephemeral pubkey]
Resultat: Scale ignorerer fullstendig
```

---

## Hypotese: ECDH-autentisert nøkkelutveksling

Den mest sannsynlige forklaringen basert på testresultatene:

```
Phone 64-byte payload:
  [0:32]  = Phone X25519 persistent pubkey
  [32:64] = ECDH(phone_priv, scale_static_pub)

Scale verifiserer:
  Compute ECDH(scale_priv, payload[0:32])
  Sjekk om == payload[32:64]
  Hvis ja → send scale's ephemeral pubkey som 64-byte svar

24-byte bevis (second payload):
  = KDF(ECDH(phone_priv, scale_ephemeral_pub))
  trolig SHA256(shared_secret)[:24]
```

Dvs. scale har et **statisk nøkkelpar**. Telefonen må bevise at den kjenner den private nøkkelen
sin ved å sende ECDH med scale's statiske pubkey som andre halvdel av payloaden.

**Manglende brikke: Scale's statiske public key.**

---

## Neste steg — prioritert rekkefølge

### 1. Hent scale's statiske pubkey fra advertisement

Scale advertiser med Xiaomi service UUID `0000fe95-0000-1000-8000-00805f9b34fb`.
Xiaomi BLE advertisement-data inneholder ofte enhetsinfo og nøkler.

```python
# Legg til i scanner-callbacken:
for k, v in (adv.service_data or {}).items():
    print(f"  [{k}] ({len(v)} bytes): {v.hex()}")
```

Parse dataen mot Xiaomi MiBeacon-formatet:
- Byte 0–1: Frame control
- Byte 2–3: Device type
- Byte 4: Frame counter
- Byte 5–10: MAC (reversed)
- Deretter: capability byte + evt. object data (TLV)

I provisioning-modus sender noen Xiaomi-enheter sin temporære pubkey i advertisementen.

### 2. Sjekk DID-fragmented for skjult data

Fragment 1 av DID har et 6-byte prefix: `01 00 00 00 00 00` — kan dette inneholde nøkkelinfo?

### 3. Les GATT-karakteristikker direkte

Kanskje scale eksponerer sin statiske pubkey via en GATT-karakteristikk.
Les alle karakteristikker på service `0000fe95-...` og andre services.

```python
for svc in client.services:
    for char in svc.characteristics:
        if "read" in char.properties:
            val = await client.read_gatt_char(char.uuid)
            print(f"  {char.uuid}: {val.hex()}")
```

### 4. Sjekk python-miio / MiBeacon-dokumentasjon

Prosjekter som har reverse-engineered Xiaomi BLE:
- https://github.com/custom-components/ble_monitor
- https://github.com/drndos/miflora (og lignende)
- python-miio: `miio.protocol` (bruker `miio_token`, kan gi innsikt i auth-mekanisme)

Søk spesifikt etter: `MiBeacon v5`, `Xiaomi BLE binding`, `fe95 provisioning`

### 5. Forsøk: Hent Xiaomi-token via Hoto-appen + Charles Proxy

Sett opp Charles Proxy på iPhone mens Hoto-appen binder vekta:
- Fang evt. cloud-kall som returnerer en token
- Se om token dukker opp som del av binding-payloaden

### 6. MITM BLE-sniffing

Bruk en Raspberry Pi eller annen BLE-enhet som MITM mellom iOS og scale:
- Capture den faktiske iOS-payloaden hex
- Vi har allerede iOS-payloaden fra sysdiagnose: `1cef4a3a...16d9`
- Men vi trenger den tilhørende iOS-privatnøkkelen for å forstå derivasjonen

### 7. Forsøk: Bruk iOS-payloaden direkte (static replay)

Siden iOS-payloaden fungerer, kan vi prøve å fullføre binding ved å:
1. Sende den kjente iOS-payloaden
2. Motta scale's ephemeral respons
3. Beregne `SHA256(ECDH(iOS_priv_key, scale_resp[:32]))[:24]` som bevis

**Problemet**: Vi har ikke iOS' private nøkkel.

Men — hvis vi kan finne iOS' private nøkkel i Keychain eller i sysdiagnose-filene,
kan vi fullføre én binding (med iOS' nøkkel), og deretter prøve re-bind med vår nøkkel.

---

## Våre nøkler

```json
{
  "private_key": "089e30fe65c088cffb136969b9303717f89687e0628846ee5e5b03537018ce78",
  "public_key": "7ab8e55e8f7f1f6c381e1a5e7e19ff7231e2c939afb4b78fafdfbd0cc9079a17"
}
```

Lagret i: `hoto_ble/persistent_key.json`

---

## Filer

| Fil | Beskrivelse |
|-----|-------------|
| `ble_bind.py` | Binding-script med multiple payload-varianter |
| `ble_diag.py` | Diagnostikk: send payload, logg alt |
| `ble_auth2.py` | Auth etter binding (25000000-sekvens) |
| `persistent_key.json` | Vår X25519-nøkkel |

---

## Rask reprise for neste sesjon

Scale er i bindbar tilstand og responderer på `a2000000`. Protokollen er fullt implementert.
Problemet er at vi ikke klarer å generere korrekt 64-byte phone payload.
Mest sannsynlig trenger vi scale's statiske X25519 public key for å gjøre ECDH som andre halvdel.
Start med å printe Xiaomi service data fra advertisementen og lese alle GATT-karakteristikker.
