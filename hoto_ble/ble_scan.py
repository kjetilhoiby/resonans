#!/usr/bin/env python3
"""
Skanner etter Hoto-vekta og dumper alle GATT-tjenester og karakteristikker.
Kjør: python3 ble_scan.py
"""
import asyncio
from bleak import BleakScanner, BleakClient

TARGET_NAME_KEYWORDS = ["hoto", "kitchen", "scale", "food"]

async def scan():
    print("Skanner etter BLE-enheter i 10 sekunder...\n")
    results = await BleakScanner.discover(timeout=10, return_adv=True)

    print(f"Fant {len(results)} enheter:\n")
    matches = []
    for address, (d, adv) in sorted(results.items(), key=lambda x: x[1][1].rssi or -999, reverse=True):
        name = d.name or adv.local_name or "(ingen navn)"
        rssi = adv.rssi or 0
        print(f"  [{rssi:4d} dBm]  {address}  {name}")
        if any(k in name.lower() for k in TARGET_NAME_KEYWORDS):
            matches.append(d)

    if matches:
        print(f"\nMulige Hoto-enheter:")
        for d in matches:
            print(f"  --> {d.address}  {d.name}")
    else:
        print("\nIngen åpenbar Hoto-enhet funnet – sjekk listen over manuelt.")

    return matches


async def explore(address: str):
    print(f"\nKobler til {address}...")
    async with BleakClient(address) as client:
        print(f"Tilkoblet: {client.is_connected}\n")
        print("=" * 60)
        print("GATT-tjenester og karakteristikker:")
        print("=" * 60)

        for service in client.services:
            print(f"\nService: {service.uuid}")
            print(f"  Beskrivelse: {service.description}")
            for char in service.characteristics:
                props = ", ".join(char.properties)
                print(f"  Char: {char.uuid}  [{props}]")
                print(f"    Beskrivelse: {char.description}")
                if "read" in char.properties:
                    try:
                        val = await client.read_gatt_char(char.uuid)
                        print(f"    Verdi (hex): {val.hex()}")
                        print(f"    Verdi (raw): {list(val)}")
                    except Exception as e:
                        print(f"    Lesefeil: {e}")

        print("\n" + "=" * 60)
        print("Abonnerer på notify-karakteristikker i 15 sekunder...")
        print("Legg noe på vekta nå!\n")

        notified = []

        def handle_notify(sender, data):
            print(f"NOTIFY [{sender}]: hex={data.hex()}  raw={list(data)}")
            notified.append((sender, data))

        for service in client.services:
            for char in service.characteristics:
                if "notify" in char.properties or "indicate" in char.properties:
                    await client.start_notify(char.uuid, handle_notify)
                    print(f"Lytter på {char.uuid}")

        await asyncio.sleep(15)
        print(f"\nFikk {len(notified)} notify-meldinger.")


async def main():
    matches = await scan()

    if not matches:
        addr = input("\nLim inn MAC/UUID til enheten manuelt (eller Enter for å avslutte): ").strip()
        if not addr:
            return
    elif len(matches) == 1:
        addr = matches[0].address
    else:
        addr = input(f"\nFlere treff – lim inn adressen du vil utforske: ").strip()

    await explore(addr)


if __name__ == "__main__":
    asyncio.run(main())
