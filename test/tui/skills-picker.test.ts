// Tests for /skills slash command — skill picker and integration
//
// Verifies the full flow from discovering skills → picker items →
// adding to agent → system prompt update → skill tool re-registration.
//
// Tests are written BEFORE implementation (TDD).

import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

import { discoverSkills, loadSkill, clearCache, type Skill } from "../../src/skill/skill"
import { buildSystem } from "../../src/session/system"
import { buildSkillTool } from "../../src/tool/skill"
import { agentFromProfile } from "../../src/agent"
import { buildPickerItems, type PickerOption, type PickerEntry } from "../../src/tui/picker-items"
import type { AgentConfig } from "../../src/agent"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string

function createSkill(dir: string, name: string, description: string, content: string): void {
  const skillDir = path.join(dir, name)
  fs.mkdirSync(skillDir, { recursive: true })
  fs.writeFileSync(
    path.join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n${content}`,
  )
}

/**
 * Convert discovered Skill[] into PickerOption[].
 * This is what handleGetSkills() in index.tsx will do.
 */
function skillsToPickerOptions(skills: Skill[]): PickerOption[] {
  return skills.map((s) => ({ id: s.name, name: s.name }))
}

/**
 * Build a minimal AgentConfig for testing.
 * Uses a slim profile shape compatible with buildSystem and agentFromProfile.
 */
function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: "test",
    name: "Test Agent",
    prompt: "You are a test agent.",
    tools: ["read"],
    skills: [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "quark-skills-picker-test-"))
  clearCache()
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
  clearCache()
})

// ===========================================================================
// 1. Skill discovery → PickerOption conversion
// ===========================================================================

describe("skillsToPickerOptions", () => {
  test("converts discovered skills to picker options", () => {
    createSkill(tmpDir, "code-review", "Review code for quality", "Full instructions...")
    createSkill(tmpDir, "git-release", "Manage git releases", "Release instructions...")

    const skills = discoverSkills([tmpDir])
    const options = skillsToPickerOptions(skills)

    expect(options).toHaveLength(2)
    expect(options[0]!.id).toBe("code-review")
    expect(options[0]!.name).toBe("code-review")
    expect(options[1]!.id).toBe("git-release")
    expect(options[1]!.name).toBe("git-release")
  })

  test("returns empty array when no skills discovered", () => {
    const skills = discoverSkills([path.join(tmpDir, "nonexistent")])
    const options = skillsToPickerOptions(skills)
    expect(options).toEqual([])
  })

  test("each option has id and name fields", () => {
    createSkill(tmpDir, "alpha", "Alpha skill", "content")
    const skills = discoverSkills([tmpDir])
    const options = skillsToPickerOptions(skills)

    for (const opt of options) {
      expect(opt).toHaveProperty("id")
      expect(opt).toHaveProperty("name")
      expect(typeof opt.id).toBe("string")
      expect(typeof opt.name).toBe("string")
    }
  })
})

// ===========================================================================
// 2. buildPickerItems with skill options
// ===========================================================================

describe("buildPickerItems with skills", () => {
  test("builds picker items from skill options", () => {
    createSkill(tmpDir, "alpha", "Alpha skill", "content")
    createSkill(tmpDir, "beta", "Beta skill", "content")
    const skills = discoverSkills([tmpDir])
    const options = skillsToPickerOptions(skills)

    const items = buildPickerItems(options, "")

    expect(items).toHaveLength(2)
    const ids = items.map((i) => i.id).sort()
    expect(ids).toEqual(["alpha", "beta"])
    expect(items[0]!.label).toBe(items[0]!.id)
  })

  test("filters skill picker items by query", () => {
    createSkill(tmpDir, "academic-research", "Research", "content")
    createSkill(tmpDir, "code-review", "Review code", "content")
    createSkill(tmpDir, "git-release", "Release", "content")
    const skills = discoverSkills([tmpDir])
    const options = skillsToPickerOptions(skills)

    const items = buildPickerItems(options, "", "code")
    expect(items).toHaveLength(1)
    expect(items[0]!.id).toBe("code-review")
  })

  test("filters by name containing query", () => {
    createSkill(tmpDir, "academic-research", "Research", "content")
    createSkill(tmpDir, "code-review", "Code Review Skill", "content")
    const skills = discoverSkills([tmpDir])
    const options = skillsToPickerOptions(skills)

    // Searching by the name field (not just id)
    const items = buildPickerItems(options, "", "research")
    expect(items).toHaveLength(1)
    expect(items[0]!.id).toBe("academic-research")
  })

  test("no query — returns all items", () => {
    createSkill(tmpDir, "alpha", "Alpha", "content")
    createSkill(tmpDir, "beta", "Beta", "content")
    const skills = discoverSkills([tmpDir])
    const options = skillsToPickerOptions(skills)

    const items = buildPickerItems(options, "")
    expect(items).toHaveLength(2)
  })

  test("empty options returns empty items", () => {
    const items = buildPickerItems([], "")
    expect(items).toEqual([])
  })

  test("each picker entry has required fields", () => {
    createSkill(tmpDir, "test-skill", "Test", "content")
    const skills = discoverSkills([tmpDir])
    const options = skillsToPickerOptions(skills)
    const items = buildPickerItems(options, "")

    for (const item of items) {
      expect(item).toHaveProperty("id")
      expect(item).toHaveProperty("label")
      expect(item).toHaveProperty("detail")
      expect(typeof item.id).toBe("string")
      expect(typeof item.label).toBe("string")
    }
  })
})

// ===========================================================================
// 3. Adding a skill to agent.skills (in-memory mutation)
// ===========================================================================

describe("agent.skills mutation", () => {
  test("adds a skill name to empty skills array", () => {
    const agent = makeAgent({ skills: [] })
    agent.skills = [...agent.skills, "code-review"]
    expect(agent.skills).toEqual(["code-review"])
  })

  test("adds a skill name to existing skills", () => {
    const agent = makeAgent({ skills: ["code-review"] })
    agent.skills = [...agent.skills, "git-release"]
    expect(agent.skills).toEqual(["code-review", "git-release"])
  })

  test("preserves existing skills when adding new one", () => {
    const agent = makeAgent({ skills: ["alpha", "beta"] })
    agent.skills = [...agent.skills, "gamma"]
    expect(agent.skills).toHaveLength(3)
    expect(agent.skills).toContain("alpha")
    expect(agent.skills).toContain("beta")
    expect(agent.skills).toContain("gamma")
  })

  test("multiple additions accumulate", () => {
    const agent = makeAgent({ skills: [] })
    agent.skills = [...agent.skills, "alpha"]
    agent.skills = [...agent.skills, "beta"]
    agent.skills = [...agent.skills, "gamma"]
    expect(agent.skills).toEqual(["alpha", "beta", "gamma"])
  })
})

// ===========================================================================
// 4. Duplicate detection
// ===========================================================================

describe("duplicate skill detection", () => {
  test("detects when skill is already in agent.skills", () => {
    const agent = makeAgent({ skills: ["code-review", "git-release"] })
    const isDuplicate = agent.skills.includes("code-review")
    expect(isDuplicate).toBe(true)
  })

  test("returns false when skill is not in agent.skills", () => {
    const agent = makeAgent({ skills: ["code-review"] })
    const isDuplicate = agent.skills.includes("git-release")
    expect(isDuplicate).toBe(false)
  })

  test("returns false when agent.skills is empty", () => {
    const agent = makeAgent({ skills: [] })
    const isDuplicate = agent.skills.includes("any-skill")
    expect(isDuplicate).toBe(false)
  })
})

// ===========================================================================
// 5. buildSystem reflects newly added skill's L1 metadata
// ===========================================================================

describe("buildSystem with dynamically added skills", () => {
  test("system prompt includes L1 metadata for bound skills", () => {
    createSkill(tmpDir, "code-review", "Review code for quality", "Full review instructions...")
    createSkill(tmpDir, "git-release", "Manage git releases", "Full release instructions...")
    discoverSkills([tmpDir])

    // Simulate: user added 'git-release' via /skills picker
    const agent = makeAgent({ skills: ["code-review", "git-release"] })
    const parts = buildSystem(agent)
    const joined = parts.join("\n")

    expect(joined).toContain("# Available Skills")
    expect(joined).toContain("code-review")
    expect(joined).toContain("Review code for quality")
    expect(joined).toContain("git-release")
    expect(joined).toContain("Manage git releases")

    // L2 content (SKILL.md body) must NOT leak into system prompt
    expect(joined).not.toContain("Full review instructions")
    expect(joined).not.toContain("Full release instructions")
  })

  test("adding skill changes system prompt output (before vs after)", () => {
    createSkill(tmpDir, "alpha", "Alpha skill", "alpha body")
    createSkill(tmpDir, "beta", "Beta skill", "beta body")
    discoverSkills([tmpDir])

    // Before adding beta
    const agentBefore = makeAgent({ skills: ["alpha"] })
    const before = buildSystem(agentBefore).join("\n")
    expect(before).toContain("alpha")
    expect(before).not.toContain("beta")

    // After adding beta
    const agentAfter = makeAgent({ skills: ["alpha", "beta"] })
    const after = buildSystem(agentAfter).join("\n")
    expect(after).toContain("alpha")
    expect(after).toContain("beta")
    expect(after).toContain("Beta skill")
  })

  test("empty skills — no skill block in system prompt", () => {
    const agent = makeAgent({ skills: [] })
    const parts = buildSystem(agent)
    const joined = parts.join("\n")
    expect(joined).not.toContain("Available Skills")
  })

  test("skill not on disk — gracefully omitted from system prompt", () => {
    createSkill(tmpDir, "real-skill", "Real skill", "content")
    discoverSkills([tmpDir])

    // 'ghost-skill' was added to agent.skills but doesn't exist on disk
    const agent = makeAgent({ skills: ["real-skill", "ghost-skill"] })
    const parts = buildSystem(agent)
    const joined = parts.join("\n")

    expect(joined).toContain("real-skill")
    expect(joined).not.toContain("ghost-skill")
  })
})

// ===========================================================================
// 6. buildSkillTool reflects expanded boundSkills
// ===========================================================================

describe("buildSkillTool with dynamically added skills", () => {
  test("tool description includes only initially bound skills", () => {
    createSkill(tmpDir, "alpha", "Alpha skill", "alpha content")
    createSkill(tmpDir, "beta", "Beta skill", "beta content")
    discoverSkills([tmpDir])

    // Initial state: only alpha is bound
    const tool = buildSkillTool(["alpha"])
    expect(tool.description).toContain("alpha")
    expect(tool.description).not.toContain("beta")
  })

  test("tool description updates after adding skill", () => {
    createSkill(tmpDir, "alpha", "Alpha skill", "alpha content")
    createSkill(tmpDir, "beta", "Beta skill", "beta content")
    discoverSkills([tmpDir])

    // After adding beta via /skills
    const tool = buildSkillTool(["alpha", "beta"])
    expect(tool.description).toContain("alpha")
    expect(tool.description).toContain("beta")
  })

  test("all skills available when no boundSkills filter", () => {
    createSkill(tmpDir, "alpha", "Alpha skill", "alpha content")
    createSkill(tmpDir, "beta", "Beta skill", "beta content")
    discoverSkills([tmpDir])

    const tool = buildSkillTool()
    expect(tool.description).toContain("alpha")
    expect(tool.description).toContain("beta")
  })

  test("tool shows 'no skills available' when boundSkills match nothing", () => {
    const tool = buildSkillTool(["nonexistent"])
    expect(tool.description).toContain("No skills are currently available")
  })

  test("execute loads a newly added skill", async () => {
    createSkill(tmpDir, "new-skill", "Newly added", "Do the new thing.")
    discoverSkills([tmpDir])

    const tool = buildSkillTool(["new-skill"])
    const ctx = {
      sessionId: "s1",
      messageId: "m1",
      abort: new AbortController().signal,
      messages: [],
      ask: async (_req: any) => "allow" as const,
    }
    const result = await tool.execute({ name: "new-skill" }, ctx)
    expect(result.title).toBe("Loaded skill: new-skill")
    expect(result.output).toContain("Do the new thing.")
    expect(result.metadata.name).toBe("new-skill")
  })
})

// ===========================================================================
// 7. Edge cases
// ===========================================================================

describe("skills picker edge cases", () => {
  test("query with no matches returns empty items", () => {
    createSkill(tmpDir, "alpha", "Alpha", "content")
    createSkill(tmpDir, "beta", "Beta", "content")
    const skills = discoverSkills([tmpDir])
    const options = skillsToPickerOptions(skills)

    const items = buildPickerItems(options, "", "zzz")
    expect(items).toEqual([])
  })

  test("skill with no frontmatter name uses directory name", () => {
    // Create skill without name in frontmatter — falls back to dir name
    const skillDir = path.join(tmpDir, "fallback-skill")
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "Just content, no frontmatter.")

    const skills = discoverSkills([tmpDir])
    expect(skills).toHaveLength(1)
    expect(skills[0]!.name).toBe("fallback-skill")

    const options = skillsToPickerOptions(skills)
    expect(options[0]!.id).toBe("fallback-skill")
  })

  test("skill with empty description still appears in picker", () => {
    createSkill(tmpDir, "no-desc", "", "content")
    const skills = discoverSkills([tmpDir])
    const options = skillsToPickerOptions(skills)
    const items = buildPickerItems(options, "")

    expect(items).toHaveLength(1)
    expect(items[0]!.id).toBe("no-desc")
  })

  test("many skills — all appear in picker items", () => {
    const count = 20
    for (let i = 0; i < count; i++) {
      createSkill(tmpDir, `skill-${i}`, `Skill ${i}`, `content ${i}`)
    }
    const skills = discoverSkills([tmpDir])
    const options = skillsToPickerOptions(skills)
    const items = buildPickerItems(options, "")

    expect(items).toHaveLength(count)
  })
})

// ===========================================================================
// 8. Profile switch resets skills
// ===========================================================================

describe("profile switch resets skills", () => {
  test("agentFromProfile creates agent with profile's declared skills only", () => {
    const profile = {
      id: "custom",
      name: "Custom",
      promptFile: "",
      tools: ["read"],
      skills: ["declared-skill"],
    }

    const agent = agentFromProfile(profile, "You are custom.")
    expect(agent.skills).toEqual(["declared-skill"])
    // Skills added via /skills during a previous session would NOT be in the new agent
  })

  test("new agent from profile does not carry over temporary skills", () => {
    // Simulate: profile A's base skills are ['alpha']
    // User adds 'beta' via /skills → agent.skills = ['alpha', 'beta']
    // Then switches to profile B → new agentFromProfile → only profile B's skills

    const profileA = {
      id: "profile-a",
      name: "Profile A",
      promptFile: "",
      tools: ["read"],
      skills: ["alpha"],
    }

    const profileB = {
      id: "profile-b",
      name: "Profile B",
      promptFile: "",
      tools: ["read"],
      skills: ["gamma"],
    }

    // Simulate adding beta to profile A's agent
    const agentA = agentFromProfile(profileA, "prompt")
    agentA.skills = [...agentA.skills, "beta"]
    expect(agentA.skills).toEqual(["alpha", "beta"])

    // Switch to profile B — creates a fresh agent
    const agentB = agentFromProfile(profileB, "prompt")
    expect(agentB.skills).toEqual(["gamma"])
    // 'beta' from the temporary addition is gone
  })
})
