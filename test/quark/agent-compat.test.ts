// Compatibility resolver tests — resolved legacy profile → portable AgentDefinition.
//
// These exercise the real tool loading paths (built-ins, missing tools) and the
// skill-tool wiring. Skill resolution is injected because discovery uses a
// process-global cache; the real `profileSkills` filter is covered elsewhere.

import { describe, expect, test } from "bun:test"
import { materializeAgent } from "../../packages/quark/src/agent-compat"
import { readTool } from "../../packages/runner/src/tool/read"
import { lookTool } from "../../packages/runner/src/tool/look"
import { list as listRegistered } from "../../packages/runner/src/tool/registry"
import type { ProfileDef } from "../../packages/quark/src/profile/profile"

function profile(overrides: Partial<ProfileDef> = {}): ProfileDef {
  return {
    id: "compat",
    name: "Compat",
    promptFile: "",
    tools: [],
    skills: [],
    ...overrides,
  }
}

describe("materializeAgent — tools", () => {
  test("built-ins become concrete ToolDefs without global registration", async () => {
    const before = listRegistered().length

    const agent = await materializeAgent(
      profile({ tools: ["read", "look", "skill"], model: "openai/x", thinkingEffort: "high" }),
      "SYSTEM PROMPT",
    )

    expect(agent.id).toBe("compat")
    expect(agent.name).toBe("Compat")
    expect(agent.instructions).toBe("SYSTEM PROMPT")
    expect(agent.model).toBe("openai/x")
    expect(agent.thinkingEffort).toBe("high")

    expect(agent.tools.map((t) => t.id)).toEqual(["read", "look", "skill"])
    expect(agent.tools[0]).toBe(readTool)
    expect(agent.tools[1]).toBe(lookTool)

    // Portable path: nothing was added to the global registry.
    expect(listRegistered().length).toBe(before)
  })

  test("missing tools are skipped and declared order is preserved", async () => {
    const agent = await materializeAgent(
      profile({ tools: ["read", "definitely-not-a-real-tool", "look"] }),
      "p",
    )

    expect(agent.tools.map((t) => t.id)).toEqual(["read", "look"])
  })
})

describe("materializeAgent — portable definition shape", () => {
  test("legacy profile subAgents are not carried into the AgentDefinition", async () => {
    const agent = await materializeAgent(
      profile({ subAgents: ["researcher", "worker"] }),
      "p",
    )

    // Profile IDs are a legacy AgentConfig concept; a portable definition is
    // self-contained and must not smuggle a global profile reference.
    expect("subAgents" in agent).toBe(false)
  })
})

describe("materializeAgent — skills", () => {
  test("resolved skills attach to the definition and the skill tool serves them", async () => {
    const before = listRegistered().length

    const agent = await materializeAgent(
      profile({ tools: ["skill"], skills: ["focus"] }),
      "p",
      {
        resolveSkills: (names) => [
          { name: names[0]!, description: "Focus mode", content: "Do the focused thing." },
        ],
      },
    )

    expect(agent.skills?.map((s) => s.name)).toEqual(["focus"])
    expect(agent.skills?.[0]?.content).toContain("Do the focused thing.")

    const skillTool = agent.tools.find((t) => t.id === "skill")!
    const result = await skillTool.execute(
      { name: "focus" },
      { sessionId: "s", messageId: "m", callId: "c", abort: new AbortController().signal },
    )
    expect(result.output).toContain("Do the focused thing.")

    expect(listRegistered().length).toBe(before)
  })
})
