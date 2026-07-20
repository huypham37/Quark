import { z } from "zod"
import { loadProfileConfig } from "../profile/profile"
import { runSubagent } from "../subagent/supervisor"
import { defineTool } from "./tool"

export function createSubagentTool(allowedProfiles: string[]) {
  const allowed = new Set(allowedProfiles)
  return defineTool({
    id: "subagent",
    description: `Delegate a focused task to an isolated subagent. Available profiles: ${allowedProfiles.join(", ")}. The child resolves its own tools, skills, model, and permissions.`,
    parameters: z.object({
      profile: z.string().min(1).describe("An available subagent profile ID"),
      prompt: z.string().min(1).describe("A complete, self-contained task for the subagent"),
    }).strict(),
    async execute(args, ctx) {
      if (!allowed.has(args.profile)) {
        throw new Error(`Subagent profile "${args.profile}" is not allowed. Available profiles: ${allowedProfiles.join(", ")}`)
      }
      if (!loadProfileConfig().profiles[args.profile]) {
        throw new Error(`Subagent profile "${args.profile}" does not exist`)
      }

      const result = await runSubagent(args, ctx)
      return {
        title: `Subagent: ${args.profile}`,
        output: result.output,
        metadata: {
          subAgent: {
            profile: args.profile,
            prompt: args.prompt,
            childSessionId: result.childSessionId,
            modelName: result.modelName,
            tokenLimit: result.tokenLimit,
          },
        },
      }
    },
  })
}
