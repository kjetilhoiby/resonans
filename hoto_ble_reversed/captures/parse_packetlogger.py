"""Parse PacketLogger .pklg, extract ATT traffic for a given connection handle.

Format (Apple PacketLogger, observed):
  4 bytes  length (LE) = bytes following the length field for this record
  4 bytes  timestamp seconds (LE, Unix)
  4 bytes  timestamp microseconds (LE)
  1 byte   packet type
  N bytes  payload

Packet types we care about:
  0x02 ACL Send (host -> controller)
  0x03 ACL Receive (controller -> host)
  0x00 HCI Command
  0x01 HCI Event

ACL payload:
  2 bytes  handle+flags (LE): bits 0..11 = conn handle, bits 12..13 = PB flag, bits 14..15 = BC flag
  2 bytes  ACL data length (LE)
  L2CAP:
    2 bytes  L2CAP length (LE)
    2 bytes  CID (LE)   -- 0x0004 = ATT
    ATT PDU
"""

import struct
import sys
from pathlib import Path

PKLG = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent / "hoto-binding-2026-05-11.pklg"
TARGET_HANDLE = int(sys.argv[2], 16) if len(sys.argv) > 2 else None  # None = auto-detect Hoto connections
OUT = PKLG.with_suffix(".extracted.txt")
HOTO_MAC = bytes.fromhex("9d2e8483eddc")  # DC:ED:83:84:2E:9D reversed (BLE LE byte order)

ATT_OPCODES = {
    0x01: "Error Response",
    0x02: "Exchange MTU Request",
    0x03: "Exchange MTU Response",
    0x04: "Find Information Request",
    0x05: "Find Information Response",
    0x06: "Find By Type Value Request",
    0x07: "Find By Type Value Response",
    0x08: "Read By Type Request",
    0x09: "Read By Type Response",
    0x0A: "Read Request",
    0x0B: "Read Response",
    0x0C: "Read Blob Request",
    0x0D: "Read Blob Response",
    0x10: "Read By Group Type Request",
    0x11: "Read By Group Type Response",
    0x12: "Write Request",
    0x13: "Write Response",
    0x16: "Prepare Write Request",
    0x17: "Prepare Write Response",
    0x18: "Execute Write Request",
    0x19: "Execute Write Response",
    0x1B: "Handle Value Notification",
    0x1D: "Handle Value Indication",
    0x1E: "Handle Value Confirmation",
    0x52: "Write Command",
}


def iter_records(buf: bytes):
    off = 0
    while off + 4 <= len(buf):
        (length,) = struct.unpack_from("<I", buf, off)
        if length < 9 or off + 4 + length > len(buf):
            break
        record = buf[off + 4 : off + 4 + length]
        secs, usecs = struct.unpack_from("<II", record, 0)
        ptype = record[8]
        payload = record[9:]
        yield secs, usecs, ptype, payload
        off += 4 + length


def parse_l2cap_att(acl_payload: bytes):
    """Return (cid, att_payload) or None."""
    if len(acl_payload) < 4:
        return None
    l2_len, cid = struct.unpack_from("<HH", acl_payload, 0)
    att = acl_payload[4 : 4 + l2_len]
    return cid, att


def parse_att(att: bytes) -> str:
    if not att:
        return "(empty)"
    op = att[0]
    name = ATT_OPCODES.get(op, f"Op 0x{op:02X}")
    rest = att[1:]
    # For write/notify ops, show handle + value
    if op in (0x12, 0x52, 0x1B, 0x1D):  # Write Req, Write Cmd, Notify, Indicate
        if len(rest) >= 2:
            (handle,) = struct.unpack_from("<H", rest, 0)
            value = rest[2:]
            return f"{name} handle=0x{handle:04X} value={value.hex()} ({len(value)}B)"
    if op in (0x0A, 0x0C):  # Read Req, Blob
        if len(rest) >= 2:
            (handle,) = struct.unpack_from("<H", rest, 0)
            return f"{name} handle=0x{handle:04X}"
    if op == 0x0B:  # Read Response
        return f"{name} value={rest.hex()} ({len(rest)}B)"
    return f"{name} payload={rest.hex()}"


def main():
    buf = PKLG.read_bytes()
    hoto_handles: set[int] = set()
    lines = []
    for secs, usecs, ptype, payload in iter_records(buf):
        ts = f"{secs}.{usecs:06d}"

        if ptype == 0x01:  # HCI Event
            if len(payload) >= 12 and payload[0] == 0x3E and payload[2] == 0x0A:
                # LE Meta - Enhanced Connection Complete
                # subevent(1), status(1), handle(2), role(1), peer_addr_type(1), peer_addr(6)
                status = payload[3]
                (chandle,) = struct.unpack_from("<H", payload, 4)
                peer_addr = payload[8:14]
                if peer_addr == HOTO_MAC:
                    hoto_handles.add(chandle)
                    lines.append(f"{ts}  == CONNECT status={status} handle=0x{chandle:04X} peer=DC:ED:83:84:2E:9D")
                elif TARGET_HANDLE is not None and chandle == TARGET_HANDLE:
                    hoto_handles.add(chandle)
                    lines.append(f"{ts}  == CONNECT status={status} handle=0x{chandle:04X}")
            elif len(payload) >= 5 and payload[0] == 0x05:  # Disconnection Complete
                (chandle,) = struct.unpack_from("<H", payload, 2)
                if chandle in hoto_handles:
                    reason = payload[4]
                    lines.append(f"{ts}  == DISCONNECT handle=0x{chandle:04X} reason=0x{reason:02X}")
                    # Keep handle in set so trailing ACL still parses; but BLE handles get reused
            continue

        if ptype not in (0x02, 0x03):
            continue
        if len(payload) < 4:
            continue
        (hf, ad_len) = struct.unpack_from("<HH", payload, 0)
        conn_handle = hf & 0x0FFF
        pb_flag = (hf >> 12) & 0x03

        if conn_handle not in hoto_handles:
            continue

        # Reassemble L2CAP fragments: only "Start" (0b10 in PB) starts a new PDU on ACL data
        # We'll just dump per-fragment; for short PDUs (typical here) it's enough.
        acl_data = payload[4 : 4 + ad_len]
        if pb_flag == 0x01:  # Continuing fragment
            lines.append(f"{ts}  {('→' if ptype == 0x02 else '←')}  [ACL cont handle=0x{conn_handle:04X}] {acl_data.hex()}")
            continue
        l2 = parse_l2cap_att(acl_data)
        if l2 is None:
            continue
        cid, att = l2
        if cid != 0x0004:
            continue
        direction = "→" if ptype == 0x02 else "←"
        lines.append(f"{ts}  [h=0x{conn_handle:04X}]  {direction}  {parse_att(att)}")

    OUT.write_text("\n".join(lines))
    print(f"Wrote {len(lines)} lines to {OUT}")
    print(f"Hoto connection handles: {sorted(hex(h) for h in hoto_handles)}")


if __name__ == "__main__":
    main()
