# Meta.ai Protocol Analysis

## Overview

Meta.ai uses **Facebook DGW (Data Gateway)** over WebSocket for the actual chat interaction.
HTTP requests are only used for side-channel operations (analytics, latency reporting, monitoring).

## Authentication Flow

1. User visits meta.ai → gets `ecto_1_sess` session cookie (UUID format)
2. The JavaScript client derives an `ecto1:` authorization token from the session
3. This token is passed as a query parameter in the WebSocket URL

**Key cookies:**
- `ecto_1_sess` — session ID (e.g., `0f99630f-bf0e-4f3d-b818-18c9a...`)
- `rd_challenge` — challenge token

## WebSocket Connection

**Endpoint:** `wss://gateway.meta.ai/ws/clippy`

**Query parameters:**
| Parameter | Value |
|---|---|
| `x-dgw-appid` | `1522763855472543` |
| `x-dgw-appversion` | `1.0.0` |
| `x-dgw-authtype` | `15:0` |
| `x-dgw-version` | `5` |
| `x-dgw-uuid` | `0` (unauthenticated) |
| `x-dgw-tier` | `prod` |
| `Authorization` | `ecto1:<base64url-encoded-token>` |
| `x-dgw-app-origin` | `meta.ai` |
| `x-dgw-app-clippy-request-id` | UUID |
| `x-dgw-app-clippy-async` | `true` |

**Headers:**
- `Origin: https://meta.ai`
- `Sec-Fetch-Mode: websocket`
- `Sec-Fetch-Site: same-site`
- Standard WS upgrade headers

## WebSocket Protocol

### Handshake (after WS connect)

**Client sends (text frame):**
```json
{
  "x-dgw-app-x-ecto-conversation-id": "<conversation-uuid>",
  "x-dgw-app-client-payload-type": "PROTO_INSIDE_JSON"
}
```

**Server responds (text frame):**
```json
{"code": 200}
```

### Sending a Message

Client sends a **binary frame** with structure:
```
[8-byte header: 0d00000005000080] + JSON payload
```

The JSON payload contains:
```json
{
  "req-id": "<uuid>",
  "payload": "<base64-encoded-protobuf>"
}
```

The protobuf payload (decoded) contains:
- `KADABRA__HOME__UNIFIED_INPUT_BAR` — operation identifier
- `1522763855472543` — app ID
- Conversation ID
- `HUMAN_AGENT` — sender type
- `867051314767696` — some user/bot ID (x2)
- `ECTO1` — auth type
- Device info: "Abra Web Main Key", "Mac OS X"
- `user_input` — input type
- User agent string
- `desktop_web` — interface
- Request ID (UUID)
- Locale: `en-GB`
- Session/prompt/conversation UUIDs
- Timezone: `Europe/Amsterdam`
- Feature flags: `stocks`, `weather`, `meta_knowledge_search_carousel`, `meta_catalog_search_carousel`, `media_gallery`
- **The actual message text** (e.g., `hello`)

### Streaming Response

Server sends binary frames with:
```
[variable-length protobuf header] + JSON payload
```

#### Thinking Phase
The header contains the **chain-of-thought reasoning** as raw protobuf text. The JSON payload is:
```json
{
  "seq": 0,
  "type": "full",
  "response": {
    "response_id": "<same-as-request-uuid>",
    "sections": [{
      "view_model": {
        "__typename": "GenAISingleLayoutViewModel",
        "primitive": {
          "__typename": "GenAIBotThinkingStatusPrimitive",
          "title": "Greeting the user warmly",
          "is_in_progress": true,
          "icon": "THINKING",
          "thought_text": "Greeting the user warmly"
        }
      }
    }]
  }
}
```

Each frame during thinking updates the reasoning text in the protobuf header while the JSON payload stays the same (just incrementing `seq`).

#### Text Response Phase  
When thinking completes, the response switches to text streaming:

**First text frame (type=full):**
```json
{
  "seq": 283,
  "type": "full",
  "response": {
    "response_id": "<uuid>",
    "sections": [
      {
        "view_model": {
          "__typename": "GenAISingleLayoutViewModel",
          "primitive": {
            "__typename": "GenAIBotThinkingStatusPrimitive",
            "title": "",
            "is_in_progress": false
          }
        }
      },
      {
        "view_model": {
          "__typename": "GenAISingleLayoutViewModel",
          "primitive": {
            "__typename": "GenAIMarkdownTextUXPrimitive",
            "text": "Hello"
          }
        }
      }
    ]
  }
}
```

**Subsequent token frames (type=patch):**
```json
{
  "seq": 284,
  "type": "patch",
  "operations": [{
    "op": "delta",
    "path": "/sections/1/view_model/primitive/text",
    "value": "! Morning in Maastricht"
  }]
}
```

**Final frame (type=full):**
Contains the complete response text.

## HTTP Side-Channels

These are standard POST requests with cookies:

### GraphQL Calls (`POST /api/graphql`)
| doc_id | Purpose |
|---|---|
| `e7f802582dbfed8e181b012e010993eb` | Warmup conversation |
| `c32bbe999c48e64e855dc63177d5153f` | Update conversation mode (e.g., `think_hard`) |
| `954e9b193487fa4af750af87906e4313` | Trigger Heisenberg check |
| `26999e5d1366c257595b7fafa7822c31` | Save message latency metrics |

### Analytics (`POST /api/analytics`)
- Batched events: `send_message`, `cot_thinking`, `ecto_conversation_page_time_spent`
- QPL interaction traces with timing points

## Key Findings

1. **No session token in HTTP API** — auth is via cookies (`ecto_1_sess`) + derived `ecto1:` token in WS URL
2. **Binary protobuf framing** — messages are wrapped in protobuf with an 8-byte header
3. **Chain-of-thought leaks** — the full reasoning is sent in the protobuf header of each thinking frame
4. **JSON patch streaming** — text tokens are streamed as JSON patches (`delta` operations)
5. **Model: Muse Spark** — from the Muse model family, launched April 8 2026

## GraphQL SSE API (Preferred Client Approach)

The DGW binary WebSocket protocol has server-side content integrity checks that prevent
protobuf modification. However, meta.ai also exposes a **GraphQL SSE endpoint** that
is much simpler to use.

### Endpoint

`POST https://meta.ai/api/graphql`

### Send Message Subscription

**doc_id:** `62fbc9b911a73008132a4f5333387703` (`useEctoMultiSendSubscription`)

**Variables:**
| Variable | Type | Description |
|---|---|---|
| `conversationId` | `ID!` | UUID for the conversation |
| `content` | `String!` | The message text |
| `userMessageId` | `ID!` | UUID for the user message |
| `assistantMessageId` | `ID!` | UUID for the assistant reply |
| `userUniqueMessageId` | `String!` | Snowflake-like ID: `((now_ms & 0x1FFFFFFFFFF) << 22) \| random_22bits` |
| `turnId` | `ID!` | UUID for the conversation turn |

**Response:** `text/event-stream` (SSE)

Each SSE `data:` event contains a JSON object with:
```
data.sendMessageStream.__typename = "AssistantMessage" | "UserMessage"
data.sendMessageStream.streamingState = "STREAMING" | "DONE"
data.sendMessageStream.content = "response text"
data.sendMessageStream.contentRenderer.unified_response.sections[].view_model.primitive:
  - __typename: "GenAIMarkdownTextUXPrimitive" → .text = accumulated response
  - __typename: "GenAIBotThinkingStatusPrimitive" → .thought_text, .is_in_progress
```

### Client Implementation

See `proxy/meta-chat.py` for a working Python client that:
1. Reads `rd_challenge` and `ecto_1_sess` cookies from environment
2. Warms up a new conversation via GraphQL
3. Sends messages via the `sendMessageStream` subscription
4. Parses SSE events to extract streaming response text
5. Supports both single-message and interactive modes
