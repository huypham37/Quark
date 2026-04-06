# `--path` Flag — Research & Implementation Spec

## Why This Feature Exists

When using Quark remotely (e.g. from a phone), you cannot `cd` into a project directory before launching the agent. The agent starts from whatever `process.cwd()` happens to be on the server — likely `/root` or `/home/user` — and finds nothing: no `.quark/config.yaml`, no `AGENTS.md`, no project files.

`--path` solves this by letting you point the agent at a project directory explicitly:

```bash
quark --path /home/user/projects/myapp --prompt "fix the bug"
```

This is equivalent to:

```bash
cd /home/user/projects/myapp && quark --prompt "fix the bug"
```

It is **not** a security sandbox. It is a project pointer.

---

## What It Is NOT — Comparison with Claude Code / Codex

During research, two other concepts came up that look similar but are fundamentally different.

### Claude Code Sandboxing (`@anthropic-ai/sandbox-runtime`)

Claude Code wraps every bash subprocess inside an OS-level security boundary before it even starts:

- **macOS**: Uses `sandbox-exec` (Apple Seatbelt). A kernel policy profile is injected at process spawn time. The kernel intercepts every `open()`, `write()`, `connect()` syscall the child makes and checks it against the policy. The process cannot bypass this.
- **Linux**: Uses `bubblewrap` — a new Linux namespace (like a mini container without Docker) where the filesystem is reconstructed with only allowed bind-mounts. The child process literally cannot see paths that were not mounted in.
- **Network**: A proxy server runs on the host. The sandbox profile only allows the child to reach `localhost:PROXY_PORT`. All traffic is routed through the proxy which enforces a domain allowlist. On Linux, the network namespace is removed entirely.

### Codex CLI Sandboxing

Same approach as Claude Code but adds two more Linux-specific layers on top:

- **Landlock** (Linux 5.13+): A kernel LSM. Codex calls `landlock_restrict_self()` on itself before forking any subprocess. Once called, it cannot be undone — the process and all its children are locked to declared paths at kernel level.
- **seccomp BPF**: A Berkeley Packet Filter program installed via `prctl(PR_SET_SECCOMP)` that blocks network syscalls (`socket()`, `connect()`) entirely at the kernel level.

So on Linux, Codex has three layers: Landlock + seccomp + bubblewrap.

### The Key Difference

| | Quark `--path` | Claude Code / Codex sandbox |
|---|---|---|
| **Purpose** | Point agent at a project directory | Protect the host from a compromised agent |
| **Where enforcement happens** | Process-wide setting (replaces `process.cwd()`) | OS kernel (syscall interception) |
| **Can bash escape it?** | Yes — bash tool runs freely | No — kernel blocks the syscall before it completes |
| **Applies to subprocesses?** | N/A | Yes — all children inherit kernel restrictions |
| **Stops prompt injection?** | No | Yes |
| **Implementation** | Replace `process.cwd()` in ~10 call sites | Separate sandbox runtime, OS-specific code, proxy server, BPF filters |

**Quark `--path` is a convenience feature. Claude Code/Codex sandboxing is a security feature. They solve different problems.**

---

## Current State of the Codebase

Every place that needs to know "where is the project" currently calls `process.cwd()`. There are 10 such call sites:

| File | Line | What it does |
|---|---|---|
| `src/session/system.ts` | L88 | Injects `Working directory: X` into the system prompt |
| `src/session/system.ts` | L106 | Resolves `AGENTS.md` from project root |
| `src/session/session.ts` | L70 | Stores `directory` in session metadata |
| `src/profile/profile.ts` | L79 | Resolves `.quark/` project config dir |
| `src/skill/skill.ts` | L95 | Discovers `.quark/skills/` |
| `src/plugin/loader.ts` | L61 | Passes `directory` to plugin context |
| `src/tui/filelist.ts` | L14 | Lists files for `@mention` autocomplete |
| `src/tui/components/App.tsx` | L569 | Resolves `@file` mentions to absolute paths |
| `src/tui/components/footer-bar.tsx` | L43 | Displays cwd in the footer |
| `~/.config/quark/tools/glob.ts` | L15 | Default `cwd` for glob searches |
| `~/.config/quark/tools/grep.ts` | L37 | Default `searchPath` for ripgrep |
| `~/.config/quark/tools/bash.ts` | L64 | Default `cwd` for shell commands |

Also notable: `session.directory` is persisted to JSONL storage but **never read back** to influence anything. It is currently dead metadata.

---

## Intended Behavior

1. **If `--path` is provided**: validate it exists (error and exit if not), resolve to absolute, use it everywhere instead of `process.cwd()`.
2. **If `--path` is not provided**: behave exactly as today — use `process.cwd()`.
3. **TUI mode**: `--path` is a CLI-only flag. The TUI (`quark` with no prompt) is out of scope — users of the TUI can `cd` themselves.

All 10 call sites above should respect the active path. There is no distinction between "config discovery" and "agent workspace" — `--path` IS the project root, full stop.

---

## Implementation Plan

### 1. `src/path-context.ts` — new file, single source of truth

```ts
let rootPath: string | null = null

export function setRootPath(dir: string): void {
  rootPath = dir
}

export function getRootPath(): string {
  return rootPath ?? process.cwd()
}
```

A single module that the CLI sets once at startup. Everything else imports `getRootPath()` instead of calling `process.cwd()` directly.

### 2. `src/cli.ts` — parse and validate `--path`

- Add `path` to `parseArgs` options
- After parsing: resolve to absolute, check `fs.existsSync`, exit with error if missing
- Call `setRootPath(resolved)` before bootstrap
- Add to `printHelp()`

### 3. Replace all `process.cwd()` call sites

| File | Change |
|---|---|
| `src/session/system.ts` | L88, L106 → `getRootPath()` |
| `src/session/session.ts` | L70 → `getRootPath()` |
| `src/profile/profile.ts` | L79 → `getRootPath()` |
| `src/skill/skill.ts` | L95 → `getRootPath()` |
| `src/plugin/loader.ts` | L61 → `getRootPath()` |
| `src/tui/filelist.ts` | L14 → `getRootPath()` |
| `src/tui/components/App.tsx` | L569 → `getRootPath()` |
| `src/tui/components/footer-bar.tsx` | L43 → `getRootPath()` |

### 4. External tools — out of scope for now

`bash.ts`, `glob.ts`, `grep.ts` live in `~/.config/quark/tools/` and are user-owned. They already accept an explicit `cwd` parameter from the LLM. Since the system prompt tells the model `Working directory: <path>`, the model will naturally pass the correct `cwd` when invoking these tools. No changes needed.

---

## What Does Not Change

- No path guard / boundary enforcement — that is sandboxing, a different feature
- No `ToolContext` changes
- No permission system changes
- TUI behavior is unchanged
- External tools are unchanged
