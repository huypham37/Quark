import type { JSONObject } from "@ai-sdk/provider"
import type { CatalogModel } from "./catalog-snapshot"
import type { ProviderDefinition } from "./definitions"
import type { ProviderOptions, ReasoningRequestConfig } from "./registry"

function optionFor(model: CatalogModel, type: "effort" | "toggle" | "budget_tokens") {
  return model.reasoning_options?.find((option) => option.type === type)
}

function unsupported(model: CatalogModel): never {
  throw new Error(`Reasoning is not supported by catalog model "${model.id}".`)
}

function validateBudget(model: CatalogModel, budget: number | undefined): number {
  const option = optionFor(model, "budget_tokens")
  if (!option || option.type !== "budget_tokens" || budget === undefined) return unsupported(model)
  if (option.min !== undefined && option.min >= 0 && budget < option.min) {
    throw new Error(`Reasoning budget ${budget} is below the minimum for model "${model.id}".`)
  }
  if (option.max !== undefined && budget > option.max) {
    throw new Error(`Reasoning budget ${budget} exceeds the maximum for model "${model.id}".`)
  }
  return budget
}

function encodeFields(
  definition: ProviderDefinition,
  model: CatalogModel,
  config: ReasoningRequestConfig,
): JSONObject | undefined {
  if (config.effort === "none") return undefined
  if (!model.reasoning) return unsupported(model)

  const effort = optionFor(model, "effort")
  const toggle = optionFor(model, "toggle")
  const budget = optionFor(model, "budget_tokens")
  if (config.modeExplicit) {
    throw new Error(`Reasoning modes are not supported by catalog model "${model.id}".`)
  }

  if (config.budgetTokens !== undefined && budget?.type === "budget_tokens") {
    validateBudget(model, config.budgetTokens)
    return { thinking: { type: "enabled", budget_tokens: config.budgetTokens } }
  }

  if (effort?.type === "effort") {
    const values = effort.values.filter((value): value is string => typeof value === "string")
    if (!values.includes(config.effort)) {
      throw new Error(`Invalid reasoning effort "${config.effort}" for model "${model.id}".`)
    }
  } else if (toggle?.type === "toggle") {
    if (config.effort !== "thinking") {
      throw new Error(`Invalid reasoning effort "${config.effort}" for toggle model "${model.id}".`)
    }
  } else {
    return unsupported(model)
  }
  if (toggle?.type === "toggle" && !effort) return { enable_thinking: true }

  if (definition.protocol === "anthropic") {
    return { thinking: { type: "adaptive" }, effort: config.effort }
  }
  return { reasoningEffort: config.effort, reasoningSummary: "auto" }
}

export function encodeCatalogReasoning(input: {
  definition: ProviderDefinition
  model: CatalogModel
  config: ReasoningRequestConfig
}): ProviderOptions | undefined {
  const fields = encodeFields(input.definition, input.model, input.config)
  return fields ? { [input.definition.providerOptionsKey]: fields } : undefined
}
