# Meta.ai Chat Protocol Specification

## Overview

Meta.ai uses a WebSocket-based protocol called **DGW (Digital Gateway)** to communicate
between the browser and `gateway.meta.ai`. The payload format is `PROTO_INSIDE_JSON` —
a JSON chat payload wrapped inside DGW binary frames encoded by a **WASM codec**.

## Architecture

```
Browser JS
    ↓ buildClippyPayload() → JSON bytes
    ↓ DGW WASM Codec → binary DGW frames (encodeStreamGroup_Data)
    ↓ WebSocket binary message
    → wss://gateway.meta.ai/ws/clippy?...
    ← DGW binary frames (decoded by WASM)
    ← JSON streaming response (seq/type/response)
```

## Authentication

1. **Session cookie**: `ecto_1_sess` (obtained via OAuth or login flow)
2. **Access token**: Extracted from the HTML of `GET https://meta.ai/`
   - Regex: `accessToken\\":\\"(ecto1:[A-Za-z0-9_\-]+)`
3. **WS auth**: Token passed as `Authorization` query param on WS URL

## Connection Flow

### 1. Fetch Access Token
```
GET https://meta.ai/
Cookie: ecto_1_sess=...; rd_challenge=...
→ Extract ecto1:... token from HTML
```

### 2. Warmup Conversation
```
POST https://meta.ai/api/graphql
Content-Type: application/json
{"doc_id": "e7f802582dbfed8e181b012e010993eb", "variables": {"conversationId": "<uuid>"}}
→ {"data": {"warmupConversation": true}}
```

### 3. (Optional) Set Conversation Mode
```
POST https://meta.ai/api/graphql
{"doc_id": "c32bbe999c48e64e855dc63177d5153f",
 "variables": {"input": {"conversationId": "<uuid>", "mode": "think_hard"}}}
```

### 4. WebSocket Connection
```
wss://gateway.meta.ai/ws/clippy?
  x-dgw-appid=1522763855472543
  x-dgw-appversion=1.0.0
  x-dgw-authtype=15:0
  x-dgw-version=5
  x-dgw-uuid=0
  x-dgw-tier=prod
  Authorization=<ecto1:token>
  x-dgw-app-origin=meta.ai
  x-dgw-app-clippy-request-id=<uuid>
  x-dgw-app-clippy-async=true

Headers:
  Origin: https://meta.ai  (CRITICAL - must be meta.ai, not gateway.meta.ai)
```

### 5. DGW Frame Exchange

All frames are **binary WebSocket messages** encoded/decoded by a WASM codec.

| Frame Type | ID   | Description |
|-----------|------|-------------|
| Ping      | 0x09 | Client keepalive |
| Pong      | 0x0A | Server keepalive response |
| Ack       | 0x0C | Acknowledgement |
| Data      | 0x0D | Payload data (request/response) |
| EndOfData | 0x0E | Stream end signal |
| EstabStream | 0x0F | Stream establishment (handshake) |

#### Handshake (EstabStream)
Client sends stream establishment with app headers:
```json
{
  "x-dgw-app-x-ecto-conversation-id": "<conv-uuid>",
  "x-dgw-app-client-payload-type": "PROTO_INSIDE_JSON"
}
```
Server responds with `{"code": 200}`.

#### Message Send (Data frame)
The payload is a JSON object:
```json
{
  "req-id": "<request-uuid>",
  "payload": "<base64-encoded-protobuf>"
}
```

The protobuf contains the actual chat request with fields like:
- `conversation_id`, `prompt_content`, `user_id`, `app_id`, `request_id`
- `entry_point`: "KADABRA__HOME__UNIFIED_INPUT_BAR"
- `config_key`: "Abra Web Main Key"
- Bot IDs: `867051314767696` (Meta AI assistant)
- User ID: Viewer's numeric FBID
- Device fingerprint hash (SHA-256-like, 64 hex chars)

**IMPORTANT**: The DGW WASM codec adds frame integrity checks. Frames cannot be
hand-crafted; they must be produced by the codec. Exact binary replay works, but
modifying any protobuf bytes causes the server to reject with `0x0E0000` (EndOfData/error).

## Chat Payload (buildClippyPayload)

The JS function `buildClippyPayload` creates a JSON object:
```js
{
  conversation_id: string,      // UUID
  prompt_content: string,       // user's message
  user_id: string,              // numeric FBID
  app_id: string,               // "1522763855472543"
  request_id: string,           // UUID
  unique_message_id: string,    // generated from timestamp + random
  turn_id: string,
  entry_point: string,          // "KADABRA__CHAT__UNIFIED_INPUT_BAR"
  // ... optional: attachment_ids, user_mentioned_data, metadata, etc.
}
```

This JSON is then encoded to bytes with `TextEncoder` and wrapped in a DGW Data frame
by the WASM codec.

## Streaming Response Format

Each response is a DGW Data frame containing JSON:

### Full update (type: "full")
```json
{
  "seq": 0,
  "type": "full",
  "response": {
    "response_id": "<uuid>",
    "sections": [{
      "view_model": {
        "__typename": "GenAISingleLayoutViewModel",
        "primitive": {
          "__typename": "GenAIBotThinkingStatusViewModel"|"GenAIMarkdownTextViewModel",
          // ThinkingStatus: is_in_progress, thought_text, title
          // MarkdownText: text (the actual response content)
        }
      }
    }],
    "is_complete": false|true
  }
}
```

### Incremental update (type: "patch")
```json
{
  "seq": N,
  "type": "patch",
  "operations": [{
    "op": "delta",
    "path": "/sections/0/view_model/primitive/text",
    "value": "incremental text..."
  }]
}
```

## DGW WASM Codec

The codec is loaded asynchronously from a chunked JS module. Key exported functions:
- `__DgwCodecDecode(buf, len, ...)` - decode incoming frames
- `__DgwCodecEncodeStreamGroup_Data(streamId, data, len, requiresAck, ackId, ...)` - encode data
- `__DgwCodecEncodeStreamGroup_EstabStream(streamId, params, len, ...)` - encode handshake
- `__DgwCodecEncodePing/Pong/Ack/Drain/EndOfData(...)` - other frame types
- `__malloc/__free` - WASM memory management

The codec manages:
- Stream IDs (uint16, max 65535)
- ACK IDs (uint8, mod 128)
- Frame type headers
- **Frame integrity** (prevents hand-crafted frames from working)

## Known Limitations

1. **Protobuf content integrity**: The server validates protobuf payload integrity beyond
   standard protobuf encoding. `blackboxprotobuf.encode_message()` produces valid protobuf
   that decodes to identical data, but different byte-level encoding (e.g., different varint
   representation of the same value) causes server rejection with DGW EndOfData (0x0e0000).
   Exact binary replay of captured frames works perfectly.
2. **DGW WASM codec required**: The DGW binary frame format requires Meta's WASM codec
   (dgwcppbridge) for proper encoding. Hand-crafted frames are rejected. The codec is
   available as an asm.js fallback in the browser's JS bundles.
3. **Session-bound**: The protobuf payload contains user-specific data (FBID, device
   fingerprint hash) tied to the authenticated session.
4. **EstablishStream + Data in one frame**: The browser sends the EstablishStream and
   first Data frame as a SINGLE WebSocket message (concatenated). Sending them separately
   still works for stream establishment but the data may be rejected.

## Working Solution

The working pipeline (verified):
1. Extract `ecto1:` access token from `GET https://meta.ai/` HTML
2. Warmup conversation via `POST https://meta.ai/api/graphql`
3. Load DGW WASM codec from Meta's JS bundle (asm.js fallback, no actual WASM needed)
4. Send EstablishStream + Data frames through the codec
5. Decode response frames with the codec, extract JSON from protobuf wrapper

For the payload content:
- **Exact replay**: Works perfectly. Captured binary from mitmproxy replays with new auth tokens.
- **Custom messages**: Requires constructing the protobuf with Meta's own JS protobuf builder
  (found in the JS bundles using `rA`, `rI`, `rr` functions), or finding the exact byte-level
  encoding rules the server expects.

## Possible Approaches for Programmatic Access

1. **Headless browser** (Playwright/Puppeteer): Use the actual browser JS to handle
   DGW codec and frame construction.
2. **WASM extraction**: Extract and run the DGW WASM codec outside the browser
   (Node.js or Python via wasmtime/wasmer).
3. **Proxy injection**: Use mitmproxy to intercept and modify payloads at the
   application layer (after DGW decode, before DGW encode).
4. **GraphQL-only**: Some operations may be available via the GraphQL API without
   the WebSocket (limited to non-streaming use cases).
