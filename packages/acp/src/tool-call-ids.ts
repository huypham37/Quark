// ACP tool-call ID remapping (QUA-265).
//
// Providers (Gemini via the AI SDK, OpenAI-compatible gateways) emit
// tool-call ids like `call_0`, `call_1`, … that restart every turn, and replay
// reuses the persisted id. ACP clients (Zed) key tool cards by `toolCallId`, so
// a repeated id mutates a stale card from an earlier turn.
//
// The persisted `PartRow.data.callId` MUST stay the provider's raw id: it is
// fed back to the provider as `toolCallId` on the next request
// (runner/session/message.ts). So the remap lives at the ACP boundary only: a
// connection-scoped registry mints a globally unique `quark-tool-N` per raw id
// (once per turn) for live updates, and a fresh id per stored row for replay.

export interface ToolCallIdScope {
  /** Stable ACP id for a raw provider id seen this turn. */
  forRaw(rawCallId: string): string
}

export interface ToolCallIds {
  /** A fresh scope for one turn (raw ids are only unique within a turn). */
  startTurn(): ToolCallIdScope
  /** Unique id for a replayed, already-complete tool row. */
  fresh(): string
}

export function createToolCallIds(): ToolCallIds {
  let next = 0
  const fresh = () => `quark-tool-${++next}`
  return {
    fresh,
    startTurn() {
      const mapped = new Map<string, string>()
      return {
        forRaw(raw) {
          let id = mapped.get(raw)
          if (!id) {
            id = fresh()
            mapped.set(raw, id)
          }
          return id
        },
      }
    },
  }
}
