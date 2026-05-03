# Computer Tool for Quark

## What We're Building

A general-purpose macOS computer-use tool that lets a quark agent see and control
the screen: take screenshots, list/focus windows, click, type, scroll, drag,
press keys and hotkey combos. Primary motivation: manually test iOS apps in the
Simulator (or any GUI app) from an LLM agent.

Location: `~/.config/quark/tools/computer.ts` (user tool, not core).

## Dependencies

- `screencapture` — built-in macOS (screenshots)
- `cliclick` — `brew install cliclick` (mouse/keyboard input)
- `swift` — built-in with Xcode CLT (scroll events, window enumeration)
- `osascript` — built-in (screen size, app activation)

No Node/Bun package dependencies beyond `zod` (already used by other tools).

## Core Pipeline Requirement (not in this tool)

Quark's current tool result type is text-only:

```ts
interface ToolResult { title: string; output: string; metadata: Record<string, any> }
```

And `toModelOutput()` in `src/session/prompt.ts` hardcodes `{type: "text", value: result.output}`.

For this tool to be useful, the core must be extended so that when
`metadata.image` is a base64 PNG, it gets forwarded to the model as an
`image` content block. Touches:

- `src/tool/tool.ts` — extend `ToolResult` (or just document the `metadata.image` convention)
- `src/session/prompt.ts` — `toModelOutput()` emits multimodal result when image present
- `src/session/message.ts` — `toModelMessages()` serialization
- `src/session/processor.ts` — `extractOutput()` preserves image payload

Image size: a full-screen PNG on a 1512x982 retina display is ~1 MB raw / ~1.35 MB base64.
Consider downscaling or JPEG-ing in the core before model dispatch.

## Actions

All actions are dispatched through a single `action` parameter (Anthropic
computer-use style). The tool is **blocking** (uses `execSync`) but the
blocking only affects the Node event loop, not the user's Mac.

| action           | required params                | returns           |
|------------------|--------------------------------|-------------------|
| `screenshot`     | (optional `windowId`)          | `metadata.image` base64 PNG |
| `list_windows`   | (optional `app` filter)        | `metadata.windows: WindowInfo[]` |
| `focus`          | `app`                          | — |
| `click`          | `x`, `y`                       | — |
| `double_click`   | `x`, `y`                       | — |
| `right_click`    | `x`, `y`                       | — |
| `move`           | `x`, `y`                       | — |
| `drag`           | `x`, `y`, `endX`, `endY`       | — |
| `type`           | `text`                         | — |
| `key`            | `key`                          | — (single key like `return`, `esc`) |
| `hotkey`         | `modifiers[]`, `key`           | — (combo like Cmd+Shift+\) |
| `scroll`         | `x`, `y`, `direction`, `clicks`| — |
| `cursor_position`| —                              | `{x, y}` in metadata |

### Parameter schema (zod)

```ts
z.object({
  action: z.enum([
    "screenshot", "list_windows", "focus",
    "click", "double_click", "right_click",
    "type", "key", "hotkey", "scroll", "move", "drag", "cursor_position",
  ]),
  x: z.number().optional(),
  y: z.number().optional(),
  text: z.string().optional(),
  key: z.string().optional(),
  modifiers: z.array(z.enum(["cmd", "ctrl", "alt", "shift", "fn"])).optional(),
  direction: z.enum(["up", "down"]).optional(),
  clicks: z.number().optional(),     // default 3
  endX: z.number().optional(),
  endY: z.number().optional(),
  windowId: z.number().optional(),
  app: z.string().optional(),
})
```

### WindowInfo

```ts
interface WindowInfo {
  id: number       // CGWindowID — pass as `windowId` to screenshot
  app: string      // owning process name
  title: string    // window title (may be empty)
  x: number; y: number
  width: number; height: number
}
```

Filtering: windows with `layer != 0` (menu bar, dock) are excluded. Windows
smaller than 50x50 are also excluded to cut noise.

## Implementation Notes

### Screenshot

- Full-screen: `screencapture -x -C /tmp/quark-screenshot.png`
  - `-x` silent (no shutter sound)
  - `-C` includes the cursor
  - Captures the **active desktop only** — windows on other Spaces are not visible
- Window-targeted: `screencapture -x -l <windowID>`
  - Works across desktops — captures the window even if on another Space
  - Window IDs come from `list_windows`

### Window Enumeration

Uses `swift -e` inline script calling `CGWindowListCopyWindowInfo` with
`[.optionOnScreenOnly, .excludeDesktopElements]` and filtering `kCGWindowLayer == 0`.
Output is tab-separated `id\tapp\ttitle\tx\ty\twidth\theight`, parsed in TS.

### Mouse/Keyboard via cliclick

- `c:x,y` click, `dc:x,y` double, `rc:x,y` right, `m:x,y` move
- `dd:x,y du:x,y` drag start/end
- `t:text` type (single-quote escaped for shell safety)
- `kp:name` single special key
- `kd:mods kp:key ku:mods` for hotkey combos

### Scroll

`cliclick` doesn't have a scroll command. We post a CGScrollWheelEvent via
inline Swift:

```swift
let e = CGEvent(scrollWheelEvent2Source: nil, units: .line,
                wheelCount: 1, wheel1: Int32(amount), wheel2: 0, wheel3: 0)!
e.post(tap: .cghidEventTap)
```

Positive `amount` scrolls up, negative scrolls down. The tool moves the cursor
to `(x, y)` first so the scroll lands on the intended area.

### Screen Size

`osascript -e 'tell application "Finder" to get bounds of window of desktop'`
returns logical points (e.g. `0, 0, 1512, 982`), **not** retina pixels.
Coordinate inputs to cliclick are also in logical points — consistent.

## Permissions

The first time any of these run, macOS will prompt the user to grant
**Accessibility** and **Screen Recording** permissions to the terminal app
hosting quark (e.g. Ghostty, Terminal, iTerm). Without those, silent failures:

- No Accessibility → clicks/types silently no-op
- No Screen Recording → `screencapture` produces a black or empty image

Both are in `System Settings → Privacy & Security`.

## Concurrency & Safety

- **Blocking**: `execSync` blocks the Node event loop during each shell call
  (~100–500 ms). The Mac itself is not blocked — user can keep using the
  computer concurrently, but note that mouse/keyboard events from the tool
  and from the user will interleave unpredictably.
- **Race with user input**: the tool acts on live screen state. If the user
  moves a window while the model is computing coordinates, clicks may land
  in the wrong place. Use `list_windows` → `windowId` screenshot → compute
  coordinates relative to `window.x/y` for resilience.

## Example Usage (agent-side)

```jsonc
// Find the simulator
{ "action": "list_windows", "app": "Simulator" }
// → windows: [{ id: 842, app: "Simulator", x: 100, y: 80, width: 390, height: 844 }]

// Screenshot it
{ "action": "screenshot", "windowId": 842 }

// Tap a button at window-relative (195, 400) → screen (295, 480)
{ "action": "click", "x": 295, "y": 480 }

// Fill a text field
{ "action": "type", "text": "hello@example.com" }

// Press return
{ "action": "key", "key": "return" }

// Scroll down the list
{ "action": "scroll", "x": 295, "y": 500, "direction": "down", "clicks": 5 }

// Cmd+Shift+H to simulate home button in Simulator
{ "action": "hotkey", "modifiers": ["cmd", "shift"], "key": "h" }
```

## Integration

Add to the desired profile in `~/.config/quark/config.yaml`:

```yaml
profiles:
  coder:
    tools: [..., computer]
```

## Open Questions / Future Work

- **Image compression**: full-screen PNGs are ~1 MB base64. Pipeline should
  downscale to ≤1024 on the long edge and/or emit JPEG to reduce token cost.
- **OCR / UI inspection**: a companion action that returns structured text
  (via macOS Vision framework or Accessibility API) would let the agent act
  without always paying the screenshot cost.
- **Multi-display**: `screenSize()` returns the main display only. Windows on
  secondary displays have coordinates in the combined coordinate space, which
  works with cliclick but isn't reflected in the returned `screenSize`.
- **Retina scaling**: current logical-point coordinates work, but if the core
  adds image downscaling, preserve a scale factor so coordinate math stays correct.
- **Non-blocking**: switch to `execAsync` if/when quark runs tools in parallel.
