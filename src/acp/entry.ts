// ACP entry point — quark acp
//
// Starts a long-lived JSON-RPC 2.0 agent process communicating over stdin/stdout.
// The editor spawns Quark as a subprocess and communicates via NDJSON.
//
// Logs go to stderr. Stdout is strictly for JSON-RPC messages.

import { parseArgs } from "util"
import { createTransport } from "./transport"
import { runAcpAgent } from "./agent"
import { debug } from "../debug"

const dlog = debug("acp")

export async function runAcpEntry(): Promise<void> {
  // Parse --profile from remaining args (after "acp" positional)
  const argv = process.argv.slice(3) // skip "bun run src/cli.ts acp" or "quark acp"
  let profile: string | undefined

  try {
    const { values } = parseArgs({
      args: argv,
      options: { profile: { type: "string", short: "p" } },
      allowPositionals: true,
      strict: false,
    })
    profile = values.profile as string | undefined
  } catch { /* ignore parse errors */ }

  dlog("starting acp agent%s", profile ? ` (profile: ${profile})` : "")

  const transport = createTransport(
    Bun.stdin.stream(),
    new WritableStream<Uint8Array>({
      write(chunk) {
        Bun.stdout.write(chunk)
      },
    }),
  )

  try {
    await runAcpAgent(transport, profile)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    dlog("fatal: %s", msg)
  }
}
