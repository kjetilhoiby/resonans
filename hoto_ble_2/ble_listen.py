#!/usr/bin/env python3
"""
Passively listen for Hoto BLE advertisements and try to decode weight
using the bind_key from our successful bind handshake.

Hypothesis: after binding, the scale broadcasts weight in MiBeacon v4/v5
encrypted advertisement frames. Our bind_key (16 B AES-128) is exactly
the right format for AES-CCM decryption of such frames.

Reference: xiaomi-ble parser._decrypt_mibeacon_v4_v5:
    nonce = mac[::-1] + service_data[2:5] + service_data[-7:-4]
    aad   = b"\x11"
    plain = AESCCM(bindkey, tag=4).decrypt(nonce, cipher+mic, aad)
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

from bleak import BleakScanner
from Cryptodome.Cipher import AES

FE95 = "0000fe95-0000-1000-8000-00805f9b34fb"
KEYS = Path(__file__).parent / "mi_keys.json"
SCALE_MAC = bytes.fromhex("dced83842e9d")  # DC:ED:83:84:2E:9D

keys = json.loads(KEYS.read_text())
BIND_KEY = bytes.fromhex(keys["bind_key_hex"])

# Try also the Mi Cloud beaconkey as a comparison
CLOUD_BEACONKEY = bytes.fromhex("8094bbd44bf1a5b9d400e147b2c5e221")


def parse_frctrl(b: bytes) -> dict:
    """Parse MiBeacon Frame Control."""
    if len(b) < 2:
        return {}
    v = int.from_bytes(b, "little")
    return {
        "raw": f"0x{v:04x}",
        "mesh":           bool(v & 0x0080),
        "registered":     bool(v & 0x0002),
        "solicited":      bool(v & 0x0004),
        "auth_mode":      (v >> 12) & 0x3,
        "is_encrypted":   bool(v & 0x0008),
        "has_mac":        bool(v & 0x0010),
        "has_capability": bool(v & 0x0020),
        "has_object":     bool(v & 0x0040),
        "version":        (v >> 12) & 0xF,
    }


def try_decrypt(sd: bytes, key: bytes, key_name: str) -> dict | None:
    """Try MiBeacon v4/v5 decrypt with given key."""
    if len(sd) < 7:
        return None
    fc = parse_frctrl(sd[0:2])
    if not fc["is_encrypted"]:
        return None
    pos = 5
    if fc["has_mac"]:
        pos += 6
    if fc["has_capability"]:
        pos += 1
    body = sd[pos:]
    if len(body) < 7:
        return None

    cipher = body[:-7]
    ext = body[-7:-4]
    mic = body[-4:]

    nonce = SCALE_MAC[::-1] + sd[2:5] + ext
    aad = b"\x11"
    try:
        c = AES.new(key, AES.MODE_CCM, nonce=nonce, mac_len=4)
        c.update(aad)
        plain = c.decrypt_and_verify(cipher, mic)
        return {
            "key": key_name,
            "plain_hex": plain.hex(),
            "plain": plain,
        }
    except Exception as e:
        return {"key": key_name, "err": str(e)}


def parse_mi_object(plain: bytes) -> list[dict]:
    """Parse Mi object TLV: [obj_id LE16][len 1B][data]."""
    out = []
    pos = 0
    while pos + 3 <= len(plain):
        obj_id = int.from_bytes(plain[pos : pos + 2], "little")
        n = plain[pos + 2]
        data = plain[pos + 3 : pos + 3 + n]
        out.append({"obj_id": f"0x{obj_id:04x}", "len": n, "data_hex": data.hex(),
                    "value_int_le": int.from_bytes(data, "little") if data else None})
        pos += 3 + n
    return out


def decode(sd: bytes) -> dict:
    info = {"raw": sd.hex(), "len": len(sd)}
    if len(sd) < 5:
        return info
    fc = parse_frctrl(sd[0:2])
    info["frctrl"] = fc
    info["device_type"] = sd[2:4].hex()
    info["frame_counter"] = sd[4]
    pos = 5
    if fc["has_mac"] and pos + 6 <= len(sd):
        info["mac_le"] = sd[pos : pos + 6].hex()
        pos += 6
    if fc["has_capability"] and pos + 1 <= len(sd):
        info["capability"] = f"0x{sd[pos]:02x}"
        pos += 1
    body = sd[pos:]
    info["body_hex"] = body.hex()

    if fc["is_encrypted"]:
        # try both keys
        info["decrypt_bind"] = try_decrypt(sd, BIND_KEY, "bind_key")
        info["decrypt_cloud"] = try_decrypt(sd, CLOUD_BEACONKEY, "cloud_beaconkey")
        for d in (info["decrypt_bind"], info["decrypt_cloud"]):
            if d and "plain" in d:
                info["objects"] = parse_mi_object(d["plain"])
                info["matched_key"] = d["key"]
                break
    elif body and fc["has_object"]:
        info["objects"] = parse_mi_object(body)

    return info


seen: dict[bytes, int] = {}


def cb(device, adv):
    sd = (adv.service_data or {}).get(FE95)
    if not sd:
        return
    name = (device.name or "")
    if "HOTO" not in name.upper() and "demo" not in name.lower():
        return
    seen[sd] = seen.get(sd, 0) + 1
    if seen[sd] > 1:
        return  # only print unique frames
    info = decode(sd)
    print(f"\n[{device.address} '{name}' RSSI={adv.rssi}]")
    for k, v in info.items():
        print(f"  {k}: {v}")


async def main():
    print(f"bind_key:           {BIND_KEY.hex()}")
    print(f"cloud_beaconkey:    {CLOUD_BEACONKEY.hex()}")
    print(f"scale MAC:          {SCALE_MAC.hex()}")
    print(
        "\nScanning 60 seconds — press scale button, put something on it, take it off, etc."
    )
    print("Watching for fe95 ADVs from Hoto. Unique frames only.\n")
    scanner = BleakScanner(detection_callback=cb)
    await scanner.start()
    await asyncio.sleep(60)
    await scanner.stop()
    print(f"\nSaw {sum(seen.values())} frames ({len(seen)} unique).")


if __name__ == "__main__":
    asyncio.run(main())
