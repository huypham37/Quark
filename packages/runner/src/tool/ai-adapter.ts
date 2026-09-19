import { jsonSchema, tool, type ToolExecutionOptions, type ToolSet } from "ai"
import { z } from "zod"
import { extractFilePath, toolPreExecute } from "../commands/undo"
import { globalHooks, type HookRegistry } from "../plugin/registry"
import { bus, type TypedBus } from "../session/events"
import type { ToolDef } from "./tool"
import { buildSkillTool } from "./skill"
import type { SkillDefinition } from "../skill/skill"

/**
 * Explicit inputs for {@link resolveToolSet}.
 *
 * An {@link import("../agent").AgentDefinition} is structurally assignable to
 * this shape, so an agent's concrete tools are used as-is and stay
 * instance-scoped — they are never registered in the global tool registry.
 */
export interface ResolveToolSetInput {
  /** Concrete tool definitions, used as-is */
  tools?: ToolDef[]
  /** Concrete skill definitions; a `skill` tool is synthesized when absent */
  skills?: SkillDefinition[]
}

export function resolveToolSet(
  input: ResolveToolSetInput,
  sessionId: string,
  messageId: string,
  abort: AbortSignal,
  eventBus: TypedBus = bus,
  hooks: HookRegistry = globalHooks,
  /** Run policy — portable runs disable undo snapshots (`undo: false`). */
  policy?: { undo?: boolean },
): ToolSet {
  const defs: ToolDef[] = [...(input.tools ?? [])]
  if (input.skills && input.skills.length > 0 && !defs.some((d) => d.id === "skill")) {
    defs.push(buildSkillTool(undefined, input.skills))
  }
  const result: ToolSet = {}
  const undo = policy?.undo !== false

  for (const def of defs) {
    result[def.id] = toAITool(def, sessionId, messageId, abort, eventBus, hooks, undo)
  }

  return result
}

function abortSignalToPromise(signal: AbortSignal): Promise<never> {
  if (signal.aborted) {
    return Promise.reject(
      Object.assign(new Error("This operation was aborted"), { name: "AbortError" }),
    )
  }
  return new Promise<never>((_, reject) => {
    signal.addEventListener(
      "abort",
      () => {
        reject(
          Object.assign(new Error("This operation was aborted"), { name: "AbortError" }),
        )
      },
      { once: true },
    )
  })
}

function toAITool(
  def: ToolDef,
  sessionId: string,
  messageId: string,
  abort: AbortSignal,
  eventBus: TypedBus,
  hooks: HookRegistry,
  undo: boolean,
) {
  const schema = z.toJSONSchema(def.parameters)

  return tool({
    description: def.description,
    inputSchema: jsonSchema(schema as any),
    async execute(args: any, options: ToolExecutionOptions) {
      const callId = options.toolCallId
      const abortSig = options.abortSignal ?? abort

      // Parse arguments first — no side effects, so this is safe
      const parseResult = def.parameters.safeParse(args)
      if (!parseResult.success) {
        const msg = parseResult.error.issues
          .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("\n")
        return {
          title: `Invalid arguments for ${def.id}`,
          output: `Invalid arguments for tool "${def.id}":\n${msg}`,
          metadata: { error: "invalid_arguments", issues: parseResult.error.issues },
        }
      }
      const validatedArgs = parseResult.data as Record<string, unknown>

      try {
        if (undo) {
          const fp = extractFilePath(def.id, validatedArgs)
          if (fp) await toolPreExecute(sessionId, fp)
        }
      } catch {
        // Snapshot failure is best-effort.
      }

      eventBus.emit("tool-running", { sessionId, messageId, callId })

      const ctx = {
        sessionId,
        messageId,
        callId,
        abort: abortSig,
        bus: eventBus,
      }

      const beforeArgs = await hooks.fire(
        "tool.execute.before",
        { tool: def.id, args: validatedArgs },
        { args: validatedArgs },
      )
      const toolResult = await Promise.race([
        def.execute(beforeArgs.args as any, ctx),
        abortSignalToPromise(abortSig),
      ])
      await hooks.fire("tool.execute.after", {
        tool: def.id,
        args: beforeArgs.args,
        result: (toolResult as any).output ?? "",
      })
      return toolResult
    },
    toModelOutput(result: any) {
      if (Array.isArray(result.output)) {
        return {
          type: "content" as const,
          value: result.output,
        }
      }
      return {
        type: "text" as const,
        value: result.output as string,
      }
    },
  })
}
