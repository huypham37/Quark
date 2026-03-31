# Perplexity WebSocket Autocomplete — Spec

> Captured via mitmproxy on 2026-03-31. Traffic from Safari on macOS proxied through `127.0.0.1:8080`.

---

## Endpoint

```
wss://suggest.perplexity.ai/suggest/ws
```

Upgraded from HTTP via standard `101 Switching Protocols`. Cloudflare-fronted (`CF-RAY` header present).

---

## Connection Lifecycle

- Opened when the user **focuses the search input** on any Perplexity page
- **One persistent connection** per page load — not reconnected per keystroke
- Closed when the user navigates away or submits a query
- Cookies sent on the initial HTTP upgrade handshake:
  - `pplx.edge-sid` — edge session ID
  - `pplx.edge-vid` — edge visitor ID
  - `__cf_bm` — Cloudflare bot management token

---

## Message Protocol

### CLIENT → SERVER (per keystroke)

```json
{
  "q": "ho",
  "uuid": "2",
  "full_completion": true
}
```

| Field | Type | Description |
|---|---|---|
| `q` | string | Current value of the search input |
| `uuid` | string | Incrementing request ID (starts at `"1"`) |
| `full_completion` | bool | Request full suggestion text, not just suffix completion |

### SERVER → CLIENT (response)

```json
[
  "ho",
  ["home depot", "hulu", "happy st patrick's day", "hamnet", "hertz"],
  "2",
  [
    { "text": "home depot" },
    { "text": "hulu" },
    { "text": "happy st patrick's day" },
    { "text": "hamnet" },
    { "text": "hertz" }
  ]
]
```

| Index | Type | Description |
|---|---|---|
| `[0]` | string | Echo of the query `q` |
| `[1]` | string[] | Flat list of suggestion strings |
| `[2]` | string | Echo of the request `uuid` |
| `[3]` | object[] | Full suggestion objects `{ text: string }` |

---

## Stale Response Handling

The client sends messages for every keystroke without waiting for previous responses. The `uuid` field is used to discard out-of-order results:

```
User types: "h" → "ho" → "how"
Client sends: uuid=1, uuid=2, uuid=3

Server may respond out of order.
Client renders only the response where uuid matches the latest sent uuid.
Responses with lower uuid are dropped.
```

---

## Separate from Search

The suggest WebSocket **only handles autocomplete dropdown suggestions**. The actual search request uses a different mechanism entirely:

```
POST https://www.perplexity.ai/rest/sse/perplexity_ask
Content-Type: application/json
Response: text/event-stream  ← SSE, not WebSocket
```

There are also two other REST endpoints involved in autocomplete:

```
POST /rest/autosuggest/list-autosuggest   ← fires on initial focus (empty query)
```

Request body:
```json
{
  "query": "",
  "sources": ["web"],
  "search_mode": "search",
  "source_tab_url": ""
}
```
Returns `{ "results": [] }` when no query is typed yet.

---

## Why WebSocket over HTTP

| HTTP per-request | WebSocket |
|---|---|
| New TCP + TLS handshake per keystroke | One handshake, reused for session |
| ~50–100ms latency overhead | Near-zero framing overhead |
| No built-in request correlation | `uuid` field correlates request/response |
| Server can't push unsolicited updates | Could push trending suggestions proactively |

---

## Observed Suggestions (sample — typing "h")

```
"home depot"
"hulu"
"happy st patrick's day"
"hamnet"
"hertz"
```

Suggestions appear to be **trending/popular queries** globally, not personalized to the user's history.
