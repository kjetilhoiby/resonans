#!/usr/bin/env python3
"""One-time bind for Hoto kitchen scale.

After running this once, mi_token.bin is saved. From then on use read.py
to stream weight.
"""
import asyncio
import sys

from protocol import find_scale, bind, DEFAULT_TOKEN_PATH


async def main() -> int:
    print("Scanning for Hoto scale (press scale button if not already on)...")
    addr = await find_scale(timeout_total=60.0)
    if not addr:
        print("Not found. Make sure the scale is powered on and try again.")
        return 1
    print(f"Found {addr}. Binding...")
    token = await bind(addr)
    print(f"\n✅ Bound. Token = {token.hex()}")
    print(f"   Saved to {DEFAULT_TOKEN_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
