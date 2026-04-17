# [Bug] Web UI: Missing chat input and disappearing header on mobile

## Environment
- Device: iPhone (mobile Safari, accessed via LAN at `192.168.1.15`)
- View: Web UI served by Quark web server

---

## Issue 1: Chat input not visible on home screen

### Description
When loading the Web UI on a mobile device, the chat input area (`InputArea` component) is not visible. The greeting screen ("How can I help you this morning?") renders correctly, but the text input and send button at the bottom are hidden — likely clipped behind the mobile browser's bottom navigation bar.

### Screenshot
![No input](screenshot-1-no-input.png)

### Root Cause Analysis
The `InputArea` component **is rendered** (line 501 of `index.html`), so this is a CSS/layout issue, not a missing component.

The outer container uses `height: 100svh/100dvh/100vh` with `overflow: hidden`. The input area uses `padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px))` for safe area insets. However, on mobile Safari when accessed as a plain webpage (not installed as PWA), the browser's bottom toolbar overlaps the page content. `env(safe-area-inset-bottom)` only accounts for the device notch/home indicator — **not** the browser's own navigation bar chrome.

**Relevant code:**
- `src/web/public/index.html` line 433 — root container: `height: VH, overflow: 'hidden'`
- `src/web/public/index.html` line 625 — InputArea padding: `calc(16px + env(safe-area-inset-bottom, 0px))`
- `src/web/public/index.html` line 13-14 — CSS: `html,body { height:100dvh; overflow:hidden }`

### Suggested Fix Directions
1. Add extra bottom padding to the `InputArea` to account for mobile browser chrome (e.g., an additional `60px` on mobile, or use a JS-based viewport height calculation)
2. Consider using `window.visualViewport.height` instead of CSS viewport units to get the actual visible area
3. Alternatively, make the input `position: fixed; bottom: 0` with appropriate safe-area padding

---

## Issue 2: Header disappears when viewing existing session messages

### Description
When navigating to an existing session (via sidebar → session click), the header bar (QUARK logo, connection dot, model picker) is not visible. The second screenshot shows session messages rendered without any header — only a thin gray bar at the very top.

### Screenshot
![No header](screenshot-2-no-header.png)

### Root Cause Analysis
The header is rendered inside a flex column (`flexDirection: 'column'`) with `height: 52px, minHeight: 52px`. It is **not** `position: fixed/sticky` — it depends on the flex layout to stay visible.

When `switchSession(id)` is called (line 392-398), the API fetches messages and dispatches `LOAD_MESSAGES`. The loaded messages may cause a layout reflow where the messages area (`flex: 1, overflowY: 'auto'`) pushes content, or the header's `overflow: 'hidden'` combined with `height: 52` causes it to collapse/clip on certain mobile viewports.

Additionally, the `switchSession` function does NOT re-verify or reset any header-related state (like `tokensUsed`, `tokenLimit`, `modelName`). When loading a past session, the token display and model name may show stale/empty values.

**Relevant code:**
- `src/web/public/index.html` line 455 — header element: not `position: sticky`
- `src/web/public/index.html` line 452 — main area: `overflow: 'hidden', height: '100%'`
- `src/web/public/index.html` line 392-398 — `switchSession()` only loads messages, doesn't restore header state

### Suggested Fix Directions
1. Make the header `position: sticky; top: 0; z-index: 10` to ensure it stays visible regardless of scroll state
2. Ensure `switchSession` also loads/restores session-specific metadata (model name, tokens) so the header displays correctly
3. Investigate if the flex layout collapses the header on mobile when the messages area has many items

---

## Labels
`bug`, `web-ui`, `mobile`

## Priority
Medium — Affects mobile usability. The TUI works fine; this is specific to the web interface accessed from mobile devices.
