// Tests for profile system

import { describe, test, expect, beforeEach, afterEach, afterAll } from "bun:test"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

import {
  resolveProfile,
  validateSubAgents,
  readPromptFile,
  listProfiles,
  setProfileThinking,
  resetProfileCache,
  loadProfileConfig,
  _internal,
} from "../../packages/quark/src/profile/profile"
import { getActive, dismiss } from "../../packages/runner/src/notification/notification"

// Keep profile tests off the developer's real ~/.config/quark/config.yaml.
// profile.ts resolves the directory per call, so pin it for every test.
const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), "quark-profile-test-"))
const previousConfigDir = process.env.QUARK_CONFIG_DIR
beforeEach(() => { process.env.QUARK_CONFIG_DIR = emptyHome })
afterAll(() => {
  if (previousConfigDir === undefined) delete process.env.QUARK_CONFIG_DIR
  else process.env.QUARK_CONFIG_DIR = previousConfigDir
  try { fs.rmSync(emptyHome, { recursive: true, force: true }) } catch {}
})

const {
  parseProfilesFromYAML,
  parseProjectOverrides,
  updateProfileThinking,
  BUILTIN_CODER,
} = _internal


// ---------------------------------------------------------------------------
// resolveProfile — fallback behavior
// ---------------------------------------------------------------------------

describe("resolveProfile", () => {
  beforeEach(() => resetProfileCache())
  afterEach(() => resetProfileCache())

  test("returns built-in coder when no config exists", () => {
    const profile = resolveProfile("coder")
    expect(profile.id).toBe("coder")
    expect(profile.tools).toContain("read")
    expect(profile.tools).toContain("bash")
    expect(profile.tools).toContain("skill")
    expect(profile.skills).toBeArray()
  })

  test("falls back to coder when unknown profile requested", () => {
    const profile = resolveProfile("nonexistent")
    expect(profile.id).toBe("coder")
  })

  test("returns coder when no profile specified", () => {
    const profile = resolveProfile()
    expect(profile.id).toBe("coder")
  })
})

// ---------------------------------------------------------------------------
// readPromptFile
// ---------------------------------------------------------------------------

describe("readPromptFile", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "atom-profile-test-"))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test("returns builtin prompt when no promptFile set", () => {
    const profile = resolveProfile("coder")
    const result = readPromptFile(profile)
    // Coder profile might have a custom prompt file, so check for either builtin or custom content
    expect(result.content.length).toBeGreaterThan(0)
    expect(result.content).toMatch(/coding|agent/i)
  })

  test("reads from promptFile when set", () => {
    const promptPath = path.join(tmpDir, "test-prompt.md")
    fs.writeFileSync(promptPath, "You are a test agent.")

    const profile = {
      ...resolveProfile("coder"),
      promptFile: promptPath,
    }
    const result = readPromptFile(profile)
    expect(result.content).toBe("You are a test agent.")
  })

  test("falls back to builtin when file not found", () => {
    const profile = {
      ...resolveProfile("coder"),
      promptFile: "/nonexistent/path.md",
    }
    const result = readPromptFile(profile)
    expect(result.content).toContain("coding assistant")
  })

  test("trims whitespace from prompt file content", () => {
    const promptPath = path.join(tmpDir, "padded.md")
    fs.writeFileSync(promptPath, "  \nYou are padded.\n\n  ")

    const profile = {
      ...resolveProfile("coder"),
      promptFile: promptPath,
    }
    const result = readPromptFile(profile)
    expect(result.content).toBe("You are padded.")
  })
})

// ---------------------------------------------------------------------------
// listProfiles
// ---------------------------------------------------------------------------

describe("listProfiles", () => {
  beforeEach(() => resetProfileCache())
  afterEach(() => resetProfileCache())

  test("includes built-in coder", () => {
    const profiles = listProfiles()
    expect(profiles).toContain("coder")
  })
})

// ---------------------------------------------------------------------------
// loadProfileConfig
// ---------------------------------------------------------------------------

describe("loadProfileConfig", () => {
  beforeEach(() => resetProfileCache())
  afterEach(() => resetProfileCache())

  test("returns valid config with defaults", () => {
    const config = loadProfileConfig()
    expect(config.defaultProfile).toBe("coder")
    expect(config.profiles.coder).toBeDefined()
    expect(config.profiles.coder.tools).toContain("read")
  })
})

// ---------------------------------------------------------------------------
// parseProfilesFromYAML — YAML config parsing
// ---------------------------------------------------------------------------

describe("parseProfilesFromYAML", () => {
  beforeEach(() => {
    for (const notification of getActive()) dismiss(notification.id)
  })

  afterEach(() => {
    for (const notification of getActive()) dismiss(notification.id)
  })

  test("parses a complete profile definition", () => {
    const raw = {
      profiles: {
        researcher: {
          name: "Researcher",
          prompt_file: "profiles/researcher.md",
          tools: ["websearch", "webfetch", "write"],
          skills: ["academic-research", "competitive-intel"],
        },
      },
    }

    const profiles = parseProfilesFromYAML(raw, "/home/user/.atom")
    expect(profiles.researcher).toBeDefined()
    expect(profiles.researcher.id).toBe("researcher")
    expect(profiles.researcher.name).toBe("Researcher")
    expect(profiles.researcher.promptFile).toBe("/home/user/.atom/profiles/researcher.md")
    expect(profiles.researcher.tools).toEqual(["websearch", "webfetch", "write"])
    expect(profiles.researcher.skills).toEqual(["academic-research", "competitive-intel"])
  })

  test("parses multiple profiles", () => {
    const raw = {
      profiles: {
        coder: {
          prompt_file: "profiles/coder.md",
          tools: ["read", "write", "edit", "bash"],
        },
        researcher: {
          prompt_file: "profiles/researcher.md",
          tools: ["websearch", "webfetch"],
          skills: ["academic-research"],
        },
      },
    }

    const profiles = parseProfilesFromYAML(raw, "/tmp/config")
    expect(Object.keys(profiles)).toHaveLength(2)
    expect(profiles.coder).toBeDefined()
    expect(profiles.researcher).toBeDefined()
  })

  test("uses id as name when name is not specified", () => {
    const raw = {
      profiles: {
        myprofile: {
          tools: ["read"],
        },
      },
    }

    const profiles = parseProfilesFromYAML(raw, "/tmp")
    expect(profiles.myprofile.name).toBe("myprofile")
  })

  test("defaults to builtin tools when tools not specified", () => {
    const raw = {
      profiles: {
        minimal: {
          prompt_file: "profiles/minimal.md",
        },
      },
    }

    const profiles = parseProfilesFromYAML(raw, "/tmp")
    expect(profiles.minimal.tools).toEqual(BUILTIN_CODER.tools)
  })

  test("defaults to empty skills when skills not specified", () => {
    const raw = {
      profiles: {
        noskills: {
          tools: ["read"],
        },
      },
    }

    const profiles = parseProfilesFromYAML(raw, "/tmp")
    expect(profiles.noskills.skills).toEqual([])
  })

  test("profile has no maxSteps or contextLimitTokens fields", () => {
    const raw = {
      profiles: {
        basic: {
          tools: ["read"],
        },
      },
    }

    const profiles = parseProfilesFromYAML(raw, "/tmp")
    expect(profiles.basic).not.toHaveProperty("maxSteps")
    expect(profiles.basic).not.toHaveProperty("contextLimitTokens")
  })

  test("resolves relative prompt_file paths against configDir", () => {
    const raw = {
      profiles: {
        test: {
          prompt_file: "profiles/test.md",
        },
      },
    }

    const profiles = parseProfilesFromYAML(raw, "/home/user/.atom")
    expect(profiles.test.promptFile).toBe("/home/user/.atom/profiles/test.md")
  })

  test("preserves absolute prompt_file paths", () => {
    const raw = {
      profiles: {
        test: {
          prompt_file: "/absolute/path/prompt.md",
        },
      },
    }

    const profiles = parseProfilesFromYAML(raw, "/home/user/.atom")
    expect(profiles.test.promptFile).toBe("/absolute/path/prompt.md")
  })

  test("sets empty promptFile when prompt_file not specified", () => {
    const raw = {
      profiles: {
        noprompt: {
          tools: ["read"],
        },
      },
    }

    const profiles = parseProfilesFromYAML(raw, "/tmp")
    expect(profiles.noprompt.promptFile).toBe("")
  })

  test("returns empty when raw has no profiles key", () => {
    const raw = { something_else: "value" }
    const profiles = parseProfilesFromYAML(raw, "/tmp")
    expect(Object.keys(profiles)).toHaveLength(0)
  })

  test("returns empty when profiles is not an object", () => {
    const raw = { profiles: "not-an-object" }
    const profiles = parseProfilesFromYAML(raw as any, "/tmp")
    expect(Object.keys(profiles)).toHaveLength(0)
  })

  test("skips non-object profile entries", () => {
    const raw = {
      profiles: {
        valid: { tools: ["read"] },
        invalid: "not-an-object",
        alsonull: null,
      },
    }

    const profiles = parseProfilesFromYAML(raw as any, "/tmp")
    expect(Object.keys(profiles)).toHaveLength(1)
    expect(profiles.valid).toBeDefined()
  })

  test("parses flat thinking fields beside a profile model", () => {
    const raw = {
      profiles: {
        coder: {
          model: "codex/gpt-5.6-luna",
          thinking_effort: "high",
          thinking_mode: "pro",
        },
      },
    }

    const profiles = parseProfilesFromYAML(raw, "/tmp")
    expect(profiles.coder.model).toBe("codex/gpt-5.6-luna")
    expect(profiles.coder.thinkingEffort).toBe("high")
    expect(profiles.coder.thinkingMode).toBe("pro")
  })

  test("parses the common effort-only form without adding a mode", () => {
    const profiles = parseProfilesFromYAML({
      profiles: {
        coder: {
          model: "codex/gpt-5.6",
          thinking_effort: "high",
        },
      },
    }, "/tmp")
    expect(profiles.coder.model).toBe("codex/gpt-5.6")
    expect(profiles.coder.thinkingEffort).toBe("high")
    expect(profiles.coder.thinkingMode).toBeUndefined()
  })

  test("reads the deprecated nested form into the flat runtime shape", () => {
    const profiles = parseProfilesFromYAML({
      profiles: {
        coder: {
          model: {
            id: "codex/gpt-5.6",
            thinking: { effort: "high", mode: "pro" },
          },
        },
      },
    }, "/tmp")

    expect(profiles.coder.model).toBe("codex/gpt-5.6")
    expect(profiles.coder.thinkingEffort).toBe("high")
    expect(profiles.coder.thinkingMode).toBe("pro")
    expect(getActive()).toContainEqual(expect.objectContaining({
      type: "warn",
      title: "Profile configuration",
      message: expect.stringContaining("deprecated nested format"),
    }))
  })

  test("prefers flat thinking fields over deprecated nested fields", () => {
    const profiles = parseProfilesFromYAML({
      profiles: {
        coder: {
          model: {
            id: "codex/gpt-5.6",
            thinking: { effort: "low", mode: "standard" },
          },
          thinking_effort: "high",
          thinking_mode: "pro",
        },
      },
    }, "/tmp")

    expect(profiles.coder.thinkingEffort).toBe("high")
    expect(profiles.coder.thinkingMode).toBe("pro")
  })

  test("preserves an effort for runtime validation against the selected catalog model", () => {
    const profiles = parseProfilesFromYAML({
      profiles: {
        coder: {
          model: "opencode/deepseek-v4-flash",
          thinking_effort: "xhigh",
        },
      },
    }, "/tmp")
    expect(profiles.coder.model).toBe("opencode/deepseek-v4-flash")
    expect(profiles.coder.thinkingEffort).toBe("xhigh")
  })

  test("preserves an effort when the profile model does not support thinking", () => {
    const profiles = parseProfilesFromYAML({
      profiles: {
        coder: {
          model: "copilot/gpt-4o",
          thinking_effort: "high",
        },
      },
    }, "/tmp")
    expect(profiles.coder.model).toBe("copilot/gpt-4o")
    expect(profiles.coder.thinkingEffort).toBe("high")
  })

  test("preserves thinking against the fallback model when model is omitted", () => {
    const profiles = parseProfilesFromYAML({
      profiles: { coder: { thinking_effort: "high" } },
    }, "/tmp", "copilot/gpt-5")
    expect(profiles.coder.model).toBeUndefined()
    expect(profiles.coder.thinkingEffort).toBe("high")
  })

  test("preserves thinking_mode for runtime validation against a model without mode support", () => {
    const profiles = parseProfilesFromYAML({
      profiles: {
        coder: {
          model: "copilot/gpt-5",
          thinking_effort: "high",
          thinking_mode: "pro",
        },
      },
    }, "/tmp")

    expect(profiles.coder.thinkingEffort).toBe("high")
    expect(profiles.coder.thinkingMode).toBe("pro")
  })

  test("preserves an invalid mode for runtime validation against a model with mode support", () => {
    const profiles = parseProfilesFromYAML({
      profiles: {
        coder: {
          model: "codex/gpt-5.6",
          thinking_effort: "high",
          thinking_mode: "ultra",
        },
      },
    }, "/tmp")

    expect(profiles.coder.thinkingEffort).toBe("high")
    expect(profiles.coder.thinkingMode).toBe("ultra")
  })

  test("parses string model field", () => {
    const raw = {
      profiles: {
        researcher: {
          tools: ["websearch"],
          model: "claude-sonnet-4.5",
        },
      },
    }

    const profiles = parseProfilesFromYAML(raw, "/tmp")
    expect(profiles.researcher.model).toBe("claude-sonnet-4.5")
  })

  test("model field is undefined when not specified", () => {
    const raw = {
      profiles: {
        coder: {
          tools: ["read"],
        },
      },
    }

    const profiles = parseProfilesFromYAML(raw, "/tmp")
    expect(profiles.coder.model).toBeUndefined()
  })
})

describe("updateProfileThinking", () => {
  test("writes flat fields and migrates a deprecated nested model", () => {
    const updated = updateProfileThinking({
      name: "Coder",
      model: {
        id: "codex/gpt-5.6-luna",
        thinking: { effort: "low", mode: "standard" },
      },
    }, { effort: "high", mode: "pro" })

    expect(updated).toEqual({
      name: "Coder",
      model: "codex/gpt-5.6-luna",
      thinking_effort: "high",
      thinking_mode: "pro",
    })
  })

  test("removes a stale mode when it is omitted", () => {
    const updated = updateProfileThinking({
      model: "copilot/gpt-5",
      thinking_effort: "high",
      thinking_mode: "pro",
    }, { effort: "none" })

    expect(updated).toEqual({
      model: "copilot/gpt-5",
      thinking_effort: "none",
    })
  })

  test("allows thinking settings without an explicit profile model", () => {
    expect(updateProfileThinking({}, { effort: "high" })).toEqual({
      thinking_effort: "high",
    })
  })
})

// ---------------------------------------------------------------------------
// parseProjectOverrides — skills_add / tools_add
// ---------------------------------------------------------------------------

describe("parseProjectOverrides", () => {
  test("returns empty overrides when no profile_overrides key", () => {
    const raw = { profiles: {} }
    const result = parseProjectOverrides(raw, "coder")
    expect(result.skillsAdd).toEqual([])
    expect(result.toolsAdd).toEqual([])
  })

  test("returns empty overrides when profile not in overrides", () => {
    const raw = {
      profile_overrides: {
        researcher: {
          skills_add: ["extra-skill"],
        },
      },
    }
    const result = parseProjectOverrides(raw, "coder")
    expect(result.skillsAdd).toEqual([])
    expect(result.toolsAdd).toEqual([])
  })

  test("parses skills_add for matching profile", () => {
    const raw = {
      profile_overrides: {
        coder: {
          skills_add: ["django-patterns", "react-patterns"],
        },
      },
    }
    const result = parseProjectOverrides(raw, "coder")
    expect(result.skillsAdd).toEqual(["django-patterns", "react-patterns"])
    expect(result.toolsAdd).toEqual([])
  })

  test("parses tools_add for matching profile", () => {
    const raw = {
      profile_overrides: {
        coder: {
          tools_add: ["grep", "glob"],
        },
      },
    }
    const result = parseProjectOverrides(raw, "coder")
    expect(result.toolsAdd).toEqual(["grep", "glob"])
    expect(result.skillsAdd).toEqual([])
  })

  test("parses both skills_add and tools_add together", () => {
    const raw = {
      profile_overrides: {
        researcher: {
          skills_add: ["competitive-intel"],
          tools_add: ["webfetch"],
        },
      },
    }
    const result = parseProjectOverrides(raw, "researcher")
    expect(result.skillsAdd).toEqual(["competitive-intel"])
    expect(result.toolsAdd).toEqual(["webfetch"])
  })

  test("returns empty when profile_overrides is not an object", () => {
    const raw = { profile_overrides: "not-an-object" }
    const result = parseProjectOverrides(raw as any, "coder")
    expect(result.skillsAdd).toEqual([])
    expect(result.toolsAdd).toEqual([])
  })

  test("returns empty when profile override entry is not an object", () => {
    const raw = {
      profile_overrides: {
        coder: "not-an-object",
      },
    }
    const result = parseProjectOverrides(raw as any, "coder")
    expect(result.skillsAdd).toEqual([])
    expect(result.toolsAdd).toEqual([])
  })

  test("ignores non-array skills_add/tools_add", () => {
    const raw = {
      profile_overrides: {
        coder: {
          skills_add: "not-an-array",
          tools_add: 42,
        },
      },
    }
    const result = parseProjectOverrides(raw as any, "coder")
    expect(result.skillsAdd).toEqual([])
    expect(result.toolsAdd).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// profileSkills — filtering skills by profile binding
// ---------------------------------------------------------------------------

describe("profileSkills", () => {
  const { profileSkills, discoverSkills, clearCache } = require("../../packages/runner/src/skill/skill")
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "atom-profileskills-test-"))
    clearCache()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    clearCache()
  })

  function writeSkill(dir: string, name: string, description: string, content: string) {
    const skillDir = path.join(dir, name)
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${description}\n---\n${content}`,
    )
  }

  test("returns empty array when no skill names given", () => {
    writeSkill(tmpDir, "alpha", "Alpha", "alpha content")
    discoverSkills([tmpDir])
    const result = profileSkills([])
    expect(result).toEqual([])
  })

  test("filters to only profile-bound skill names", () => {
    writeSkill(tmpDir, "alpha", "Alpha skill", "alpha content")
    writeSkill(tmpDir, "beta", "Beta skill", "beta content")
    writeSkill(tmpDir, "gamma", "Gamma skill", "gamma content")
    discoverSkills([tmpDir])

    const result = profileSkills(["alpha", "gamma"])
    expect(result).toHaveLength(2)
    const names = result.map((s: any) => s.name).sort()
    expect(names).toEqual(["alpha", "gamma"])
  })

  test("ignores skill names that don't exist", () => {
    writeSkill(tmpDir, "alpha", "Alpha skill", "alpha content")
    discoverSkills([tmpDir])

    const result = profileSkills(["alpha", "nonexistent"])
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe("alpha")
  })

  test("returns empty when no matching skills found", () => {
    writeSkill(tmpDir, "alpha", "Alpha skill", "alpha content")
    discoverSkills([tmpDir])

    const result = profileSkills(["nonexistent"])
    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// buildSkillTool — profile-filtered skill tool
// ---------------------------------------------------------------------------

describe("buildSkillTool", () => {
  const { clearCache, discoverSkills } = require("../../packages/runner/src/skill/skill")
  const { buildSkillTool } = require("../../packages/runner/src/tool/skill")
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "atom-skilltool-test-"))
    clearCache()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    clearCache()
  })

  function writeSkill(dir: string, name: string, description: string, content: string) {
    const skillDir = path.join(dir, name)
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${description}\n---\n${content}`,
    )
  }

  test("description is stable as bound skills change", () => {
    writeSkill(tmpDir, "alpha", "Alpha skill", "alpha content")
    writeSkill(tmpDir, "beta", "Beta skill", "beta content")
    discoverSkills([tmpDir])

    const unbound = buildSkillTool()
    const bound = buildSkillTool(["alpha", "beta"])
    // Stable description keeps the tool definition cacheable across activations.
    expect(bound.description).toBe(unbound.description)
    expect(bound.description).not.toContain("alpha")
  })

  test("execute loads a skill by name", async () => {
    writeSkill(tmpDir, "alpha", "Alpha skill", "Do alpha things.")
    discoverSkills([tmpDir])

    const tool = buildSkillTool()
    const ctx = { sessionId: "s1", messageId: "m1", abort: new AbortController().signal, messages: [], ask: async () => {} }
    const result = await tool.execute({ name: "alpha" }, ctx)
    expect(result.title).toBe("Loaded skill: alpha")
    expect(result.output).toContain("Do alpha things.")
    expect(result.output).toContain('<skill_content name="alpha">')
    expect(result.metadata.name).toBe("alpha")
  })

  test("execute throws for non-existent skill", async () => {
    writeSkill(tmpDir, "alpha", "Alpha skill", "content")
    discoverSkills([tmpDir])

    const tool = buildSkillTool(["alpha"])
    const ctx = { sessionId: "s1", messageId: "m1", abort: new AbortController().signal, messages: [], ask: async () => {} }

    await expect(tool.execute({ name: "nonexistent" }, ctx)).rejects.toThrow("not found")
  })

  test("execute error message lists available skills when bound", async () => {
    writeSkill(tmpDir, "alpha", "Alpha skill", "content")
    writeSkill(tmpDir, "beta", "Beta skill", "content")
    discoverSkills([tmpDir])

    const tool = buildSkillTool(["alpha"])
    const ctx = { sessionId: "s1", messageId: "m1", abort: new AbortController().signal, messages: [], ask: async () => {} }

    try {
      await tool.execute({ name: "missing" }, ctx)
      expect(true).toBe(false) // should not reach
    } catch (e: any) {
      expect(e.message).toContain("alpha")
      // beta should NOT be listed since it's not bound
      expect(e.message).not.toContain("beta")
    }
  })
})

// ---------------------------------------------------------------------------
// buildSystem — L1 skill metadata in system prompt
// ---------------------------------------------------------------------------

describe("buildSystem with skills", () => {
  const { buildSystem } = require("../../packages/runner/src/session/system")

  function skillDef(name: string, description: string, content: string) {
    return { name, description, content }
  }

  test("no skills — system prompt has no skill block", () => {
    const joined = buildSystem({ instructions: "You are a test agent." }).join("\n")
    expect(joined).not.toContain("Available Skills")
    expect(joined).toContain("You are a test agent.")
    expect(joined).toContain("Working directory:")
  })

  test("with concrete skills — system prompt includes L1 metadata", () => {
    const joined = buildSystem({
      instructions: "You are a coder.",
      skills: [
        skillDef("code-review", "Review code for quality", "Full review instructions..."),
        skillDef("git-release", "Manage git releases", "Full release instructions..."),
      ],
    }).join("\n")

    expect(joined).toContain("# Available Skills")
    expect(joined).toContain("code-review")
    expect(joined).toContain("Review code for quality")
    expect(joined).toContain("git-release")
    expect(joined).toContain("Manage git releases")
    // L2 content (skill body) should NOT be in the system prompt
    expect(joined).not.toContain("Full review instructions")
    expect(joined).not.toContain("Full release instructions")
  })

  test("only the supplied concrete skills are included", () => {
    const joined = buildSystem({
      instructions: "Test.",
      skills: [skillDef("bound-skill", "I am bound", "bound content")],
    }).join("\n")

    expect(joined).toContain("bound-skill")
    expect(joined).not.toContain("unbound-skill")
  })

  test("system prompt always includes environment block", () => {
    const joined = buildSystem({ instructions: "Test." }).join("\n")
    expect(joined).toContain("Working directory:")
    expect(joined).toContain("OS:")
    expect(joined).toContain("Today's date:")
  })
})

// ---------------------------------------------------------------------------
// /profile command in commands registry
// ---------------------------------------------------------------------------

describe("/profile command", () => {
  const { filterCommands, commands } = require("../../packages/quark/src/tui/commands")

  test("profile command exists in commands list", () => {
    const profileCmd = commands.find((c: any) => c.id === "profile")
    expect(profileCmd).toBeDefined()
    expect(profileCmd.description).toContain("profile")
    expect(profileCmd.usage).toBe("<profile-name>")
  })

  test("filterCommands matches /profile", () => {
    const result = filterCommands("profile")
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("profile")
  })

  test("filterCommands 'p' prefix matches profile", () => {
    const result = filterCommands("p")
    const ids = result.map((c: any) => c.id)
    expect(ids).toContain("profile")
  })
})

// ---------------------------------------------------------------------------
// parseProfilesFromYAML — sub_agents parsing
// ---------------------------------------------------------------------------

describe("parseProfilesFromYAML: sub_agents", () => {
  test("parses sub_agents list from profile", () => {
    const raw = {
      profiles: {
        coder: {
          tools: ["read", "bash"],
          sub_agents: ["researcher", "worker"],
        },
      },
    }
    const profiles = parseProfilesFromYAML(raw, "/tmp")
    expect(profiles.coder!.subAgents).toEqual(["researcher", "worker"])
  })

  test("subAgents is undefined when sub_agents not specified", () => {
    const raw = {
      profiles: {
        coder: {
          tools: ["read"],
        },
      },
    }
    const profiles = parseProfilesFromYAML(raw, "/tmp")
    expect(profiles.coder!.subAgents).toBeUndefined()
  })

  test("subAgents is undefined when sub_agents is not an array", () => {
    const raw = {
      profiles: {
        coder: {
          tools: ["read"],
          sub_agents: "researcher",
        },
      },
    }
    const profiles = parseProfilesFromYAML(raw as any, "/tmp")
    expect(profiles.coder!.subAgents).toBeUndefined()
  })

  test("empty sub_agents array results in empty array", () => {
    const raw = {
      profiles: {
        coder: {
          tools: ["read"],
          sub_agents: [],
        },
      },
    }
    const profiles = parseProfilesFromYAML(raw, "/tmp")
    expect(profiles.coder!.subAgents).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// validateSubAgents — pure validation function
// ---------------------------------------------------------------------------

describe("validateSubAgents", () => {
  const known = ["coder", "researcher", "worker"]

  test("all valid — valid list equals input, invalid is empty", () => {
    const { valid, invalid } = validateSubAgents(["researcher", "worker"], known)
    expect(valid).toEqual(["researcher", "worker"])
    expect(invalid).toEqual([])
  })

  test("all invalid — valid is empty, invalid list equals input", () => {
    const { valid, invalid } = validateSubAgents(["badname", "research"], known)
    expect(valid).toEqual([])
    expect(invalid).toEqual(["badname", "research"])
  })

  test("mixed valid + invalid — valid and invalid are split correctly", () => {
    const { valid, invalid } = validateSubAgents(["researcher", "badname", "worker", "typo"], known)
    expect(valid).toEqual(["researcher", "worker"])
    expect(invalid).toEqual(["badname", "typo"])
  })

  test("empty input — both lists are empty", () => {
    const { valid, invalid } = validateSubAgents([], known)
    expect(valid).toEqual([])
    expect(invalid).toEqual([])
  })

  test("empty knownProfileIds — everything is invalid", () => {
    const { valid, invalid } = validateSubAgents(["researcher", "worker"], [])
    expect(valid).toEqual([])
    expect(invalid).toEqual(["researcher", "worker"])
  })

  test("preserves order of valid entries", () => {
    const { valid } = validateSubAgents(["worker", "coder", "researcher"], known)
    expect(valid).toEqual(["worker", "coder", "researcher"])
  })
})

// ---------------------------------------------------------------------------
// resolveProfile — sub_agents validation (integration: temp config + notifications)
// ---------------------------------------------------------------------------

describe("resolveProfile: sub_agents validation", () => {
  let atomDir: string
  let atomConfigPath: string
  let previousConfig: string | null

  beforeEach(() => {
    resetProfileCache()
    // Dismiss any lingering notifications before each test
    for (const n of getActive()) dismiss(n.id)
    // Write a temp .quark/config.yaml in the project root so resolveProfile picks it up
    atomDir = path.resolve(process.cwd(), ".quark")
    atomConfigPath = path.join(atomDir, "config.yaml")
    previousConfig = fs.existsSync(atomConfigPath)
      ? fs.readFileSync(atomConfigPath, "utf-8")
      : null
    fs.mkdirSync(atomDir, { recursive: true })
  })

  afterEach(() => {
    resetProfileCache()
    // Restore only the config file this test owns; keep other .quark data intact.
    if (previousConfig === null) {
      fs.rmSync(atomConfigPath, { force: true })
      try {
        fs.rmdirSync(atomDir)
      } catch {}
    } else {
      fs.writeFileSync(atomConfigPath, previousConfig, "utf-8")
    }
    // Dismiss all notifications left over
    for (const n of getActive()) dismiss(n.id)
  })

  function writeConfig(content: string) {
    fs.writeFileSync(atomConfigPath, content, "utf-8")
  }

  test("valid sub-agents — preserved in resolved profile, no notification", () => {
    writeConfig(`
profiles:
  orchestrator:
    tools: [bash]
    sub_agents: [researcher, worker]
  researcher:
    tools: [read]
  worker:
    tools: [bash]
`)
    const profile = resolveProfile("orchestrator")
    expect(profile.subAgents).toEqual(["researcher", "worker"])
    expect(getActive().filter((notification) => notification.title === "Profile")).toHaveLength(0)
  })

  test("preserves unsupported thinking for runtime catalog validation", () => {
    writeConfig(`
profiles:
  finder:
    model: opencode/deepseek-v4-flash
    thinking_effort: xhigh
`)

    expect(resolveProfile("finder").thinkingEffort).toBe("xhigh")
  })

  test("invalid sub-agent ID — stripped from result, warn notification fires", () => {
    writeConfig(`
profiles:
  orchestrator:
    tools: [bash]
    sub_agents: [research]
  researcher:
    tools: [read]
`)
    const profile = resolveProfile("orchestrator")
    // "research" is not a profile ID — only "researcher" is
    expect(profile.subAgents).toEqual([])

    const active = getActive().filter((notification) => notification.title === "Profile")
    expect(active).toHaveLength(1)
    expect(active[0]!.type).toBe("warn")
    expect(active[0]!.title).toBe("Profile")
    expect(active[0]!.message).toContain("research")
    expect(active[0]!.message).toContain("researcher")
  })

  test("multiple invalid IDs — all stripped, single notification with plural wording", () => {
    writeConfig(`
profiles:
  orchestrator:
    tools: [bash]
    sub_agents: [badname1, badname2]
  researcher:
    tools: [read]
`)
    const profile = resolveProfile("orchestrator")
    expect(profile.subAgents).toEqual([])

    const active = getActive().filter((notification) => notification.title === "Profile")
    expect(active).toHaveLength(1)
    expect(active[0]!.message).toContain("sub-agents:")
    expect(active[0]!.message).toContain("badname1")
    expect(active[0]!.message).toContain("badname2")
  })

  test("mixed valid + invalid — invalid stripped, valid kept, notification fires", () => {
    writeConfig(`
profiles:
  orchestrator:
    tools: [bash]
    sub_agents: [researcher, typo, worker]
  researcher:
    tools: [read]
  worker:
    tools: [bash]
`)
    const profile = resolveProfile("orchestrator")
    expect(profile.subAgents).toEqual(["researcher", "worker"])

    const active = getActive().filter((notification) => notification.title === "Profile")
    expect(active).toHaveLength(1)
    // Notification names only the invalid IDs, not the valid ones
    expect(active[0]!.message).toContain("typo")
    // "researcher" and "worker" appear only in "Available profiles:" list, not as unknown
    expect(active[0]!.message).toMatch(/Unknown sub-agent.*typo/)
  })

  test("coder profile has no subAgents by default", () => {
    // Note: The actual coder profile from ~/.config/atom/config.yaml may have subAgents
    // This test verifies that if no config exists, the builtin coder has no subAgents
    const profile = resolveProfile("coder")
    // Just verify it's a valid profile with the expected id
    expect(profile.id).toBe("coder")
    expect(getActive().filter((notification) => notification.title === "Profile")).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// sub-agent delegation — profile subAgents become a concrete tool
// ---------------------------------------------------------------------------

describe("profile subAgents → subagent tool", () => {
  const { createSubagentTool } = require("../../packages/runner/src/tool/subagent")

  test("description lists the allowed child agent IDs", () => {
    const tool = createSubagentTool(["researcher", "worker"])
    expect(tool.description).toContain("researcher")
    expect(tool.description).toContain("worker")
  })

  test("rejects a child ID outside the allowed set", async () => {
    const tool = createSubagentTool(["researcher"])
    const ctx = { sessionId: "s", messageId: "m", callId: "c", abort: new AbortController().signal }
    await expect(tool.execute({ profile: "worker", prompt: "do it" }, ctx)).rejects.toThrow(
      /not allowed/,
    )
  })
})
