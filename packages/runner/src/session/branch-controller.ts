import type { LanguageModel, ModelMessage } from "ai"
import type { BranchingConfig } from "./policies"
import { setForceAgent } from "../provider/custom-fetch"
import type { CatalogLimit } from "../provider/catalog-snapshot"
import {
  autoBranch,
  shouldBranchWithRealTokens,
  type BranchResult,
} from "./branch"
import type { MessageRow, PartRow } from "./message"

export function shouldAutoBranch(
  input: {
    system: string[]
    modelMessages: ModelMessage[]
    modelLimit: CatalogLimit | null
    parts: PartRow[]
  },
  branching: BranchingConfig,
): boolean {
  return branching.auto && shouldBranchWithRealTokens(
    input.system,
    input.modelMessages,
    input.modelLimit,
    branching.threshold,
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
}): Promise<BranchResult> {
  setForceAgent(true)
  try {
    return await autoBranch(input)
  } finally {
    setForceAgent(false)
  }
}
