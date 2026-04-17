"""Generate modified protobuf payload for meta.ai chat via surgical byte replacement.

Instead of decode/re-encode (which changes byte encoding and fails integrity checks),
this does precise byte-level surgery: only the message text bytes and their length
varints are modified. All other bytes remain identical to the captured template.
"""
import json, uuid, base64, time, random, sys, os

def encode_varint(value):
    result = bytearray()
    while value > 0x7f:
        result.append((value & 0x7f) | 0x80)
        value >>= 7
    result.append(value & 0x7f)
    return bytes(result)

def read_varint(data, pos):
    result = 0
    shift = 0
    start = pos
    while pos < len(data):
        b = data[pos]
        result |= (b & 0x7f) << shift
        pos += 1
        if not (b & 0x80):
            break
        shift += 7
    return result, pos, pos - start

def surgical_replace(pb, new_msg_bytes):
    """Replace the message text in a captured protobuf template.
    
    Layout (from reverse engineering):
      pb[0]: field 1 tag (0x0a)
      pb[1:3]: field 1 length varint (2 bytes, value=794)
      pb[3:797]: field 1 data (config, user info, etc.)
      pb[797]: field 2 tag (0x12) 
      pb[798]: field 2 length varint (1 byte, value=111 for "hello")
      pb[799:910]: field 2 data:
        pb[799:898]: field 2.1 (message metadata - turn_id, conv_id, timestamps)
        pb[898]: field 2.2 tag (0x12)
        pb[899]: field 2.2 length varint (1 byte, value=5 for "hello")
        pb[900:905]: field 2.2 data ("hello")
        pb[905:910]: field 2.4 (extra data, 5 bytes)
    """
    old_msg = b"hello"
    old_msg_len = len(old_msg)
    new_msg_len = len(new_msg_bytes)
    delta = new_msg_len - old_msg_len
    
    # Positions (hardcoded from template analysis)
    MSG_DATA_START = 900
    MSG_DATA_END = 905
    MSG_LEN_POS = 899   # 1-byte varint
    FIELD2_LEN_POS = 798  # 1-byte varint
    TAIL = pb[MSG_DATA_END:]  # bytes after "hello" (field 2.4 data)
    
    # Read current field 2 length
    field2_len_orig, _, field2_len_bytes = read_varint(pb, FIELD2_LEN_POS)
    
    # New lengths
    new_msg_len_varint = encode_varint(new_msg_len)
    new_field2_len = field2_len_orig + delta + (len(new_msg_len_varint) - 1)  # adjust for varint size change
    new_field2_len_varint = encode_varint(new_field2_len)
    
    # Build new protobuf:
    # [0:798] = everything up to field 2 length
    # new field 2 length varint
    # [799:898] = field 2 inner data up to message tag
    # [898] = message tag (0x12)
    # new message length varint
    # new message bytes
    # tail bytes (field 2.4)
    
    result = bytearray()
    result.extend(pb[:FIELD2_LEN_POS])          # up to field2 length
    result.extend(new_field2_len_varint)         # new field2 length
    result.extend(pb[FIELD2_LEN_POS + field2_len_bytes:MSG_LEN_POS])  # inner data up to msg length
    result.extend(new_msg_len_varint)            # new message length
    result.extend(new_msg_bytes)                 # new message text
    result.extend(TAIL)                          # remaining bytes
    
    return bytes(result)

def replace_uuid_bytes(pb, old_uuid, new_uuid):
    """Replace a UUID string in the protobuf (must be same length)."""
    assert len(old_uuid) == len(new_uuid), f"UUID length mismatch: {len(old_uuid)} vs {len(new_uuid)}"
    return pb.replace(old_uuid.encode(), new_uuid.encode())

def main():
    conv_id = sys.argv[1]
    req_id = sys.argv[2]
    user_msg = sys.argv[3]
    
    template = os.environ.get("META_TEMPLATE",
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "meta-ws-template.bin"))
    
    with open(template, "rb") as f:
        raw = f.read()
    jstart = raw.find(b"{")
    body = json.loads(raw[jstart:])
    pb64 = body["payload"]
    pad = 4 - len(pb64) % 4
    if pad != 4: pb64 += "=" * pad
    pb = base64.b64decode(pb64)
    
    # 1. Replace message text (surgical byte replacement)
    new_msg = user_msg.encode("utf-8")
    pb = surgical_replace(pb, new_msg)
    
    # 2. Replace UUIDs (same-length, no structure change)
    ORIG_CONV = "eaf9ec0d-a079-41da-bdf8-6036d5026096"
    ORIG_REQ = "dcd70852-ea59-4bb4-8d56-ff129a27ac9e"
    ORIG_TURN = "3b190e1a-64d7-48f3-9aba-249c75197d9d"
    ORIG_MSG1 = "cb9c8e6b-f9d9-459e-a055-f6698be6f9aa"
    ORIG_MSG2 = "a669c0a4-2ea5-4507-be0b-41a369a2bb50"
    
    pb = replace_uuid_bytes(pb, ORIG_CONV, conv_id)
    pb = replace_uuid_bytes(pb, ORIG_REQ, req_id)
    pb = replace_uuid_bytes(pb, ORIG_TURN, str(uuid.uuid4()))
    pb = replace_uuid_bytes(pb, ORIG_MSG1, str(uuid.uuid4()))
    pb = replace_uuid_bytes(pb, ORIG_MSG2, str(uuid.uuid4()))
    
    # 3. Replace timestamps (same byte width, 7-byte varints)
    # Original timestamps: 1775716183306 and 1775716183266
    # These are at known positions within field 1.5
    now_ms = int(time.time() * 1000)
    old_ts1 = encode_varint(1775716183306)
    old_ts2 = encode_varint(1775716183266)
    new_ts1 = encode_varint(now_ms)
    new_ts2 = encode_varint(now_ms - 40)
    
    # Only replace if varint encoding is same size (to avoid breaking offsets)
    if len(new_ts1) == len(old_ts1):
        pb = pb.replace(old_ts1, new_ts1, 1)
    if len(new_ts2) == len(old_ts2):
        pb = pb.replace(old_ts2, new_ts2, 1)
    
    # Also replace timestamp in field 2.1.2.2 (same value as ts1)
    # And the random ID in field 2.1.2.3
    
    # 4. Encode and output
    new_b64 = base64.b64encode(pb).decode().rstrip("=")
    print(json.dumps({"req-id": req_id, "payload": new_b64}, separators=(",", ":")))

if __name__ == "__main__":
    main()
