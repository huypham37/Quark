import { describe, expect, test } from "bun:test"
import * as acp from "@agentclientprotocol/sdk"
import { createAcpAgent } from "../../packages/acp/src/index"
import { buildConfigOptions, EFFORT_CONFIG_ID, MODEL_CONFIG_ID, type ModelOption } from "../../packages/acp/src/config-options"
import { MemorySessionStore, type Runner } from "@quark/runner"

const sampleModels: ModelOption[] = [
  { id: "openai/gpt-5.6-luna", name: "GPT-5.6 Luna", providerId: "openai", providerName: "OpenAI" },
  { id: "openai/gpt-5.6-sol", name: "GPT-5.6 Sol", providerId: "openai", providerName: "OpenAI" },
  { id: "anthropic/claude-3-7-sonnet", name: "Claude 3.7 Sonnet", providerId: "anthropic", providerName: "Anthropic" },
]

describe("buildConfigOptions", () => {
  test("returns empty array when models list is empty", () => {
    expect(buildConfigOptions([], "openai/gpt-5.6-luna")).toEqual([])
  })

  test("groups models by provider when multiple providers exist", () => {
    const options = buildConfigOptions(sampleModels, "openai/gpt-5.6-luna")
    expect(options.length).toBe(1)
    const opt = options[0]
    expect(opt.id).toBe(MODEL_CONFIG_ID)
    expect(opt.name).toBe("Model")
    expect(opt.category).toBe("model")
    if (opt.type === "select") {
      expect(opt.currentValue).toBe("openai/gpt-5.6-luna")
      // Should be grouped
      expect(opt.options.length).toBe(2) // openai and anthropic
      const groups = opt.options as acp.SessionConfigSelectGroup[]
      expect(groups[0].group).toBe("openai")
      expect(groups[0].options.length).toBe(2)
      expect(groups[1].group).toBe("anthropic")
      expect(groups[1].options.length).toBe(1)
    } else {
      expect().fail("expected select type")
    }
  })

  test("uses flat options when single provider exists", () => {
    const singleProvider = sampleModels.slice(0, 2)
    const options = buildConfigOptions(singleProvider, "openai/gpt-5.6-luna")
    expect(options.length).toBe(1)
    const opt = options[0]
    if (opt.type === "select") {
      expect(opt.currentValue).toBe("openai/gpt-5.6-luna")
      expect(opt.options.length).toBe(2)
      const flat = opt.options as acp.SessionConfigSelectOption[]
      expect(flat[0].value).toBe("openai/gpt-5.6-luna")
      expect(flat[1].value).toBe("openai/gpt-5.6-sol")
    }
  })
})

describe("thinking-effort config option", () => {
  const effortModels: ModelOption[] = [
    {
      id: "openai/gpt-5.6-luna",
      name: "GPT-5.6 Luna",
      providerId: "openai",
      providerName: "OpenAI",
      thinkingLevels: ["none", "low", "medium", "high"],
    },
    {
      id: "openai/gpt-plain",
      name: "GPT Plain",
      providerId: "openai",
      providerName: "OpenAI",
    },
  ]

  test("advertises an effort select only when the model exposes multiple levels", () => {
    const withEffort = buildConfigOptions(effortModels, "openai/gpt-5.6-luna")
    const effort = withEffort.find((option) => option.id === EFFORT_CONFIG_ID)
    expect(effort?.category).toBe("thought_level")
    if (effort?.type === "select") {
      expect(effort.currentValue).toBe("none")
      expect(effort.options.map((option) => option.value)).toEqual([
        "none",
        "low",
        "medium",
        "high",
      ])
    } else {
      expect().fail("expected an effort select")
    }

    // A model with no verified levels advertises no effort option.
    const withoutEffort = buildConfigOptions(effortModels, "openai/gpt-plain")
    expect(withoutEffort.some((option) => option.id === EFFORT_CONFIG_ID)).toBe(false)
  })

  test("session/set_config_option effort is threaded into the next prompt", async () => {
    let lastPrompt: { model?: string; thinkingEffort?: string } = {}

    const store = new MemorySessionStore()
    const stubRunner: Partial<Runner> = {
      bus: { on: () => {}, off: () => {} } as any,
      store,
      prompt: async (input) => {
        lastPrompt = { model: input.model, thinkingEffort: input.thinkingEffort }
        return { sessionId: input.sessionId ?? "runner-session-1" } as any
      },
    }

    const agent = createAcpAgent({
      store,
      createRunner: () => stubRunner as Runner,
      models: effortModels,
      defaultModel: "openai/gpt-5.6-luna",
      defaultEffort: "medium",
    })

    await acp.client({ name: "test-client" }).connectWith(agent.app, async (ctx) => {
      await ctx.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
      })
      const newSession = await ctx.request(acp.methods.agent.session.new, {
        cwd: process.cwd(),
        mcpServers: [],
      })
      const sessionId = newSession.sessionId

      // The agent's configured default effort is the initial currentValue.
      const initialEffort = newSession.configOptions?.find((o) => o.id === EFFORT_CONFIG_ID)
      expect(initialEffort?.type === "select" && initialEffort.currentValue).toBe("medium")

      const setRes = await ctx.request(acp.methods.agent.session.setConfigOption, {
        sessionId,
        configId: EFFORT_CONFIG_ID,
        value: "high",
      })
      const updated = setRes.configOptions.find((o) => o.id === EFFORT_CONFIG_ID)
      expect(updated?.type === "select" && updated.currentValue).toBe("high")

      await ctx.request(acp.methods.agent.session.prompt, {
        sessionId,
        prompt: [{ type: "text", text: "hello" }],
      })
      expect(lastPrompt.thinkingEffort).toBe("high")
    })
  })

  test("switching to a model that cannot honor the effort clears the override", async () => {
    const store = new MemorySessionStore()
    const stubRunner: Partial<Runner> = {
      bus: { on: () => {}, off: () => {} } as any,
      store,
      prompt: async (input) => ({ sessionId: input.sessionId ?? "runner-session-1" }) as any,
    }
    const agent = createAcpAgent({
      store,
      createRunner: () => stubRunner as Runner,
      models: effortModels,
      defaultModel: "openai/gpt-5.6-luna",
      defaultEffort: "high",
    })

    await acp.client({ name: "test-client" }).connectWith(agent.app, async (ctx) => {
      await ctx.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
      })
      const { sessionId } = await ctx.request(acp.methods.agent.session.new, {
        cwd: process.cwd(),
        mcpServers: [],
      })

      const setRes = await ctx.request(acp.methods.agent.session.setConfigOption, {
        sessionId,
        configId: MODEL_CONFIG_ID,
        value: "openai/gpt-plain",
      })
      // The new model has no effort option, and no stale override leaks through.
      expect(setRes.configOptions.some((o) => o.id === EFFORT_CONFIG_ID)).toBe(false)
    })
  })

  test("rejects effort for a model without thinking levels and unknown levels", async () => {
    const store = new MemorySessionStore()
    const stubRunner: Partial<Runner> = {
      bus: { on: () => {}, off: () => {} } as any,
      store,
      prompt: async (input) => ({ sessionId: input.sessionId ?? "runner-session-1" }) as any,
    }
    const agent = createAcpAgent({
      store,
      createRunner: () => stubRunner as Runner,
      models: effortModels,
      defaultModel: "openai/gpt-plain",
    })

    await acp.client({ name: "test-client" }).connectWith(agent.app, async (ctx) => {
      await ctx.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
      })
      const { sessionId } = await ctx.request(acp.methods.agent.session.new, {
        cwd: process.cwd(),
        mcpServers: [],
      })

      // The default model has no effort option at all.
      await expect(
        ctx.request(acp.methods.agent.session.setConfigOption, {
          sessionId,
          configId: EFFORT_CONFIG_ID,
          value: "high",
        }),
      ).rejects.toBeDefined()

      // A level the model does not list is refused.
      await ctx.request(acp.methods.agent.session.setConfigOption, {
        sessionId,
        configId: MODEL_CONFIG_ID,
        value: "openai/gpt-5.6-luna",
      })
      await expect(
        ctx.request(acp.methods.agent.session.setConfigOption, {
          sessionId,
          configId: EFFORT_CONFIG_ID,
          value: "ultra",
        }),
      ).rejects.toBeDefined()
    })
  })
})

describe("session config options integration", () => {
  test("session/new includes configOptions and session/set_config_option updates model override", async () => {
    let lastPromptModel: string | undefined

    const store = new MemorySessionStore()
    const stubRunner: Partial<Runner> = {
      bus: {
        on: () => {},
        off: () => {},
      } as any,
      store,
      prompt: async (input) => {
        lastPromptModel = input.model
        return { sessionId: input.sessionId ?? "runner-session-1" } as any
      },
    }

    const agent = createAcpAgent({
      store,
      createRunner: () => stubRunner as Runner,
      models: sampleModels,
      defaultModel: "openai/gpt-5.6-luna",
    })

    await acp.client({ name: "test-client" }).connectWith(agent.app, async (ctx) => {
      // 1. Initialize
      const init = await ctx.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
      })
      expect(init.protocolVersion).toBe(acp.PROTOCOL_VERSION)

      // 2. session/new
      const newSession = await ctx.request(acp.methods.agent.session.new, {
        cwd: process.cwd(),
        mcpServers: [],
      })
      expect(newSession.configOptions).toBeDefined()
      expect(newSession.configOptions?.length).toBe(1)
      expect(newSession.configOptions?.[0].category).toBe("model")
      if (newSession.configOptions?.[0].type === "select") {
        expect(newSession.configOptions[0].currentValue).toBe("openai/gpt-5.6-luna")
      }

      const sessionId = newSession.sessionId

      // 3. Prompt without override uses default model (no model passed to prompt)
      await ctx.request(acp.methods.agent.session.prompt, {
        sessionId,
        prompt: [{ type: "text", text: "hello" }],
      })
      expect(lastPromptModel).toBeUndefined()

      // 4. session/set_config_option updates to anthropic/claude-3-7-sonnet
      const setRes = await ctx.request(acp.methods.agent.session.setConfigOption, {
        sessionId,
        configId: "model",
        value: "anthropic/claude-3-7-sonnet",
      })
      expect(setRes.configOptions.length).toBe(1)
      if (setRes.configOptions[0].type === "select") {
        expect(setRes.configOptions[0].currentValue).toBe("anthropic/claude-3-7-sonnet")
      }

      // 5. Next prompt uses the selected model
      await ctx.request(acp.methods.agent.session.prompt, {
        sessionId,
        prompt: [{ type: "text", text: "hello again" }],
      })
      expect(lastPromptModel).toBe("anthropic/claude-3-7-sonnet")
    })
  })

  test("rejects invalid config option ID and unknown model", async () => {
    const stubRunner: Partial<Runner> = {
      bus: { on: () => {}, off: () => {} } as any,
    }

    const agent = createAcpAgent({
      createRunner: () => stubRunner as Runner,
      models: sampleModels,
      defaultModel: "openai/gpt-5.6-luna",
    })

    await acp.client({ name: "test-client" }).connectWith(agent.app, async (ctx) => {
      await ctx.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
      })

      const { sessionId } = await ctx.request(acp.methods.agent.session.new, {
        cwd: process.cwd(),
        mcpServers: [],
      })

      // Invalid configId
      await expect(
        ctx.request(acp.methods.agent.session.setConfigOption, {
          sessionId,
          configId: "invalid_option",
          value: "anything",
        }),
      ).rejects.toBeDefined()

      // Unknown model value
      await expect(
        ctx.request(acp.methods.agent.session.setConfigOption, {
          sessionId,
          configId: "model",
          value: "nonexistent/model",
        }),
      ).rejects.toBeDefined()
    })
  })
})
