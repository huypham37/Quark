// Namespaced debug logging for Quark.
//
// Enable via env var (preferred — survives subprocess spawns, scriptable):
//   QUARK_DEBUG=processor,loop quark ...
//   QUARK_DEBUG=*               (everything)
//   QUARK_DEBUG=-loop           (exclude a namespace; combine with *)
//
// Or use the --verbose CLI flag (enables tool-call + tool-result only).
// For all engine internals use QUARK_DEBUG=* (or QUARK_VERBOSE=1).
//
// Known namespaces (grep `debug("` to find every call site):
//   processor   — fullStream events, finish reasons, return values
//   loop        — agent loop iterations, message counts, processStream result
//   cli         — text-start/delta/end, assistant-message-start/end
//   tool-call   — `[TOOL-CALL] <name>(<args>)` per invocation (args truncated, secrets redacted)
//   tool-result — `[TOOL-RESULT] <name> ok|error …` per completion
//   tool-call:raw — `[TOOL-CALL:RAW] <name> <json>` full untruncated input (no redaction)
//   models      — context window resolution from models.dev
//   context     — context window calc, branching triggers
//   copilot-sse — raw SSE stream tee (very verbose)
//   plugin      — plugin loader output
//
// To add a new namespace: just call `debug("my-namespace")(...args)`.
// Document it in this list and in README.md.

let includes = new Set<string>();
let excludes = new Set<string>();

function reload(): void {
  includes = new Set();
  excludes = new Set();
  const spec = process.env.QUARK_DEBUG ?? "";
  for (const raw of spec.split(",")) {
    const tok = raw.trim();
    if (!tok) continue;
    if (tok.startsWith("-")) excludes.add(tok.slice(1));
    else includes.add(tok);
  }
  // Back-compat: QUARK_VERBOSE=1 turns on everything
  if (process.env.QUARK_VERBOSE) includes.add("*");
}
reload();

function enabledFor(ns: string): boolean {
  if (excludes.has(ns)) return false;
  return includes.has("*") || includes.has(ns);
}

export interface Debugger {
  (...args: unknown[]): void;
  readonly enabled: boolean;
}

/**
 * Create a namespaced debug logger. Output goes to stderr (keeping stdout clean
 * for prompt output) and only fires when the namespace is enabled via
 * `QUARK_DEBUG` or `--verbose`.
 *
 * @example
 *   const dlog = debug("processor")
 *   dlog("event:", event.type)
 *   if (dlog.enabled) doExpensiveDump()
 */
export function debug(ns: string): Debugger {
  const prefix = `[${ns}]`;
  const fn = ((...args: unknown[]) => {
    if (!enabledFor(ns)) return;
    // Inline the prefix into the first arg when it's a string so printf-style
    // format specifiers (%s, %d, …) keep working.
    if (typeof args[0] === "string") {
      console.error(`${prefix} ${args[0]}`, ...args.slice(1));
    } else {
      console.error(prefix, ...args);
    }
  }) as Debugger;
  Object.defineProperty(fn, "enabled", {
    get: () => enabledFor(ns),
  });
  return fn;
}

// ---------------------------------------------------------------------------
// `--verbose` flag — enables user-facing tool-call logging only.
//
// `--verbose` is intended for CLI users who want to see *what the agent is
// doing* (tool name + arguments + result). It deliberately does NOT enable
// engine internals like `processor`, `loop`, `cli`, `models`, `compaction`.
//
// To enable every namespace (engine debugging), set `QUARK_DEBUG=*` directly.
// QUARK_VERBOSE=1 keeps the legacy meaning (everything on).
// ---------------------------------------------------------------------------

const VERBOSE_NAMESPACES = "tool-call,tool-result";

export function setVerbose(v: boolean): void {
  if (v) {
    process.env.QUARK_DEBUG = VERBOSE_NAMESPACES;
    reload();
  }
}

export function isVerbose(): boolean {
  return includes.has("tool-call") || includes.has("*");
}

/** @deprecated Use `debug(ns)` instead. */
export function debugLog(...args: Parameters<typeof console.log>): void {
  if (includes.has("*")) console.log(...args);
}
