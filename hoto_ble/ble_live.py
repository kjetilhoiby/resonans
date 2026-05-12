#!/usr/bin/env python3
"""
Live-fanger alle MiBeacon-pakker fra Hoto-vekta og dekoder endringer.
Kjør: python3 ble_live.py
Legg ulike ting på vekta mens dette kjører – se dataen endre seg!
"""
import asyncio
import struct
from bleak import BleakScanner

TARGET_NAME = "HOTO"


async def find_target():
    results = await BleakScanner.discover(timeout=8, return_adv=True)
    for addr, (d, adv) in results.items():
        name = d.name or adv.local_name or ""
        if TARGET_NAME.lower() in name.lower():
            return addr
    return None


def decode_mibeacon(data: bytes) -> str:
    if len(data) < 5:
        return f"for kort ({len(data)} bytes): {data.hex()}"

    frame_ctrl = struct.unpack_from("<H", data, 0)[0]
    dev_type   = struct.unpack_from("<H", data, 2)[0]
    counter    = data[4]
    offset     = 5

    parts = [f"type=0x{dev_type:04x} cnt={counter}"]

    has_mac  = bool(frame_ctrl & 0x4000)
    has_cap  = bool(frame_ctrl & 0x0020)
    has_obj  = bool(frame_ctrl & 0x0040)
    encrypted = bool(frame_ctrl & 0x0001)

    if encrypted:
        parts.append("[kryptert]")

    if has_mac and offset + 6 <= len(data):
        mac = data[offset:offset+6]
        mac_str = ":".join(f"{b:02x}" for b in reversed(mac))
        parts.append(f"mac={mac_str}")
        offset += 6

    if has_cap and offset < len(data):
        parts.append(f"cap=0x{data[offset]:02x}")
        offset += 1

    if has_obj and offset + 3 <= len(data):
        obj_type = struct.unpack_from("<H", data, offset)[0]
        obj_len  = data[offset + 2]
        obj_val  = data[offset + 3: offset + 3 + obj_len]
        parts.append(f"obj=0x{obj_type:04x} len={obj_len} val={obj_val.hex()} raw={list(obj_val)}")
        # Tolkning av vanlige Xiaomi-objekttyper
        if obj_type == 0x1004 and obj_len == 2:
            weight_raw = struct.unpack_from("<H", obj_val)[0]
            parts.append(f"→ VEKT={weight_raw/100:.2f} kg? (eller {weight_raw} g?)")
        elif obj_type == 0x100D and obj_len == 2:
            weight_raw = struct.unpack_from("<H", obj_val)[0]
            parts.append(f"→ VEKT(jin)={weight_raw/200:.3f} kg?")
        elif obj_type == 0x1006 and obj_len == 2:
            weight_raw = struct.unpack_from("<H", obj_val)[0]
            parts.append(f"→ VEKT={weight_raw/100:.2f} kg?")
    else:
        # Vis resten av bytes uansett
        rest = data[offset:]
        if rest:
            parts.append(f"rest={rest.hex()} raw={list(rest)}")

    return "  " + " | ".join(parts)


def decode_manufacturer(company_id: int, data: bytes) -> str:
    return f"  mfr[{company_id:#06x}]: {data.hex()}  raw={list(data)}"


async def main():
    print("=== HOTO LIVE MONITOR ===")
    target = await find_target()
    if not target:
        print("Vekta ikke funnet – slå den på og prøv igjen.")
        return
    TARGET = target
    print(f"Mål: {TARGET}")
    print("Legg noe på vekta – du vil se pakker dukke opp!\n")
    print("Trykk Ctrl+C for å stoppe.\n")

    last_hex = None
    count = 0

    def callback(device, adv):
        nonlocal last_hex, count

        if device.address.upper() != target.upper():
            return

        count += 1
        lines = []

        if adv.service_data:
            for uuid, data in adv.service_data.items():
                current_hex = data.hex()
                changed = "  [ENDRET!]" if last_hex and current_hex != last_hex else ""
                last_hex_ref = last_hex
                lines.append(f"ServiceData [{uuid}]: {current_hex}{changed}")
                lines.append(decode_mibeacon(data))
                if last_hex_ref and current_hex != last_hex_ref:
                    # Vis hva som endret seg
                    for i, (a, b) in enumerate(zip(bytes.fromhex(last_hex_ref), data)):
                        if a != b:
                            lines.append(f"  Byte {i}: {a:#04x} → {b:#04x} (diff={b-a})")

        if adv.manufacturer_data:
            for cid, data in adv.manufacturer_data.items():
                lines.append(decode_manufacturer(cid, data))

        if lines:
            import datetime
            ts = datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]
            print(f"[{ts}] rssi={adv.rssi}")
            for l in lines:
                print(l)
            print()

        # Oppdater referanse
        if adv.service_data:
            for uuid, data in adv.service_data.items():
                last_hex = data.hex()

    async with BleakScanner(detection_callback=callback):
        try:
            await asyncio.sleep(120)
        except KeyboardInterrupt:
            pass

    print(f"\nFerdig – fanget {count} pakker totalt.")


if __name__ == "__main__":
    asyncio.run(main())
