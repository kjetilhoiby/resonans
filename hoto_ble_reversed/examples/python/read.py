#!/usr/bin/env python3
"""Stream weight readings from Hoto scale.

Assumes bind.py was run first (mi_token.bin exists). Login is performed on
each invocation; the token is reused across runs.
"""
import argparse
import asyncio
import json
import sys

from protocol import find_scale, stream_weights, DEFAULT_TOKEN_PATH


async def main(args) -> int:
    if not DEFAULT_TOKEN_PATH.exists():
        print(f"No token at {DEFAULT_TOKEN_PATH}. Run bind.py first.")
        return 1
    token = DEFAULT_TOKEN_PATH.read_bytes()

    print("Scanning for Hoto scale...", file=sys.stderr)
    addr = await find_scale()
    if not addr:
        print("Not found.", file=sys.stderr)
        return 1
    print(f"Connecting to {addr}...", file=sys.stderr)

    async for frame in stream_weights(addr, token):
        if args.json:
            print(json.dumps(frame.to_dict()), flush=True)
        else:
            if frame.type == "stable":
                print(f"★  stable {frame.grams:7.1f} g")
            elif frame.type == "active":
                print(f"   active {frame.grams:7.1f} g")
            elif frame.type == "idle":
                pass  # too chatty to print idle frames
    return 0


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--json", action="store_true",
                   help="Output one JSON object per frame")
    args = p.parse_args()
    try:
        sys.exit(asyncio.run(main(args)))
    except KeyboardInterrupt:
        sys.exit(0)
