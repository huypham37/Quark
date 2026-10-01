import { describe, expect, test } from "bun:test"
import * as acp from "@agentclientprotocol/sdk"
import { createAcpAgent } from "../../packages/acp/src/index"
import {
  buildConfigOptions,
  EFFORT_CONFIG_ID,
  MODEL_CONFIG_ID,
  PROFILE_CONFIG_ID,
  type ModelOption,
  type ProfileOption,
} from "../../packages/acp/src/config-options"
import { MemorySessionStore, type Runner } from "@quark/runner"

const sampleModels: ModelOption[] = [
  { id: "openai/gpt-5.6-luna", name: "GPT-5.6 Luna", providerId: "openai", providerName: "OpenAI" },
  { id: "openai/gpt-5.6-sol", name: "GPT-5.6 Sol", providerId: "openai", providerName: "OpenAI" },
  { id: "anthropic/claude-3-7-sonnet", name: "Claude 3.7 Sonnet", providerId: "anthropic", providerName: "Anthropic" },
]

const sampleProfiles: ProfileOption[] = [
  { id: "coder", name: "Coder", description: "Writes code", model: "openai/gpt-5.6-luna" },
  { id: "finder", name: "Finder", model: "anthropic/claude-3-7-sonnet", thinkingEffort: "high" },
]

describe("buildConfigOptions", () => {
  test("returns empty array when no profiles or models are configured", () => {
    expect(buildConfigOptions({ models: [], profiles: [], defaults: { model: "openai/gpt-5.6-luna" } })).toEqual([])
  })

  test("groups models by provider when multiple providers exist", () => {
    const options = buildConfigOptions({
      models: sampleModels,
      profiles: [],
      defaults: { model: "openai/gpt-5.6-luna" },
    })
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
    const options = buildConfigOptions({
      models: singleProvider,
      profiles: [],
      defaults: { model: "openai/gpt-5.6-luna" },
    })
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

describe("profile config option", () => {
  const profileModels: ModelOption[] = [
    {
      id: "openai/gpt-5.6-luna",
      name: "GPT-5.6 Luna",
      providerId: "openai",
      providerName: "OpenAI",
      thinkingLevels: ["none", "low", "high"],
    },
    {
      id: "anthropic/claude-3-7-sonnet",
      name: "Claude 3.7 Sonnet",
      providerId: "anthropic",
      providerName: "Anthropic",
      thinkingLevels: ["none", "high"],
    },
  ]

  test("advertises the profile selector as the session's mode", () => {
    const options = buildConfigOptions({
      models: sampleModels,
      profiles: sampleProfiles,
      defaults: { profile: "coder", model: "openai/gpt-5.6-luna" },
    })
    const profile = options.find((option) => option.id === PROFILE_CONFIG_ID)
    expect(profile?.name).toBe("Profile")
    expect(profile?.category).toBe("mode")
    if (profile?.type === "select") {
      expect(profile.currentValue).toBe("coder")
      expect(profile.options.map((option) => option.value)).toEqual(["coder", "finder"])
    } else {
      expect().fail("expected a profile select")
    }
  })

  test("the model and effort rows follow the selected profile's own settings", () => {
    const input = {
      models: profileModels,
      profiles: sampleProfiles,
      defaults: { profile: "coder", model: "openai/gpt-5.6-luna" },
    }
    const asCoder = buildConfigOptions(input)
    const coderModel = asCoder.find((option) => option.id === MODEL_CONFIG_ID)
    expect(coderModel?.type === "select" && coderModel.currentValue).toBe("openai/gpt-5.6-luna")

    // The profile's own model/effort apply when the session has no picks.
    const asFinder = buildConfigOptions({ ...input, overrides: { profile: "finder" } })
    const finderModel = asFinder.find((option) => option.id === MODEL_CONFIG_ID)
    expect(finderModel?.type === "select" && finderModel.currentValue).toBe("anthropic/claude-3-7-sonnet")
    const finderEffort = asFinder.find((option) => option.id === EFFORT_CONFIG_ID)
    expect(finderEffort?.type === "select" && finderEffort.currentValue).toBe("high")

    // An explicit model pick wins over the profile's own model.
    const explicit = buildConfigOptions({
      ...input,
      overrides: { profile: "finder", model: "openai/gpt-5.6-luna" },
    })
    const explicitModel = explicit.find((option) => option.id === MODEL_CONFIG_ID)
    expect(explicitModel?.type === "select" && explicitModel.currentValue).toBe("openai/gpt-5.6-luna")
  })

  test("session/set_config_option rebinds the session on the new profile and drops its model/effort picks", async () => {
    const created: (string | null)[] = []
    const prompts: { model?: string; thinkingEffort?: string }[] = []
    const store = new MemorySessionStore()
    const stubRunner: Partial<Runner> = {
      bus: { on: () => {}, off: () => {} } as any,
      store,
      prompt: async (input) => {
        prompts.push({ model: input.model, thinkingEffort: input.thinkingEffort })
        return { sessionId: input.sessionId ?? "runner-session-1" } as any
      },
    }
    const agent = createAcpAgent({
      store,
      createRunner: (_cwd, _store, _mcpTools, profile) => {
        created.push(profile)
        return stubRunner as Runner
      },
      models: profileModels,
      profiles: sampleProfiles,
      defaultProfile: "coder",
      defaultModel: "openai/gpt-5.6-luna",
    })

    await acp.client({ name: "test-client" }).connectWith(agent.app, async (ctx) => {
      await ctx.request(acp.methods.agent.initialize, { protocolVersion: acp.PROTOCOL_VERSION })
      const newSession = await ctx.request(acp.methods.agent.session.new, {
        cwd: process.cwd(),
        mcpServers: [],
      })
      const { sessionId } = newSession
      const initialProfile = newSession.configOptions?.find((option) => option.id === PROFILE_CONFIG_ID)
      expect(initialProfile?.type === "select" && initialProfile.currentValue).toBe("coder")

      // An explicit model pick on the start profile is threaded into the turn.
      await ctx.request(acp.methods.agent.session.setConfigOption, {
        sessionId,
        configId: MODEL_CONFIG_ID,
        value: "anthropic/claude-3-7-sonnet",
      })
      await ctx.request(acp.methods.agent.session.prompt, {
        sessionId,
        prompt: [{ type: "text", text: "hello" }],
      })
      expect(prompts[0]?.model).toBe("anthropic/claude-3-7-sonnet")

      // Switching profile means "run it as configured": the pick is dropped and
      // the rows now show the new profile's own model and effort.
      const switched = await ctx.request(acp.methods.agent.session.setConfigOption, {
        sessionId,
        configId: PROFILE_CONFIG_ID,
        value: "finder",
      })
      const model = switched.configOptions.find((option) => option.id === MODEL_CONFIG_ID)
      expect(model?.type === "select" && model.currentValue).toBe("anthropic/claude-3-7-sonnet")
      const effort = switched.configOptions.find((option) => option.id === EFFORT_CONFIG_ID)
      expect(effort?.type === "select" && effort.currentValue).toBe("high")

      await ctx.request(acp.methods.agent.session.prompt, {
        sessionId,
        prompt: [{ type: "text", text: "again" }],
      })
      // No override is sent: the runner uses the finder profile's own agent. The
      // first turn ran on the connection default (null), the second on "finder".
      expect(prompts[1]).toEqual({ model: undefined, thinkingEffort: undefined })
      expect(created).toEqual([null, "finder"])
    })
  })

  test("refuses a profile switch while a turn is in progress, then accepts it once idle", async () => {
    const store = new MemorySessionStore()
    let release: (() => void) | undefined
    const stubRunner: Partial<Runner> = {
      bus: { on: () => {}, off: () => {} } as any,
      store,
      prompt: async (input) => {
        await new Promise<void>((resolve) => (release = resolve))
        return { sessionId: input.sessionId ?? "runner-session-1" } as any
      },
    }
    const agent = createAcpAgent({
      store,
      createRunner: () => stubRunner as Runner,
      models: sampleModels,
      profiles: sampleProfiles,
      defaultProfile: "coder",
      defaultModel: "openai/gpt-5.6-luna",
    })

    await acp.client({ name: "test-client" }).connectWith(agent.app, async (ctx) => {
      await ctx.request(acp.methods.agent.initialize, { protocolVersion: acp.PROTOCOL_VERSION })
      const { sessionId } = await ctx.request(acp.methods.agent.session.new, {
        cwd: process.cwd(),
        mcpServers: [],
      })

      // The switch rebinds the session's runner, so it must not land mid-turn.
      const turn = ctx.request(acp.methods.agent.session.prompt, {
        sessionId,
        prompt: [{ type: "text", text: "hello" }],
      })
      await expect(
        ctx.request(acp.methods.agent.session.setConfigOption, {
          sessionId,
          configId: PROFILE_CONFIG_ID,
          value: "finder",
        }),
      ).rejects.toMatchObject({ code: -32602, message: expect.stringContaining("in progress") })

      release?.()
      await turn
      const switched = await ctx.request(acp.methods.agent.session.setConfigOption, {
        sessionId,
        configId: PROFILE_CONFIG_ID,
        value: "finder",
      })
      const profile = switched.configOptions.find((option) => option.id === PROFILE_CONFIG_ID)
      expect(profile?.type === "select" && profile.currentValue).toBe("finder")
    })
  })

  test("rejects an unknown profile", async () => {
    const store = new MemorySessionStore()
    const stubRunner: Partial<Runner> = {
      bus: { on: () => {}, off: () => {} } as any,
      store,
      prompt: async (input) => ({ sessionId: input.sessionId ?? "runner-session-1" }) as any,
    }
    const agent = createAcpAgent({
      store,
      createRunner: () => stubRunner as Runner,
      models: sampleModels,
      profiles: sampleProfiles,
      defaultProfile: "coder",
      defaultModel: "openai/gpt-5.6-luna",
    })

    await acp.client({ name: "test-client" }).connectWith(agent.app, async (ctx) => {
      await ctx.request(acp.methods.agent.initialize, { protocolVersion: acp.PROTOCOL_VERSION })
      const { sessionId } = await ctx.request(acp.methods.agent.session.new, {
        cwd: process.cwd(),
        mcpServers: [],
      })
      await expect(
        ctx.request(acp.methods.agent.session.setConfigOption, {
          sessionId,
          configId: PROFILE_CONFIG_ID,
          value: "nope",
        }),
      ).rejects.toBeDefined()
    })
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
    const withEffort = buildConfigOptions({
      models: effortModels,
      profiles: [],
      defaults: { model: "openai/gpt-5.6-luna" },
    })
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
    const withoutEffort = buildConfigOptions({
      models: effortModels,
      profiles: [],
      defaults: { model: "openai/gpt-plain" },
    })
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
