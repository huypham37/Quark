# TUI Migration: Ink/React → OpenTUI/SolidJS

## Why

Ink re-diffs the entire terminal output as a string on every state change.
Scrolling triggers `setState` → React reconciliation → full string diff → full repaint.
No amount of `React.memo` or `useImperativeHandle` can bypass this — it's architectural.

OpenTUI uses a native Zig core with cell-level double buffering, SolidJS fine-grained
reactivity, and a native `<scrollbox>` primitive that scrolls imperatively without
triggering any reactive updates. This is the only path to smooth 60fps scrolling.

---

## Scope

**26 files, ~2,600 lines total.** Roughly 70% rewrite, 30% reusable.

### Files that survive as-is (business logic — no framework dependency)
| File | Lines | Notes |
|------|-------|-------|
| `commands.ts` | 34 | Slash command registry — pure data |
| `filelist.ts` | 103 | File listing + fuzzy filter — pure async |
| `theme.ts` | 50 | Color/icon constants (convert to RGBA later) |
| `state/state.ts` | 279 | Types (`TuiMessage`, `TuiPart`, `TuiStatus`) survive. Reducer → signals. `dbToTuiMessages` survives. |

### Files that get rewritten (framework-coupled)
| File | Lines | Solid equivalent |
|------|-------|-----------------|
| `index.tsx` | 171 | Entry point: `render()` from `@opentui/solid` instead of `ink` |
| `App.tsx` | 501 | Root component: SolidJS signals, `useKeyboard`, `<scrollbox>` |
| `hooks/useEventBus.ts` | 128 | `createEffect` + `onCleanup` instead of `useEffect` |
| `hooks/useMouseScroll.ts` | 115 | **Deleted** — OpenTUI handles mouse natively |
| `components/messages/MessagePane.tsx` | 87 | **Deleted** — replaced by native `<scrollbox>` |
| `components/messages/MessageList.tsx` | 29 | **Deleted** — inlined into scrollbox |
| `components/messages/MessageItem.tsx` | 119 | SolidJS `<Switch>`/`<Match>`, no `React.memo` needed |
| `components/messages/AssistantMessage.tsx` | 23 | `<code filetype="markdown">` replaces custom Markdown |
| `components/messages/UserMessage.tsx` | 21 | `<box border={["left"]}><text>` |
| `components/messages/ToolResultLine.tsx` | 86 | Same logic, `<text>` instead of `<Text>` |
| `components/messages/ToolInvocationBlock.tsx` | 39 | Same logic, Solid JSX |
| `components/messages/ThinkingIndicator.tsx` | 27 | Same logic, Solid JSX |
| `components/bars/InputBox.tsx` | 161 | OpenTUI `<textarea>` + `useKeyboard` |
| `components/bars/FooterBar.tsx` | 36 | Trivial `<box><text>` |
| `components/bars/StatusBar.tsx` | 49 | Trivial `<box><text>` |
| `components/bars/PermissionPrompt.tsx` | 40 | Trivial `<box><text>` |
| `components/bars/FileDropdown.tsx` | 44 | `<scrollbox>` dropdown with `<Index>` |
| `components/bars/CommandDropdown.tsx` | 115 | `<scrollbox>` dropdown with `<Index>` |
| `components/primitives/ScrollableBox.tsx` | 59 | **Deleted** — native `<scrollbox>` replaces this |
| `components/primitives/Markdown.tsx` | 129 | **Deleted** — OpenTUI has built-in `<code filetype="markdown">` |
| `components/primitives/TreeLine.tsx` | 33 | Same logic, Solid JSX |
| `components/primitives/Icon.tsx` | 36 | Same logic, Solid JSX |

---

## Dependency changes

### Remove
```
ink
react
@types/react
ink-testing-library
```

### Add
```
@opentui/core
@opentui/solid
solid-js
```

### tsconfig.json changes
```jsonc
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "@opentui/solid"
  }
}
```

### bunfig.toml
```toml
preload = ["@opentui/solid/preload"]
```

---

## Architecture mapping

### React → SolidJS cheat sheet

| React | SolidJS |
|-------|---------|
| `useState(x)` | `createSignal(x)` → `[get, set]` |
| `useReducer(reducer, init)` | `createStore(init)` + mutation functions |
| `useEffect(() => {}, [deps])` | `createEffect(() => { /* auto-tracks */ })` |
| `useRef(x)` | `let x: Type` (plain variable) |
| `useCallback(fn, [deps])` | `const fn = () => {}` (closures are stable) |
| `React.memo(Component)` | Not needed — components run once, signals update DOM |
| `useImperativeHandle` | Direct variable assignment (`let scroll: ScrollBoxRenderable`) |
| `{items.map(fn)}` | `<For each={items()}>{fn}</For>` |
| `condition && <X/>` | `<Show when={condition()}><X/></Show>` |
| `<>{a}{b}</>` | `<>{a}{b}</>` (same) |

### Ink → OpenTUI element mapping

| Ink | OpenTUI |
|-----|---------|
| `<Box>` | `<box>` |
| `<Text>` | `<text>` |
| `<Text bold>` | `<text attributes={TextAttributes.BOLD}>` |
| `<Text color="red">` | `<text fg={RGBA.fromHex("#ff0000")}>` or `<text fg="red">` |
| `borderStyle="round"` | `border={["top","right","bottom","left"]}` |
| `useInput(fn)` | `useKeyboard(fn)` |
| `useStdout()` | `useTerminalDimensions()` |
| `render(<App/>)` (ink) | `render(() => <App/>)` (@opentui/solid) |
| N/A | `<scrollbox>` (native, no equivalent in Ink) |
| N/A | `<code filetype="markdown">` (native markdown) |
| `measureElement` | Not needed — Zig core measures internally |

---

## Migration phases

### Phase 0 — Scaffold (0.5 day)
**Goal:** Bootable empty OpenTUI app that renders "Hello Quark" and exits on Ctrl+C.

1. `bun add @opentui/core @opentui/solid solid-js`
2. Update `tsconfig.json` (jsx, jsxImportSource)
3. Add `bunfig.toml` preload
4. Create `src/tui-solid/index.tsx`:
   ```tsx
   import { render, useKeyboard, useTerminalDimensions } from "@opentui/solid"
   
   function App() {
     const dims = useTerminalDimensions()
     return (
       <box width={dims().width} height={dims().height}>
         <text>Hello Quark</text>
       </box>
     )
   }
   
   render(() => <App />, { targetFps: 60, exitOnCtrlC: true })
   ```
5. Run with `bun src/tui-solid/index.tsx` — verify it renders and exits.
6. Keep `src/tui/` untouched during migration — both can coexist.

**Verify:** App renders, fills terminal, Ctrl+C exits cleanly.

---

### Phase 1 — State layer (0.5 day)
**Goal:** Port state management from React reducer to SolidJS signals.

1. Create `src/tui-solid/state.ts`:
   - Reuse `TuiMessage`, `TuiPart`, `TuiStatus`, `PermissionRequest` types as-is
   - Reuse `dbToTuiMessages()` as-is
   - Replace `useReducer` with a store:
     ```tsx
     import { createSignal } from "solid-js"
     import { createStore, produce } from "solid-js/store"
     
     export function createAppState(initial: { sessionId: string | null; modelName: string; skillCount: number }) {
       const [messages, setMessages] = createStore<TuiMessage[]>([])
       const [running, setRunning] = createSignal(false)
       const [status, setStatus] = createStore<TuiStatus>({
         tokensUsed: 0, tokenLimit: 168_000, cost: 0,
         modelName: initial.modelName, skillCount: initial.skillCount,
       })
       const [sessionId, setSessionId] = createSignal(initial.sessionId)
       const [error, setError] = createSignal<string>()
       const [permission, setPermission] = createSignal<PermissionRequest>()
       
       return { messages, setMessages, running, setRunning, status, setStatus,
                sessionId, setSessionId, error, setError, permission, setPermission }
     }
     ```
   - Key difference: `setMessages` with `produce()` for granular mutations (no
     immutable spread chains — SolidJS store tracks nested paths).

2. Create `src/tui-solid/events.ts`:
   - Same event wiring as `useEventBus.ts` but using `createEffect` + `onCleanup`:
     ```tsx
     export function wireEvents(state: ReturnType<typeof createAppState>) {
       createEffect(() => {
         const sid = state.sessionId()
         if (!sid) return
         
         const unsubs: (() => void)[] = []
         // ... same bus.on() calls but mutate store directly ...
         unsubs.push(on("text-delta", (data) => {
           state.setMessages(
             (m) => m.id === data.messageId,
             "parts", (parts) => parts.length - 1,
             "text", data.text
           )
         }))
         
         onCleanup(() => unsubs.forEach(fn => fn()))
       })
     }
     ```
   - The critical win: `text-delta` updates a single nested path in the store →
     only the `<text>` node for that part re-renders (not the entire message list).

**Verify:** Import and call `createAppState()` in the scaffold app. Log signal reads.

---

### Phase 2 — Message scrollbox (1 day)
**Goal:** Render messages in a native `<scrollbox>` with smooth scrolling.

1. Create `src/tui-solid/components/MessageItem.tsx`:
   - Port `MessageItem`, `UserMessage`, `AssistantMessage`, `ToolResultLine`,
     `ToolInvocationBlock`, `ThinkingIndicator` as SolidJS components.
   - Use `<Switch>`/`<Match>` instead of switch statements.
   - Use `<code filetype="markdown" content={text} streaming={true}>` for
     assistant text — **delete** the custom `Markdown.tsx` / `MarkdownBlock`.
   - No `React.memo` needed — components only run once, signals update the DOM.

2. Wire into root App:
   ```tsx
   let scroll: ScrollBoxRenderable
   
   <scrollbox
     ref={(r) => scroll = r}
     stickyScroll={true}
     stickyStart="bottom"
     flexGrow={1}
     scrollAcceleration={new CustomSpeedScroll(3)}
   >
     <For each={state.messages}>
       {(msg) => <MessageItem message={msg} />}
     </For>
   </scrollbox>
   ```

3. **Delete** these files (no longer needed):
   - `ScrollableBox.tsx` — native scrollbox replaces it
   - `MessagePane.tsx` — native scrollbox replaces it  
   - `MessageList.tsx` — inlined above
   - `Markdown.tsx` — native `<code filetype="markdown">` replaces it
   - `useMouseScroll.ts` — OpenTUI handles mouse natively

4. Add keyboard scrolling:
   ```tsx
   useKeyboard((evt) => {
     if (evt.name === "up") scroll.scrollBy(-3)
     if (evt.name === "down") scroll.scrollBy(3)
   })
   ```

**Verify:** Messages render. Mouse wheel scrolls smoothly. Arrow keys scroll.
Auto-scrolls to bottom on new messages. No jank.

---

### Phase 3 — Input + dropdowns (1 day)
**Goal:** Port InputBox, FileDropdown, CommandDropdown.

1. Create `src/tui-solid/components/Prompt.tsx`:
   - Use OpenTUI's `<textarea>` renderable for text input (handles cursor,
     selection, multi-line natively).
   - Or: use a simple `<box>` with `useKeyboard` and `createSignal` for the
     input value (simpler, matches current controlled-input pattern).
   - Port `InputBox` status line as a `<box>` with `<text>` segments.

2. Create `src/tui-solid/components/Autocomplete.tsx`:
   - Combine `FileDropdown` + `CommandDropdown` into one component
     (like opencode's `autocomplete.tsx`).
   - Use a `<scrollbox>` for the dropdown list.
   - Position with `position="absolute"` relative to the input anchor.
   - Use `<Index each={options()}>` for the filtered list.
   - Reuse `filelist.ts` (fuzzy filter) and `commands.ts` unchanged.

3. Wire `useKeyboard` for slash/mention navigation:
   - Up/Down navigate dropdown
   - Tab/Enter select
   - Escape dismiss
   - `@` triggers file autocomplete
   - `/` at position 0 triggers command autocomplete

**Verify:** Type `@` → file dropdown appears. Type `/` → command dropdown appears.
Navigation with arrows works. Selection inserts text.

---

### Phase 4 — Permission, footer, global keys (0.5 day)
**Goal:** Port remaining UI chrome.

1. `PermissionPrompt.tsx` → trivial `<box>` + `<text>` port.
2. `FooterBar.tsx` → trivial `<box>` + `<text>` port.
3. Global keyboard handling:
   ```tsx
   useKeyboard((evt) => {
     if (state.permission()) {
       if (evt.name === "a") { respondPermission(...); ... }
       // ...
       evt.preventDefault()
       return
     }
     if (evt.ctrl && evt.name === "c") { renderer.destroy(); ... }
     if (evt.name === "escape" && state.running()) { onCancel(...) }
   })
   ```

**Verify:** Permission prompt renders and responds to a/o/r keys.
Esc cancels running agent. Ctrl+C exits.

---

### Phase 5 — Entry point + integration (0.5 day)
**Goal:** Wire everything together and make it the default.

1. Port `src/tui-solid/index.tsx`:
   - Same backend wiring as current `index.tsx`
   - `render(() => <App />, { targetFps: 60, exitOnCtrlC: false })`
   - Pass `onSubmit`, `onCancel`, `onCommand` as context or props

2. Update `index.ts` (project root) to use `src/tui-solid/index.tsx`.

3. Remove old `src/tui/` directory entirely.

4. Update `package.json` — remove `ink`, `react`, `@types/react`, `ink-testing-library`.

**Verify:** Full end-to-end: start app → type prompt → agent runs → tools display →
scroll through messages → permission prompt → cancel → exit.

---

### Phase 6 — Polish (0.5 day)
**Goal:** Feature parity and cleanup.

- [ ] Theme: convert color strings to `RGBA.fromHex()` where needed
- [ ] Session picker: `/sessions` opens scrollbox picker
- [ ] Model picker: `/model` opens scrollbox picker  
- [ ] Terminal resize: `useTerminalDimensions()` auto-handles this
- [ ] Scrollbar styling: match current aesthetics
- [ ] Cursor style: blinking line in input area
- [ ] Test: manual walkthrough of all features
- [ ] Remove `src/tui/` directory and old dependencies

---

## Total estimated effort

| Phase | Effort | Cumulative |
|-------|--------|-----------|
| 0 — Scaffold | 0.5 day | 0.5 day |
| 1 — State | 0.5 day | 1 day |
| 2 — Messages + scrollbox | 1 day | 2 days |
| 3 — Input + dropdowns | 1 day | 3 days |
| 4 — Permission + footer | 0.5 day | 3.5 days |
| 5 — Entry point | 0.5 day | 4 days |
| 6 — Polish | 0.5 day | 4.5 days |
| **Total** | **~4.5 days** | |

---

## Risk areas

1. **OpenTUI's `<textarea>` renderable** — current InputBox is a simple controlled
   text field. OpenTUI's textarea is more capable (cursor positioning, selection,
   multi-line) but has a different API. May need adjustment.

2. **Markdown rendering quality** — OpenTUI's built-in `<code filetype="markdown">`
   uses tree-sitter. Verify it handles streaming partial markdown gracefully
   (the `streaming={true}` prop should handle this).

3. **Bun-only** — OpenTUI requires Bun. Already using Bun, so no issue, but
   worth noting the hard lock-in.

4. **Zig build dependency** — `@opentui/core` includes prebuilt native binaries
   for common platforms. If targeting an exotic platform, Zig must be installed.

5. **Testing** — `ink-testing-library` is removed. OpenTUI doesn't have an equivalent
   test renderer yet. Unit test strategy TBD (may need to test at the signal/state
   level rather than component level).

---

## File structure after migration

```
src/tui/
  index.tsx              — entry point (render + backend wiring)
  app.tsx                — root component (layout, scrollbox, keyboard)
  state.ts               — SolidJS signals/store (types + createAppState)
  events.ts              — event bus → store wiring
  theme.ts               — colors/icons (unchanged)
  commands.ts            — slash commands (unchanged)
  filelist.ts            — file listing + fuzzy (unchanged)
  components/
    message-item.tsx     — message dispatcher (user/assistant/tool)
    user-message.tsx     — user message with border
    assistant-message.tsx — assistant text (uses <code filetype="markdown">)
    tool-result.tsx      — completed tool line
    tool-invocation.tsx  — running tool block
    thinking.tsx         — thinking indicator
    prompt.tsx           — input area with status
    autocomplete.tsx     — @file and /command dropdown
    permission.tsx       — permission prompt
    footer.tsx           — footer bar
```

**17 files** (down from 26). ~1,800 lines estimated (down from ~2,600).
