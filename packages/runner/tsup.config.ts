import { defineConfig } from "tsup"

// Every subpath `quark` (and the published surface) imports is built as its own
// entry so the explicit `exports` map in package.json resolves to compiled
// dist for Node consumers. ESM is built with code splitting so modules shared
// across entries — e.g. the event `bus` singleton — stay one instance instead
// of being duplicated per entry.
const subpaths = [
  "src/agent.ts",
  "src/commands/auth.ts",
  "src/commands/export.ts",
  "src/commands/statistics.ts",
  "src/commands/undo.ts",
  "src/debug.ts",
  "src/debug/format-tool-args.ts",
  "src/notification/notification.ts",
  "src/provider/active-providers.ts",
  "src/provider/catalog-registry.ts",
  "src/provider/catalog-runtime.ts",
  "src/provider/catalog-snapshot.ts",
  "src/provider/credential-store.ts",
  "src/provider/credentials.ts",
  "src/provider/definitions.ts",
  "src/provider/oauth-token-files.ts",
  "src/provider/registry.ts",
  "src/provider/resolver.ts",
  "src/session/branch.ts",
  "src/session/context.ts",
  "src/session/event-writer.ts",
  "src/session/events.ts",
  "src/session/live-turn.ts",
  "src/session/message.ts",
  "src/session/prompt.ts",
  "src/session/session.ts",
  "src/session/system.ts",
  "src/shared/conversation-view.ts",
  "src/shared/diff-utils.ts",
  "src/shared/filelist.ts",
  "src/skill/skill.ts",
  "src/storage/session-path.ts",
  "src/storage/session-jsonl.ts",
  "src/subagent/protocol.ts",
  "src/tool/look.ts",
  "src/tool/question.ts",
  "src/tool/read.ts",
  "src/tool/skill.ts",
  "src/tool/subagent.ts",
  "src/tool/tool.ts",
  "src/worktree/worktree.ts",
]

export default defineConfig([
  {
    entry: ["src/index.ts", ...subpaths],
    format: ["esm"],
    dts: false, // Declarations are generated separately with tsc
    clean: true,
    external: [
      // Bun-specific module (shared/filelist); users must run in Bun for it
      "bun",
    ],
    noExternal: [],
    treeshake: true,
    splitting: true,
    sourcemap: true,
    skipNodeModulesBundle: true,
  },
  {
    // CommonJS entry for `require("@quark/runner")`. Self-contained; only the
    // root "." export advertises it.
    entry: ["src/index.ts"],
    format: ["cjs"],
    dts: false,
    clean: false,
    external: ["bun"],
    treeshake: true,
    splitting: false,
    sourcemap: true,
    skipNodeModulesBundle: true,
  },
])
