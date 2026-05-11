#!/usr/bin/env python3
"""
Systematisk sonderer Hoto-vekta med ulike GATT-kommandoer.
Lytt på alle chars og send kommandoer til begge skrivbare karakteristikker.
Legg noe på vekta mens dette kjører!
"""
import asyncio
from bleak import BleakClient, BleakScanner

XIAOMI_SVC = "0000fe95-0000-1000-8000-00805f9b34fb"


async def find_device():
    print("Skanner etter HOTO-vekta (via Xiaomi fe95-tjeneste)...")
    results = await BleakScanner.discover(timeout=10, return_adv=True)
    for addr, (d, adv) in results.items():
        name = d.name or adv.local_name or "(ingen navn)"
        has_fe95 = XIAOMI_SVC in (adv.service_data or {}) or XIAOMI_SVC in (adv.service_uuids or [])
        if has_fe95 or "hoto" in name.lower():
            print(f"Fant: {addr}  ({name})\n")
            return addr
    return None

# fe95-service
W_FE95_INIT  = "00000017-0000-1000-8000-00805f9b34fb"   # notify + write
W_FE95_DATA  = "00000010-0000-1000-8000-00805f9b34fb"   # notify + write-without-response
W_FE95_EVT   = "00000018-0000-1000-8000-00805f9b34fb"   # notify + write-without-response
W_FE95_AVDTP = "00000019-0000-1000-8000-00805f9b34fb"   # notify + write-without-response

# mible-service
W_CMD = "00000101-0065-6c62-2e74-6f696d2e696d"  # write-without-response
N_RSP = "00000102-0065-6c62-2e74-6f696d2e696d"  # notify

CMDS = [
    # Vanlige Xiaomi/Mi-protokoll forsøk
    ("query_weight",    bytes([0x01])),
    ("query_weight_2",  bytes([0x01, 0x00])),
    ("query_weight_3",  bytes([0xAA, 0x01])),
    ("query_weight_4",  bytes([0x55, 0xAA, 0x01])),
    ("mi_init",         bytes([0xA2, 0x01, 0x00])),
    ("mi_init2",        bytes([0xA0, 0x01, 0x00])),
    ("tare",            bytes([0x02])),
    ("tare_2",          bytes([0x02, 0x00])),
    ("set_gram",        bytes([0x03, 0x00])),
    ("set_oz",          bytes([0x03, 0x01])),
    # Hoto-spesifikke forsøk (ukjente – bruteforce lystig)
    ("hoto_01",         bytes([0x01, 0x01, 0x00, 0x00])),
    ("hoto_02",         bytes([0x00, 0x00, 0x00, 0x00])),
    ("hoto_03",         bytes([0xFF, 0x01, 0x00, 0x00])),
    ("mible_query",     bytes([0x00, 0x01, 0x00])),
    ("mible_read",      bytes([0x00, 0x02, 0x00])),
]


async def main():
    target = await find_device()
    if not target:
        print("Vekta ikke funnet – slå den på og prøv igjen.")
        return

    print(f"Kobler til {target}...\n")
    responses = []

    async with BleakClient(target, pair_before_connect=True) as client:
        print("Tilkoblet!\n")
        print("Prøver pairing...")
        try:
            paired = await client.pair()
            print(f"Pairing: {paired}\n")
        except Exception as e:
            print(f"Pairing-feil (OK å ignorere på macOS): {e}\n")

        def handler(sender, data):
            import datetime
            ts = datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]
            msg = f"[{ts}] NOTIFY [{sender}]: hex={data.hex()}  raw={list(data)}"
            print(msg)
            responses.append((str(sender), data))

        # Abonner på alt
        for uuid in [W_FE95_INIT, W_FE95_DATA, W_FE95_EVT, W_FE95_AVDTP, N_RSP]:
            try:
                await client.start_notify(uuid, handler)
                print(f"Lytter: {uuid}")
            except Exception as e:
                print(f"Feil: {uuid}: {e}")

        print("\nLegg noe på vekta nå og hold den der!\n")
        await asyncio.sleep(3)

        # Send alle kommandoer til begge kanaler
        for name, cmd in CMDS:
            for w_uuid, label in [
                (W_FE95_INIT,  "fe95:0017"),
                (W_FE95_DATA,  "fe95:0010"),
                (W_CMD,        "mible:0101"),
            ]:
                before = len(responses)
                try:
                    await client.write_gatt_char(w_uuid, cmd)
                    await asyncio.sleep(0.4)
                    got = len(responses) - before
                    status = f"SVAR: {got}" if got > 0 else "stille"
                    print(f"  {name:20s} → {label}: {cmd.hex():20s} [{status}]")
                except Exception as e:
                    print(f"  {name:20s} → {label}: FEIL: {e}")

        print("\nVenter 5 sekunder til...\n")
        await asyncio.sleep(5)

    print(f"\n=== Oppsummering ===")
    print(f"Totalt {len(responses)} notify-meldinger mottatt.")
    for sender, data in responses:
        print(f"  [{sender.split('-')[0]}]: {data.hex()}  raw={list(data)}")


if __name__ == "__main__":
    asyncio.run(main())
