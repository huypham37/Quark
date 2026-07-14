import type { LanguageModel, ModelMessage } from "ai"
import { loadConfig } from "../config/config"
import { setForceAgent } from "../provider/custom-fetch"
import { getModelLimit } from "../provider/models"
import {
  autoBranch,
  shouldBranchWithRealTokens,
  type BranchResult,
} from "./branch"
import type { MessageRow, PartRow } from "./message"

export function shouldAutoBranch(input: {
  system: string[]
  modelMessages: ModelMessage[]
  modelLimit: ReturnType<typeof getModelLimit>
  parts: PartRow[]
}): boolean {
  const cfg = loadConfig()
  return cfg.branching.auto && shouldBranchWithRealTokens(
    input.system,
    input.modelMessages,
    input.modelLimit,
    cfg.branching.threshold,
    input.parts,
  )
}

export async function createAutoBranch(input: {
  sessionId: string
  messages: MessageRow[]
  parts: PartRow[]
  model: LanguageModel
  profile: string
  abort: AbortSignal
  prompt?: string
}): Promise<BranchResult> {
  setForceAgent(true)
  try {
    return await autoBranch(input)
  } finally {
    setForceAgent(false)
  }
}
