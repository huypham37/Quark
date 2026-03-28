# Plugin System for Atom

## What We're Building

A plugin system where users drop `.ts` files in `~/.config/atom/plugins/`.
Each plugin returns a dictionary of `{ "event-name": function }`.
Atom calls those functions at the right moments in its code.

## Architecture (3 new files)

```
src/plugin/
  plugin.ts      ← the PluginDef interface (what a plugin returns)
  registry.ts    ← stores all hooks from all plugins
  loader.ts      ← scans ~/.config/atom/plugins/, imports, collects hooks
```

## Step 1: Define the Plugin Interface

**File: `src/plugin/plugin.ts`**

```ts
// What the plugin function receives
interface PluginContext {
  directory: string    // current working directory
  sessionId?: string   // active session if any
}

// All possible hook names and their input/output shapes
interface PluginHooks {
  // --- Provider hooks ---
  "provider.request.before": {
    input:  { provider: string; model: string; messages: any[] }
    output: { provider: string; model: string }  // plugin can change these
  }
  "provider.request.error": {
    input:  { provider: string; model: string; error: unknown; statusCode?: number }
    output: { retry: boolean; provider?: string; model?: string }
  }

  // --- Session hooks ---
  "session.created":   { input: { sessionId: string } }
  "session.idle":      { input: { sessionId: string } }
  "session.error":     { input: { sessionId: string; error: unknown } }
  "session.compacting": {
    input:  { sessionId: string }
    output: { context: string[] }  // inject extra context into compaction
  }

  // --- Tool hooks ---
  "tool.execute.before": {
    input:  { tool: string; args: Record<string, unknown> }
    output: { args: Record<string, unknown> }  // plugin can modify args
  }
  "tool.execute.after": {
    input:  { tool: string; args: Record<string, unknown>; result: string }
    output: {}
  }

  // --- Loop hooks ---
  "loop.step.before": { input: { sessionId: string; step: number } }
  "loop.step.after":  { input: { sessionId: string; step: number; result: "continue" | "stop" } }
}

// A plugin = async function that returns hooks
type PluginFn = (ctx: PluginContext) => Promise<Partial<{
  [K in keyof PluginHooks]: (
    input: PluginHooks[K]["input"],
    output: PluginHooks[K]["output"]
  ) => Promise<void>
}>>
```

## Step 2: Build the Registry

**File: `src/plugin/registry.ts`**

The registry is simple: a `Map<string, Function[]>`.

```
"provider.request.error" → [pluginA_fn, pluginB_fn]
"session.idle"           → [pluginC_fn]
"tool.execute.before"    → [pluginA_fn, pluginC_fn]
```

Key function:

```ts
async function fireHook(name, input) {
  const output = { ...defaults }       // mutable output object
  for (const fn of hooks[name]) {
    await fn(input, output)            // each plugin can mutate output
  }
  return output                        // caller uses the final output
}
```

## Step 3: Build the Loader

**File: `src/plugin/loader.ts`**

Same pattern as `src/tool/loader.ts`:

```
1. Scan ~/.config/atom/plugins/*.ts
2. For each file:
   a. await import(filePath)
   b. Grab the export (default or named)
   c. Call it with PluginContext → get hooks back
   d. Store each hook in the registry
3. Report loaded/errors
```

## Step 4: Wire into Bootstrap

**File: `src/bootstrap.ts`** (edit existing)

Add after tool loading:

```ts
import { loadPlugins } from "./plugin/loader"

// In bootstrap():
await loadPlugins()
```

## Step 5: Add `fireHook()` Calls in Existing Code

These are the exact locations where we insert hook calls:

### 5a. Provider fallback (`src/session/prompt.ts`)

In `resolveModel()` — wrap the provider call:

```
BEFORE: return getModel(provider, modelId)
AFTER:  
  const output = await fireHook("provider.request.before", { provider: providerId, model: modelId })
  return getModel(resolvedProvider, output.model)
```

### 5b. Provider error retry (`src/session/processor.ts`)

In the `catch` block of `processStream()`, around line 258:

```
BEFORE: if (isRetryable(e)) { attempt++; ... }
AFTER:
  const output = await fireHook("provider.request.error", {
    provider, model, error: e, statusCode: e.status
  })
  if (output.retry) {
    // rebuild model with output.provider, retry
    continue
  }
  if (isRetryable(e)) { attempt++; ... }
```

### 5c. Session lifecycle (`src/session/prompt.ts`)

```
line 77:  bus.emit("session-created") → also fireHook("session.created")
line 108: bus.emit("loop-end")        → also fireHook("session.idle")
line 286: bus.emit("error")           → also fireHook("session.error")
```

### 5d. Tool interception (`src/session/prompt.ts`)

In `toAITool()`, wrap the execute function (around line 359):

```
BEFORE: return def.execute(args, ctx)
AFTER:
  const before = await fireHook("tool.execute.before", { tool: def.id, args })
  const result = await def.execute(before.args, ctx)
  await fireHook("tool.execute.after", { tool: def.id, args, result: result.output })
  return result
```

### 5e. Loop steps (`src/session/prompt.ts`)

In `loop()`, around lines 148-264:

```
while (true) {
  await fireHook("loop.step.before", { sessionId, step })
  // ... existing code ...
  await fireHook("loop.step.after", { sessionId, step, result })
}
```

## Step 6: Config Support (optional)

Add to `config.yaml`:

```yaml
plugins:
  - "rate-limit-fallback"       # loads ~/.config/atom/plugins/rate-limit-fallback.ts
  - "opencode-wakatime"         # future: npm package support
```

## Implementation Order

1. `src/plugin/plugin.ts` — define the interface (5 min)
2. `src/plugin/registry.ts` — store hooks + `fireHook()` (15 min)
3. `src/plugin/loader.ts` — scan directory, import, collect (15 min)
4. Edit `src/bootstrap.ts` — call `loadPlugins()` (2 min)
5. Edit `src/session/prompt.ts` — add hook calls at 5 locations (20 min)
6. Edit `src/session/processor.ts` — add provider error hook (10 min)
7. Test with a sample plugin (10 min)

## Example Plugin: Rate Limit Fallback

```ts
// ~/.config/atom/plugins/rate-limit-fallback.ts

export default async (ctx) => {
  return {
    "provider.request.error": async (input, output) => {
      if (input.statusCode === 429) {
        console.log(`[fallback] ${input.provider} rate limited, switching...`)
        output.retry = true
        output.provider = "ollama"
      }
    }
  }
}
```

## What This Does NOT Cover (Future)

- npm plugin packages (like OpenCode's `"plugin": ["pkg-name"]`)
- Plugin dependencies on each other
- Plugin config/settings
- Custom tools via plugins (we already have `~/.config/atom/tools/`)
- TUI hooks (tui.command.execute, etc.)
